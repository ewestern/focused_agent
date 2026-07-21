import { normalizeName } from "@/server/accounting/normalize";
import type { PurchaseOrderLine } from "@/server/accounting/service";
import type {
  ExtractedInvoiceLine,
  InvoiceLineMatch,
} from "@/server/reconciliation/types";

export function matchInvoiceLinesDeterministically(input: {
  invoiceLines: ExtractedInvoiceLine[];
  purchaseOrderLines: PurchaseOrderLine[];
}): InvoiceLineMatch[] {
  const matches: InvoiceLineMatch[] = [];
  const usedPurchaseOrderLineIds = new Set<string>();

  for (const [invoiceLineIndex, invoiceLine] of input.invoiceLines.entries()) {
    const byNumber =
      invoiceLine.purchaseOrderLineNumber === null
        ? undefined
        : input.purchaseOrderLines.find(
            (line) => line.lineNumber === invoiceLine.purchaseOrderLineNumber,
          );
    const byDescription = input.purchaseOrderLines.find(
      (line) =>
        normalizeName(line.description) ===
        normalizeName(invoiceLine.description),
    );
    const purchaseOrderLine = byNumber ?? byDescription;
    if (
      !purchaseOrderLine ||
      usedPurchaseOrderLineIds.has(purchaseOrderLine.id)
    ) {
      continue;
    }

    usedPurchaseOrderLineIds.add(purchaseOrderLine.id);
    matches.push({
      invoiceLineIndex,
      purchaseOrderLineId: purchaseOrderLine.id,
      method: byNumber ? "line_number" : "description",
      confidence: 1,
      reason: byNumber
        ? "Invoice supplied the exact purchase-order line number."
        : "Normalized descriptions match exactly.",
    });
  }

  return matches;
}
