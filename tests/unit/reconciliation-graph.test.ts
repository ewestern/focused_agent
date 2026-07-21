import { Command, isInterrupted, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import {
  compileInvoiceReconciliationGraph,
  type ReconciliationDependencies,
} from "@/server/agent/graph";
import type {
  AccountingService,
  Payment,
  PurchaseOrder,
  ReceivingRecord,
  VendorCandidate,
} from "@/server/accounting/service";
import type { DocumentStore } from "@/server/documents/store";
import type { EmailDeliveryRepository } from "@/server/email/delivery";
import type { EmailService } from "@/server/email/service";
import type { InvoiceSubmissionRepository } from "@/server/invoices/postgres-repository";
import type {
  InvoiceExtractionLlm,
  InvoiceLineMatchingLlm,
  VendorEmailDraftingLlm,
} from "@/server/reconciliation/model-services";
import { DEFAULT_RECONCILIATION_POLICY } from "@/server/reconciliation/policy";
import type {
  ExtractedInvoice,
  ReviewRequest,
} from "@/server/reconciliation/types";

const reconciliationId = "00000000-0000-4000-8000-000000000010";
const submissionId = "00000000-0000-4000-8000-000000000011";
const vendorId = "00000000-0000-4000-8000-000000000012";
const poId = "00000000-0000-4000-8000-000000000013";
const lineId = "00000000-0000-4000-8000-000000000014";

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
      id: lineId,
      lineNumber: 1,
      description: "Industrial gloves",
      quantityOrdered: "10.0000",
      unitPrice: "12.5000",
    },
  ],
};

const vendor: VendorCandidate = {
  id: vendorId,
  vendorNumber: "V-1",
  legalName: "Acme Industrial LLC",
  displayName: "Acme Industrial",
  taxId: null,
  apEmail: "billing@acme.example",
  matchedOn: ["vendorNumber"],
};

const fullReceipt: ReceivingRecord = {
  id: "00000000-0000-4000-8000-000000000040",
  purchaseOrderId: poId,
  receiptNumber: "RR-1",
  receivedAt: "2026-07-09",
  lines: [
    {
      id: "00000000-0000-4000-8000-000000000041",
      purchaseOrderLineId: lineId,
      quantityReceived: "10.0000",
    },
  ],
};

const extraction: ExtractedInvoice = {
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
      quantity: "2.0000",
      unitPrice: "12.5000",
      amount: "25.0000",
      evidence: [{ page: 1, text: "2 gloves at 12.50" }],
      confidence: 0.99,
    },
  ],
  subtotal: "25.0000",
  tax: "0.0000",
  freight: "0.0000",
  total: "25.0000",
  evidence: [{ page: 1, text: "Invoice INV-1001" }],
  warnings: [],
  confidence: 0.99,
};

