import { z } from "zod";
import type {
  ExtractedInvoice,
  InvoiceLineMatch,
  PolicyDiscrepancy,
} from "@/server/reconciliation/types";
import type {
  PurchaseOrder,
  ReceivingRecord,
  Vendor,
} from "@/server/accounting/service";
import {
  decimalAbsolute,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
} from "@/server/decimal";

export const ReconciliationPolicySchema = z.object({
  version: z.string().trim().min(1),
  allowedPurchaseOrderStatuses: z.array(
    z.enum(["open", "closed", "cancelled"]),
  ),
  extractionConfidenceMinimum: z.number().min(0).max(1),
  lineMatchConfidenceMinimum: z.number().min(0).max(1),
  unitPriceTolerance: z.string(),
  quantityTolerance: z.string(),
  requireReceivingRecords: z.boolean(),
  allowUnrepresentedCharges: z.boolean(),
});

export type ReconciliationPolicy = z.infer<typeof ReconciliationPolicySchema>;

export const DEFAULT_RECONCILIATION_POLICY: ReconciliationPolicy = {
  version: "strict-three-way-v1",
  allowedPurchaseOrderStatuses: ["open"],
  extractionConfidenceMinimum: 0.9,
  lineMatchConfidenceMinimum: 0.9,
  unitPriceTolerance: "0",
  quantityTolerance: "0",
  requireReceivingRecords: true,
  allowUnrepresentedCharges: false,
};

function equalWithin(left: string, right: string, tolerance: string): boolean {
  return (
    decimalAbsolute(parseDecimal(left) - parseDecimal(right)) <=
    parseDecimal(tolerance)
  );
}

