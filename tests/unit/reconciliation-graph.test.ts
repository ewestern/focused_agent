import { Command, isInterrupted, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import {
  compileInvoiceReconciliationGraph,
  type ReconciliationServices,
} from "@/server/agent/graph";
import type { AccountingService, Payment } from "@/server/accounting/service";
import type { DocumentStore } from "@/server/documents/store";
import type { EmailService } from "@/server/email/service";
import type { InvoiceSubmissionRepository } from "@/server/invoices/postgres-repository";
import type {
  DisputeEmailComposer,
  InvoiceExtractor,
  InvoiceLineMatcher,
} from "@/server/reconciliation/model-services";
import { DEFAULT_RECONCILIATION_POLICY } from "@/server/reconciliation/policy";
import type { ReconciliationRepository } from "@/server/reconciliation/repository";
import type { ExtractedInvoice, ReviewRequest } from "@/server/reconciliation/types";

const reconciliationId = "00000000-0000-4000-8000-000000000010";
const submissionId = "00000000-0000-4000-8000-000000000011";
const vendorId = "00000000-0000-4000-8000-000000000012";
const poId = "00000000-0000-4000-8000-000000000013";
const lineId = "00000000-0000-4000-8000-000000000014";

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
  lines: [{
    sourceLineNumber: 1,
    purchaseOrderLineNumber: 1,
    description: "Industrial gloves",
    quantity: "2.0000",
    unitPrice: "12.5000",
    amount: "25.0000",
    evidence: [{ page: 1, text: "2 gloves at 12.50" }],
    confidence: 0.99,
  }],
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
    const transition = vi.fn().mockResolvedValue(undefined);
    const review: ReviewRequest = {
      reviewId: "00000000-0000-4000-8000-000000000030",
      reconciliationId,
      kind: "payment",
      title: "Approve invoice payment",
      summary: "The invoice passed policy.",
      payload: {
        extraction: null,
        vendor: null,
        purchaseOrder: null,
        receivingRecords: [],
        lineMatches: [],
        discrepancies: [],
      },
      requestedVersion: 2,
    };
    const accounting = {
      findPurchaseOrder: vi.fn().mockResolvedValue({
        status: "found",
        value: {
          id: poId,
          poNumber: "PO-1001",
          vendorId,
          status: "open",
          currency: "USD",
          orderedAt: "2026-07-01",
          closedAt: null,
          lines: [{
            id: lineId,
            lineNumber: 1,
            description: "Industrial gloves",
            quantityOrdered: "10.0000",
            unitPrice: "12.5000",
          }],
        },
      }),
      findVendorCandidates: vi.fn().mockResolvedValue([{
        id: vendorId,
        vendorNumber: "V-1",
        legalName: "Acme Industrial LLC",
        displayName: "Acme Industrial",
        taxId: null,
        apEmail: "billing@acme.example",
        matchedOn: ["vendorNumber"],
      }]),
      getReceivingRecords: vi.fn().mockResolvedValue([{
        id: "00000000-0000-4000-8000-000000000040",
        purchaseOrderId: poId,
        receiptNumber: "RR-1",
        receivedAt: "2026-07-09",
        lines: [{
          id: "00000000-0000-4000-8000-000000000041",
          purchaseOrderLineId: lineId,
          quantityReceived: "10.0000",
        }],
      }]),
      getInvoicedQuantities: vi.fn().mockResolvedValue([]),
      getInvoice: vi.fn().mockResolvedValue(null),
      remitPayment,
      getVendor: vi.fn(),
      searchPurchaseOrders: vi.fn(),
    } as unknown as AccountingService;
    const services: ReconciliationServices = {
      accounting,
      documents: { get: vi.fn().mockResolvedValue(new Uint8Array([1])) } as unknown as DocumentStore,
      submissions: {
        getForProcessing: vi.fn().mockResolvedValue({
          submission: { status: "received" },
          documents: [{
            id: "00000000-0000-4000-8000-000000000050",
            objectKey: "invoice.pdf",
            originalFilename: "invoice.pdf",
            contentType: "application/pdf",
          }],
        }),
      } as unknown as InvoiceSubmissionRepository,
      reconciliations: {
        getCore: vi.fn().mockResolvedValue({
          submissionId,
          startedAt: null,
          effectivePolicy: DEFAULT_RECONCILIATION_POLICY,
        }),
        update: vi.fn().mockResolvedValue(undefined),
        transition,
        createReview: vi.fn().mockResolvedValue(review),
      } as unknown as ReconciliationRepository,
      extractor: {
        modelName: "test-model",
        extract: vi.fn().mockResolvedValue(extraction),
      } as InvoiceExtractor,
      lineMatcher: {
        match: vi.fn().mockResolvedValue([{
          invoiceLineIndex: 0,
          purchaseOrderLineId: lineId,
          method: "line_number",
          confidence: 1,
          reason: "Exact line number.",
        }]),
      } as InvoiceLineMatcher,
      emailComposer: { compose: vi.fn() } as unknown as DisputeEmailComposer,
      email: { send: vi.fn(), isHealthy: vi.fn() } as unknown as EmailService,
      emailFrom: "reconciliation@example.test",
    };
    const graph = compileInvoiceReconciliationGraph({ checkpointer: new MemorySaver() });
    const config = {
      configurable: { thread_id: reconciliationId },
      context: { services },
    };

    const interrupted = await graph.invoke({ reconciliationId }, config);

    expect(isInterrupted(interrupted)).toBe(true);
    expect(remitPayment).not.toHaveBeenCalled();

    const completed = await graph.invoke(
      new Command({
        resume: {
          reviewId: review.reviewId,
          kind: "payment",
          action: "approve_payment",
        },
      }) as never,
      config,
    );

    expect(completed.terminal).toBe("payment_submitted");
    expect(remitPayment).toHaveBeenCalledOnce();
    expect(transition).toHaveBeenCalledWith(
      reconciliationId,
      expect.objectContaining({ status: "payment_submitted" }),
      "payment.submitted",
      payment,
    );
  });
});
