import { describe, expect, it, vi } from "vitest";

import type { PurchaseOrder } from "@/server/accounting/service";
import {
  buildVendorEmailFacts,
  renderVendorEmailText,
  type InvoiceExtractor,
  type InvoiceLineMatcher,
  type VendorEmailComposer,
} from "@/server/reconciliation/model-services";
import type { ExtractedInvoice } from "@/server/reconciliation/types";
import { createReconciliationEvalTarget } from "../../evals/reconciliation/target";

function invoice(input: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    invoiceNumber: "INV-ACME-1001",
    invoiceDate: "2026-06-09",
    dueDate: "2026-07-09",
    purchaseOrderNumber: "PO-1001",
    vendor: {
      name: "Acme Industrial Supply, Inc.",
      vendorNumber: "V-100",
      taxId: "12-3456789",
      email: "ar@acme.example",
    },
    currency: "USD",
    lines: [
      {
        sourceLineNumber: 1,
        purchaseOrderLineNumber: 1,
        description: "Steel fasteners",
        quantity: "10.0000",
        unitPrice: "5.2500",
        amount: "52.5000",
        evidence: [{ page: 1, text: "Steel fasteners" }],
        confidence: 0.99,
      },
      {
        sourceLineNumber: 2,
        purchaseOrderLineNumber: 2,
        description: "Protective gloves",
        quantity: "4.0000",
        unitPrice: "12.5000",
        amount: "50.0000",
        evidence: [{ page: 1, text: "Protective gloves" }],
        confidence: 0.99,
      },
    ],
    subtotal: "102.5000",
    tax: "0.0000",
    freight: null,
    total: "102.5000",
    evidence: [{ page: 1, text: "Invoice INV-ACME-1001" }],
    warnings: [],
    confidence: 0.99,
    ...input,
  };
}

function lineMatcher(): InvoiceLineMatcher {
  return {
    async match({ invoiceLines, purchaseOrder }: {
      invoiceLines: ExtractedInvoice["lines"];
      purchaseOrder: PurchaseOrder;
    }) {
      return invoiceLines.map((_, index) => ({
        invoiceLineIndex: index,
        purchaseOrderLineId: purchaseOrder.lines[index]!.id,
        method: "line_number" as const,
        confidence: 1,
        reason: "Deterministic eval-target test match.",
      }));
    },
  };
}

function emailComposer(): VendorEmailComposer {
  return {
    async compose(input) {
      const facts = buildVendorEmailFacts(input);
      return {
        intent: input.intent,
        facts,
        draft: {
          to: input.vendor.apEmail ? [input.vendor.apEmail] : [],
          cc: [],
          subject: "Invoice reconciliation",
          text: renderVendorEmailText({
            opening: "We reviewed this invoice.",
            request: "Please provide the requested information.",
            facts,
          }),
        },
      };
    },
  };
}

function targetFor(extraction: ExtractedInvoice) {
  const extractor: InvoiceExtractor = {
    modelName: "test-model",
    extract: vi.fn().mockResolvedValue(extraction),
  };
  return createReconciliationEvalTarget({
    modelServices: {
      extractor,
      lineMatcher: lineMatcher(),
      emailComposer: emailComposer(),
    },
    loadAttachment: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  });
}

const attachmentConfig = {
  attachments: {
    invoice: {
      presigned_url: "https://example.test/invoice.pdf",
      mime_type: "application/pdf",
    },
  },
};

describe("reconciliation eval target", () => {
  it("normalizes a payment review without resuming into payment", async () => {
    const output = await targetFor(invoice())(
      { caseId: "acme-po-1001-exact", policyVersion: "strict-three-way-v1" },
      attachmentConfig,
    );
    expect(output).toMatchObject({
      extraction: { invoiceNumber: "INV-ACME-1001", lineCount: 2 },
      decision: {
        reviewKind: "payment",
        selectedVendorNumber: "V-100",
        selectedPurchaseOrderNumber: "PO-1001",
        discrepancyCodes: [],
        emailIntent: null,
      },
      email: null,
    });
  });

  it("normalizes a discrepancy email review", async () => {
    const partial = invoice({
      invoiceNumber: "A-88421",
      purchaseOrderNumber: "PO-1002",
      vendor: {
        name: "Acme Industrial Supply, Inc.",
        vendorNumber: null,
        taxId: null,
        email: "invoices@acme.example",
      },
      lines: [{
        sourceLineNumber: null,
        purchaseOrderLineNumber: null,
        description: "Shop towels",
        quantity: "20.0000",
        unitPrice: "3.0000",
        amount: "60.0000",
        evidence: [],
        confidence: 0.99,
      }],
      subtotal: "60.0000",
      total: "60.0000",
    });
    const output = await targetFor(partial)(
      { caseId: "acme-po-1002-partial-receipt", policyVersion: "strict-three-way-v1" },
      attachmentConfig,
    );
    expect(output).toMatchObject({
      decision: {
        reviewKind: "email",
        discrepancyCodes: ["quantity_exceeds_received_unbilled"],
        emailIntent: "discrepancy",
        recipientState: "present",
      },
      email: { intent: "discrepancy" },
    });
  });

  it("normalizes an extraction exception review", async () => {
    const ambiguous = invoice({
      invoiceNumber: "GENERIC-7721",
      purchaseOrderNumber: "PO-SHARED",
      vendor: { name: null, vendorNumber: null, taxId: null, email: null },
      lines: [invoice().lines[0]!],
      subtotal: "52.5000",
      total: "52.5000",
    });
    const output = await targetFor(ambiguous)(
      { caseId: "po-shared-ambiguous-vendor", policyVersion: "strict-three-way-v1" },
      attachmentConfig,
    );
    expect(output.decision).toMatchObject({
      reviewKind: "exception",
      selectedVendorNumber: null,
      selectedPurchaseOrderNumber: null,
      emailIntent: null,
    });
  });

  it("requires the PDF attachment", async () => {
    await expect(
      targetFor(invoice())(
        { caseId: "acme-po-1001-exact", policyVersion: "strict-three-way-v1" },
      ),
    ).rejects.toThrow("no invoice attachment");
  });
});