describe("invoice reconciliation graph execution", () => {
  it("interrupts before payment and remits only after explicit approval", async () => {
    const payment: Payment = {
      id: "00000000-0000-4000-8000-000000000020",
      accountingInvoiceId: "00000000-0000-4000-8000-000000000021",
      reconciliationId,
      idempotencyKey: reconciliationId,
      status: "submitted",
      amount: "25.0000",
      currency: "USD",
      dueDate: "2026-08-09",
      submittedAt: "2026-07-20T18:00:00.000Z",
    };
    const remitPayment = vi.fn().mockResolvedValue(payment);
    const dependencies = createDependencies({ remitPayment });
    const graph = compileInvoiceReconciliationGraph({
      checkpointer: new MemorySaver(),
    });
    const config = {
      configurable: { thread_id: reconciliationId },
      context: dependencies,
    };

    const interrupted = await graph.invoke(
      {
        reconciliationId,
        submissionId,
        effectivePolicy: DEFAULT_RECONCILIATION_POLICY,
      },
      config,
    );

    expect(isInterrupted(interrupted)).toBe(true);
    expect(remitPayment).not.toHaveBeenCalled();
    expect(dependencies.llm.invoiceLineMatching.invoke).not.toHaveBeenCalled();
    const review = interrupted.pendingReview as ReviewRequest;
    expect(review).toMatchObject({ kind: "payment", reconciliationId });

    const completed = await graph.invoke(
      new Command({
        resume: {
          decision: {
            reviewId: review.reviewId,
            kind: "payment",
            action: "approve_payment",
          },
          reviewedBy: "test-reviewer",
          decidedAt: "2026-07-21T18:00:00.000Z",
        },
      }) as never,
      config,
    );

    expect(completed.terminal).toBe("payment_submitted");
    expect(remitPayment).toHaveBeenCalledOnce();
    expect(completed.reviewResolution).toMatchObject({
      reviewedBy: "test-reviewer",
    });
  });

  it("requests receipt proof without calling missing evidence a discrepancy", async () => {
    const draftEmail = vi.fn().mockResolvedValue(emailFraming());
    const dependencies = createDependencies({
      receivingRecords: [],
      draftEmail,
    });
    const graph = compileInvoiceReconciliationGraph({
      checkpointer: new MemorySaver(),
    });

    const interrupted = await graph.invoke(
      {
        reconciliationId,
        submissionId,
        effectivePolicy: DEFAULT_RECONCILIATION_POLICY,
      },
      {
        configurable: { thread_id: reconciliationId },
        context: dependencies,
      },
    );

    expect(isInterrupted(interrupted)).toBe(true);
    expect(interrupted.discrepancies).toEqual([]);
    expect(interrupted.vendorEmail).toMatchObject({
      intent: "receipt_proof_request",
    });
    expect(interrupted.pendingReview).toMatchObject({
      kind: "email",
      title: "Review receipt proof request",
      payload: {
        email: { intent: "receipt_proof_request" },
        discrepancies: [],
      },
    });
    expect(draftEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "receipt_proof_request",
        facts: expect.objectContaining({
          receivingEvidence: "missing",
          discrepancies: [],
        }),
      }),
    );
  });

  it("uses one discrepancy email when a missing receipt accompanies another mismatch", async () => {
    const draftEmail = vi.fn().mockResolvedValue(emailFraming());
    const mismatchedExtraction = {
      ...extraction,
      lines: [
        {
          ...extraction.lines[0]!,
          unitPrice: "13.0000",
          amount: "26.0000",
        },
      ],
      subtotal: "26.0000",
      total: "26.0000",
    };
    const dependencies = createDependencies({
      extraction: mismatchedExtraction,
      receivingRecords: [],
      draftEmail,
    });
    const graph = compileInvoiceReconciliationGraph({
      checkpointer: new MemorySaver(),
    });

    const interrupted = await graph.invoke(
      {
        reconciliationId,
        submissionId,
        effectivePolicy: DEFAULT_RECONCILIATION_POLICY,
      },
      {
        configurable: { thread_id: reconciliationId },
        context: dependencies,
      },
    );

    expect(interrupted.pendingReview).toMatchObject({
      kind: "email",
      title: "Review discrepancy email",
    });
    expect(draftEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "discrepancy",
        facts: expect.objectContaining({
          discrepancies: [
            expect.objectContaining({ code: "unit_price_mismatch" }),
          ],
        }),
      }),
    );
  });

  it("invokes line-matching LLM only for unresolved invoice lines", async () => {
    const unresolvedExtraction: ExtractedInvoice = {
      ...extraction,
      lines: [
        {
          ...extraction.lines[0]!,
          purchaseOrderLineNumber: null,
          description: "Protective handwear",
        },
      ],
    };
    const matchInvoiceLines = vi.fn().mockResolvedValue([
      {
        invoiceLineIndex: 0,
        purchaseOrderLineId: lineId,
        method: "model",
        confidence: 0.95,
        reason: "Equivalent product description.",
      },
    ]);
    const graph = compileInvoiceReconciliationGraph({
      checkpointer: new MemorySaver(),
    });

    await graph.invoke(
      {
        reconciliationId,
        submissionId,
        effectivePolicy: DEFAULT_RECONCILIATION_POLICY,
      },
      {
        configurable: { thread_id: reconciliationId },
        context: createDependencies({
          extraction: unresolvedExtraction,
          matchInvoiceLines,
        }),
      },
    );

    expect(matchInvoiceLines).toHaveBeenCalledOnce();
    expect(matchInvoiceLines).toHaveBeenCalledWith({
      invoiceLines: [
        { invoiceLineIndex: 0, invoiceLine: unresolvedExtraction.lines[0] },
      ],
      purchaseOrderLines: purchaseOrder.lines,
    });
  });
});

function createDependencies(
  input: {
    extraction?: ExtractedInvoice;
    receivingRecords?: ReceivingRecord[];
    remitPayment?: ReturnType<typeof vi.fn>;
    draftEmail?: ReturnType<typeof vi.fn>;
    matchInvoiceLines?: ReturnType<typeof vi.fn>;
  } = {},
): ReconciliationDependencies {
  const accounting = {
    findPurchaseOrder: vi
      .fn()
      .mockResolvedValue({ status: "found", value: purchaseOrder }),
    findVendorCandidates: vi.fn().mockResolvedValue([vendor]),
    getReceivingRecords: vi
      .fn()
      .mockResolvedValue(input.receivingRecords ?? [fullReceipt]),
    getInvoicedQuantities: vi.fn().mockResolvedValue([]),
    getInvoice: vi.fn().mockResolvedValue(null),
    remitPayment: input.remitPayment ?? vi.fn(),
    getVendor: vi.fn(),
    searchPurchaseOrders: vi.fn(),
  } as unknown as AccountingService;
  return {
    api: {
      accounting,
      documents: {
        get: vi.fn().mockResolvedValue(new Uint8Array([1])),
      } as unknown as DocumentStore,
      submissions: {
        getForProcessing: vi.fn().mockResolvedValue({
          submission: { status: "received" },
          documents: [
            {
              id: "00000000-0000-4000-8000-000000000050",
              objectKey: "invoice.pdf",
              originalFilename: "invoice.pdf",
              contentType: "application/pdf",
            },
          ],
        }),
      } as unknown as InvoiceSubmissionRepository,
      email: { send: vi.fn(), isHealthy: vi.fn() } as unknown as EmailService,
      emailDeliveries: {} as EmailDeliveryRepository,
    },
    llm: {
      invoiceExtraction: {
        modelName: "test-model",
        invoke: vi.fn().mockResolvedValue(input.extraction ?? extraction),
      } as InvoiceExtractionLlm,
      invoiceLineMatching: {
        invoke: input.matchInvoiceLines ?? vi.fn(),
      } as InvoiceLineMatchingLlm,
      vendorEmailDrafting: {
        invoke: input.draftEmail ?? vi.fn(),
      } as VendorEmailDraftingLlm,
    },
    config: { emailFrom: "reconciliation@example.test" },
  };
}

function emailFraming() {
  return {
    subject: "Invoice review",
    opening: "We are reviewing this invoice.",
    request: "Please review the reconciliation details.",
  };
}
