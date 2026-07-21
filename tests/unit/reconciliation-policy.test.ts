import { describe, expect, it } from "vitest";

import type {
  PurchaseOrder,
  ReceivingRecord,
  Vendor,
} from "@/server/accounting/service";
import {
  DEFAULT_RECONCILIATION_POLICY,
  evaluateReconciliationPolicy,
} from "@/server/reconciliation/policy";
import type {
  ExtractedInvoice,
  InvoiceLineMatch,
} from "@/server/reconciliation/types";

const vendorId = "00000000-0000-4000-8000-000000000001";
const poId = "00000000-0000-4000-8000-000000000002";
const poLineId = "00000000-0000-4000-8000-000000000003";

const vendor: Vendor = {
  id: vendorId,
  vendorNumber: "V-1",
  legalName: "Acme Industrial LLC",
  displayName: "Acme Industrial",
  taxId: "12-3456789",
  apEmail: "billing@acme.example",
};

const purchaseOrder: PurchaseOrder = {
  id: poId,
  poNumber: "PO-1001",
  vendorId,
  status: "open",
  currency: "USD",
  orderedAt: "2026-07-01",
  closedAt: null,
  lines: [
    {
      id: poLineId,
      lineNumber: 1,
      description: "Industrial gloves",
      quantityOrdered: "10.0000",
      unitPrice: "12.5000",
    },
  ],
};

const invoice: ExtractedInvoice = {
  invoiceNumber: "INV-1001",
  invoiceDate: "2026-07-10",
  dueDate: "2026-08-09",
  purchaseOrderNumber: "PO-1001",
  vendor: {
    name: "Acme Industrial",
    vendorNumber: "V-1",
    taxId: null,
    email: "billing@acme.example",
  },
  currency: "USD",
  lines: [
    {
      sourceLineNumber: 1,
      purchaseOrderLineNumber: 1,
      description: "Industrial gloves",
      quantity: "10.0000",
      unitPrice: "12.5000",
      amount: "125.0000",
      evidence: [{ page: 1, text: "10 Industrial gloves @ 12.50 = 125.00" }],
      confidence: 0.99,
    },
  ],
  subtotal: "125.0000",
  tax: "0.0000",
  freight: "0.0000",
  total: "125.0000",
  evidence: [{ page: 1, text: "Invoice INV-1001 Total 125.00" }],
  warnings: [],
  confidence: 0.99,
};

const receivingRecords: ReceivingRecord[] = [
  {
    id: "00000000-0000-4000-8000-000000000004",
    purchaseOrderId: poId,
    receiptNumber: "RR-1",
    receivedAt: "2026-07-09",
    lines: [
      {
        id: "00000000-0000-4000-8000-000000000005",
        purchaseOrderLineId: poLineId,
        quantityReceived: "10.0000",
      },
    ],
  },
];

const lineMatches: InvoiceLineMatch[] = [
  {
    invoiceLineIndex: 0,
    purchaseOrderLineId: poLineId,
    method: "line_number",
    confidence: 1,
    reason: "Exact line number.",
  },
];

function evaluate(
  overrides: Partial<Parameters<typeof evaluateReconciliationPolicy>[0]> = {},
) {
  return evaluateReconciliationPolicy({
    policy: DEFAULT_RECONCILIATION_POLICY,
    invoice,
    vendor,
    purchaseOrder,
    receivingRecords,
    lineMatches,
    previouslyInvoiced: {},
    duplicateInvoice: false,
    ...overrides,
  });
}

describe("strict three-way reconciliation policy", () => {
  it("passes an exact vendor, PO, receipt, price, quantity, and arithmetic match", () => {
    expect(evaluate()).toEqual([]);
  });

  it("accounts for prior allocations before approving received quantity", () => {
    expect(evaluate({ previouslyInvoiced: { [poLineId]: "0.0001" } })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "quantity_exceeds_received_unbilled" }),
      ]),
    );
  });

  it("distinguishes missing receiving evidence from a receipt quantity mismatch", () => {
    expect(evaluate({ receivingRecords: [] })).toEqual([]);

    const partialReceipt = [
      {
        ...receivingRecords[0]!,
        lines: [
          {
            ...receivingRecords[0]!.lines[0]!,
            quantityReceived: "5.0000",
          },
        ],
      },
    ];
    expect(evaluate({ receivingRecords: partialReceipt })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "quantity_exceeds_received_unbilled",
          expected: "5.0000",
          actual: "10.0000",
        }),
      ]),
    );
  });

  it("flags duplicate invoice numbers and unsupported charges", () => {
    expect(
      evaluate({
        duplicateInvoice: true,
        invoice: { ...invoice, tax: "1.0000", total: "126.0000" },
      }).map((item) => item.code),
    ).toEqual(["duplicate_invoice", "unsupported_charge"]);
  });
});