export function evaluateReconciliationPolicy(input: {
  policy: ReconciliationPolicy;
  invoice: ExtractedInvoice;
  vendor: Vendor;
  purchaseOrder: PurchaseOrder;
  receivingRecords: ReceivingRecord[];
  lineMatches: InvoiceLineMatch[];
  previouslyInvoiced: Record<string, string>;
  duplicateInvoice: boolean;
}): PolicyDiscrepancy[] {
  const discrepancies: PolicyDiscrepancy[] = [];
  const { invoice, purchaseOrder, policy } = input;

  if (input.duplicateInvoice) {
    discrepancies.push({
      code: "duplicate_invoice",
      message: "The vendor invoice number has already been remitted.",
    });
  }
  if (!policy.allowedPurchaseOrderStatuses.includes(purchaseOrder.status)) {
    discrepancies.push({
      code: "purchase_order_not_open",
      message: `Purchase order ${purchaseOrder.poNumber} is ${purchaseOrder.status}.`,
      expected: policy.allowedPurchaseOrderStatuses.join(", "),
      actual: purchaseOrder.status,
    });
  }
  if (purchaseOrder.vendorId !== input.vendor.id) {
    discrepancies.push({
      code: "vendor_mismatch",
      message: "The matched vendor does not own the selected purchase order.",
    });
  }
  if (invoice.currency !== purchaseOrder.currency) {
    discrepancies.push({
      code: "currency_mismatch",
      message: "Invoice and purchase-order currencies differ.",
      expected: purchaseOrder.currency,
      actual: invoice.currency ?? "missing",
    });
  }

  const received = new Map<string, bigint>();
  for (const record of input.receivingRecords) {
    for (const line of record.lines) {
      received.set(
        line.purchaseOrderLineId,
        (received.get(line.purchaseOrderLineId) ?? 0n) +
          parseDecimal(line.quantityReceived),
      );
    }
  }

  const matchedPoLines = new Set<string>();
  invoice.lines.forEach((invoiceLine, invoiceLineIndex) => {
    const match = input.lineMatches.find(
      (candidate) => candidate.invoiceLineIndex === invoiceLineIndex,
    );
    if (!match) {
      discrepancies.push({
        code: "unmatched_line",
        message: "Invoice line is not mapped to a purchase-order line.",
        invoiceLineIndex,
      });
      return;
    }
    if (
      match.confidence < policy.lineMatchConfidenceMinimum ||
      matchedPoLines.has(match.purchaseOrderLineId)
    ) {
      discrepancies.push({
        code: "ambiguous_line",
        message:
          "Invoice line mapping is ambiguous or below the confidence threshold.",
        invoiceLineIndex,
        purchaseOrderLineId: match.purchaseOrderLineId,
      });
      return;
    }
    matchedPoLines.add(match.purchaseOrderLineId);
    const poLine = purchaseOrder.lines.find(
      (line) => line.id === match.purchaseOrderLineId,
    );
    if (!poLine) {
      discrepancies.push({
        code: "unmatched_line",
        message: "Mapped purchase-order line does not exist.",
        invoiceLineIndex,
      });
      return;
    }
    if (
      !equalWithin(
        invoiceLine.unitPrice,
        poLine.unitPrice,
        policy.unitPriceTolerance,
      )
    ) {
      discrepancies.push({
        code: "unit_price_mismatch",
        message: "Invoice and purchase-order unit prices differ.",
        invoiceLineIndex,
        purchaseOrderLineId: poLine.id,
        expected: poLine.unitPrice,
        actual: invoiceLine.unitPrice,
      });
    }
    if (
      parseDecimal(invoiceLine.quantity) >
      parseDecimal(poLine.quantityOrdered) +
        parseDecimal(policy.quantityTolerance)
    ) {
      discrepancies.push({
        code: "quantity_exceeds_ordered",
        message: "Invoice quantity exceeds the purchase-order quantity.",
        invoiceLineIndex,
        purchaseOrderLineId: poLine.id,
        expected: poLine.quantityOrdered,
        actual: invoiceLine.quantity,
      });
    }
    if (input.receivingRecords.length > 0) {
      const availableReceived =
        (received.get(poLine.id) ?? 0n) -
        parseDecimal(input.previouslyInvoiced[poLine.id] ?? "0");
      if (
        policy.requireReceivingRecords &&
        parseDecimal(invoiceLine.quantity) >
          availableReceived + parseDecimal(policy.quantityTolerance)
      ) {
        discrepancies.push({
          code: "quantity_exceeds_received_unbilled",
          message:
            "Invoice quantity exceeds received, previously unbilled quantity.",
          invoiceLineIndex,
          purchaseOrderLineId: poLine.id,
          expected: formatDecimal(
            availableReceived > 0n ? availableReceived : 0n,
          ),
          actual: invoiceLine.quantity,
        });
      }
    }
    const calculatedAmount = multiplyDecimal(
      parseDecimal(invoiceLine.quantity),
      parseDecimal(invoiceLine.unitPrice),
    );
    if (
      decimalAbsolute(calculatedAmount - parseDecimal(invoiceLine.amount)) > 50n
    ) {
      discrepancies.push({
        code: "invoice_math_mismatch",
        message:
          "Invoice line quantity and unit price do not equal its amount.",
        invoiceLineIndex,
        expected: formatDecimal(calculatedAmount),
        actual: invoiceLine.amount,
      });
    }
  });

  const lineTotal = invoice.lines.reduce(
    (sum, line) => sum + parseDecimal(line.amount),
    0n,
  );
  const subtotal =
    invoice.subtotal === null ? lineTotal : parseDecimal(invoice.subtotal);
  const tax = parseDecimal(invoice.tax ?? "0");
  const freight = parseDecimal(invoice.freight ?? "0");
  if (
    decimalAbsolute(lineTotal - subtotal) > 50n ||
    decimalAbsolute(subtotal + tax + freight - parseDecimal(invoice.total)) >
      50n
  ) {
    discrepancies.push({
      code: "invoice_math_mismatch",
      message:
        "Invoice line, subtotal, charge, and total arithmetic does not reconcile.",
    });
  }
  if (
    !policy.allowUnrepresentedCharges &&
    (decimalAbsolute(tax) > 50n || decimalAbsolute(freight) > 50n)
  ) {
    discrepancies.push({
      code: "unsupported_charge",
      message: "Tax or freight is not represented by a purchase-order line.",
    });
  }

  return discrepancies;
}
