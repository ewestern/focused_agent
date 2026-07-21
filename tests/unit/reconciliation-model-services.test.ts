import { describe, expect, it } from "vitest";

import type {
  PurchaseOrder,
  ReceivingRecord,
  Vendor,
} from "@/server/accounting/service";
import {
  buildVendorEmailFacts,
  renderVendorEmailText,
} from "@/server/reconciliation/model-services";
import type {
  ExtractedInvoice,
  InvoiceLineMatch,
  PolicyDiscrepancy,
} from "@/server/reconciliation/types";

const vendor: Vendor = {
  id: "00000000-0000-4000-8000-000000000201",
  vendorNumber: "V-200",
  legalName: "Northstar Office Products LLC",
  displayName: "Northstar",
  taxId: null,
  apEmail: "billing@northstar.example",
};

const purchaseOrder: PurchaseOrder = {
  id: "00000000-0000-4000-8000-000000000202",
  poNumber: "PO-1003",
  vendorId: vendor.id,
  status: "open",
  currency: "USD",
  orderedAt: "2026-06-10",
  closedAt: null,
  lines: [
    {
      id: "00000000-0000-4000-8000-000000000203",
      lineNumber: 1,
      description: "Copy paper",
      quantityOrdered: "25.0000",
      unitPrice: "7.5000",
    },
  ],
};

const invoice: ExtractedInvoice = {
  invoiceNumber: "NS-61003",
  invoiceDate: "2026-06-11",
  dueDate: "2026-07-11",
  purchaseOrderNumber: "PO-1003",
  vendor: {
    name: "Northstar",
    vendorNumber: "V-200",
    taxId: null,
    email: "billing@northstar.example",
  },
  currency: "USD",
  lines: [
    {
      sourceLineNumber: 1,
      purchaseOrderLineNumber: 1,
      description: "Copy paper",
      quantity: "25.0000",
      unitPrice: "7.5000",
      amount: "187.5000",
      evidence: [],
      confidence: 0.99,
    },
  ],
  subtotal: "187.5000",
  tax: "0.0000",
  freight: "0.0000",
  total: "187.5000",
  evidence: [],
  warnings: [],
  confidence: 0.99,
};

const lineMatches: InvoiceLineMatch[] = [
  {
    invoiceLineIndex: 0,
    purchaseOrderLineId: purchaseOrder.lines[0]!.id,
    method: "line_number",
    confidence: 1,
    reason: "Exact PO line number.",
  },
];

describe("vendor email reconciliation facts", () => {
  it("renders the no-receipt sample with exact figures and no false zero receipt", () => {
    const facts = buildVendorEmailFacts({
      intent: "receipt_proof_request",
      invoice,
      vendor,
      purchaseOrder,
      receivingRecords: [],
      previouslyInvoiced: {},
      lineMatches,
      discrepancies: [],
      additionalReasons: [],
      requireReceivingRecords: true,
    });
    const text = renderVendorEmailText({
      opening: "We are reviewing this invoice.",
      request: "Please send delivery or receipt evidence.",
      facts,
    });

    expect(facts).toMatchObject({
      receivingEvidence: "missing",
      invoiceNumber: "NS-61003",
      invoiceTotal: "187.5000",
    });
    expect(text).toContain("Invoice: NS-61003");
    expect(text).toContain("Purchase order: PO-1003");
    expect(text).toContain("Invoice total: 187.50 USD");
    expect(text).toContain(
      "Copy paper: invoiced 25 units at 7.50 USD each = 187.50 USD; PO ordered 25 units at 7.50 USD each; receiving record: none on file.",
    );
    expect(text).not.toContain("received 0");
  });

  it("includes received quantity and the unsupported difference for a mismatch", () => {
    const receipt: ReceivingRecord = {
      id: "00000000-0000-4000-8000-000000000204",
      purchaseOrderId: purchaseOrder.id,
      receiptNumber: "RCV-1003",
      receivedAt: "2026-06-12",
      lines: [
        {
          id: "00000000-0000-4000-8000-000000000205",
          purchaseOrderLineId: purchaseOrder.lines[0]!.id,
          quantityReceived: "8.0000",
        },
      ],
    };
    const discrepancies: PolicyDiscrepancy[] = [
      {
        code: "quantity_exceeds_received_unbilled",
        message:
          "Invoice quantity exceeds received, previously unbilled quantity.",
        invoiceLineIndex: 0,
        purchaseOrderLineId: purchaseOrder.lines[0]!.id,
        expected: "8.0000",
        actual: "25.0000",
      },
    ];
    const facts = buildVendorEmailFacts({
      intent: "discrepancy",
      invoice,
      vendor,
      purchaseOrder,
      receivingRecords: [receipt],
      previouslyInvoiced: {},
      lineMatches,
      discrepancies,
      additionalReasons: [],
      requireReceivingRecords: true,
    });
    const text = renderVendorEmailText({
      opening: "We found a quantity mismatch.",
      request: "Please review and correct the invoice.",
      facts,
    });

    expect(text).toContain("received and not previously invoiced: 8 units");
    expect(text).toContain("unsupported difference: 17 units");
    expect(text).toContain("expected: 8.0000; actual: 25.0000");
  });
});
