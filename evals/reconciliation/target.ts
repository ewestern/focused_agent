import { MemorySaver } from "@langchain/langgraph";

import {
  compileInvoiceReconciliationGraph,
  type ReconciliationGraphState,
  type ReconciliationServices,
} from "@/server/agent/graph";
import type { DocumentStore } from "@/server/documents/store";
import type { EmailService } from "@/server/email/service";
import type {
  InvoiceExtractor,
  InvoiceLineMatcher,
  VendorEmailComposer,
} from "@/server/reconciliation/model-services";
import {
  createAgentChatModel,
  LangChainInvoiceExtractor,
  LangChainInvoiceLineMatcher,
  LangChainVendorEmailComposer,
} from "@/server/reconciliation/model-services";
import { DEFAULT_RECONCILIATION_POLICY } from "@/server/reconciliation/policy";
import type { InvoiceSubmission } from "@/lib/contracts";
import { FixtureAccountingService } from "./fixture-services";
import { getReconciliationEvalCase } from "./cases";
import {
  EvalActualOutputSchema,
  EvalInputSchema,
  RECONCILIATION_EVAL_ATTACHMENT,
  type EvalActualOutput,
  type EvalInput,
} from "./schemas";

type AttachmentInfo = {
  presigned_url: string;
  mime_type?: string;
};

export type ReconciliationEvalTargetConfig = {
  attachments?: Record<string, AttachmentInfo>;
};

export type ReconciliationEvalModelServices = {
  extractor: InvoiceExtractor;
  lineMatcher: InvoiceLineMatcher;
  emailComposer: VendorEmailComposer;
};

type TargetOptions = {
  modelServices?: ReconciliationEvalModelServices;
  loadAttachment?: (attachment: AttachmentInfo) => Promise<Uint8Array>;
};

async function loadAttachment(attachment: AttachmentInfo): Promise<Uint8Array> {
  if (attachment.mime_type && attachment.mime_type !== "application/pdf") {
    throw new Error(`Expected a PDF eval attachment; received ${attachment.mime_type}.`);
  }
  const response = await fetch(attachment.presigned_url);
  if (!response.ok) {
    throw new Error(`Could not fetch eval invoice attachment: HTTP ${response.status}.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function createModelServices(): ReconciliationEvalModelServices {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const modelName = process.env.AGENT_MODEL?.trim() ?? "";
  if (!modelName) throw new Error("AGENT_MODEL is required to run reconciliation evals.");
  const model = createAgentChatModel({ OPENAI_API_KEY: apiKey, AGENT_MODEL: modelName });
  return {
    extractor: new LangChainInvoiceExtractor(model, modelName),
    lineMatcher: new LangChainInvoiceLineMatcher(model),
    emailComposer: new LangChainVendorEmailComposer(model),
  };
}

function createDocumentStore(bytes: Uint8Array, objectKey: string): DocumentStore {
  return {
    async get(key) {
      if (key !== objectKey) throw new Error(`Unexpected eval document key: ${key}`);
      return bytes;
    },
    async put() {
      throw new Error("Eval safety violation: document persistence was reached.");
    },
    async delete() {
      throw new Error("Eval safety violation: document deletion was reached.");
    },
    async ensureReady() {},
    async isHealthy() {
      return true;
    },
  };
}

function createSubmissionRepository(input: {
  submissionId: string;
  documentId: string;
  objectKey: string;
  filename: string;
  bytes: Uint8Array;
}): ReconciliationServices["submissions"] {
  const submission: InvoiceSubmission = {
    id: input.submissionId,
    status: "received",
    failureCode: null,
    failureMessage: null,
    receivedAt: "2026-07-21T00:00:00.000Z",
    createdAt: "2026-07-21T00:00:00.000Z",
    documents: [{
      id: input.documentId,
      originalFilename: input.filename,
      contentType: "application/pdf",
      byteSize: input.bytes.byteLength,
      sha256: "eval-attachment",
    }],
    reconciliationId: null,
  };
  return {
    async getForProcessing(id) {
      if (id !== input.submissionId) return null;
      return {
        submission,
        documents: [{
          id: input.documentId,
          objectKey: input.objectKey,
          originalFilename: input.filename,
          contentType: "application/pdf",
        }],
      };
    },
  };
}

function createEmailGuard(): EmailService {
  return {
    async send() {
      throw new Error("Eval safety violation: email delivery was reached.");
    },
    async isHealthy() {
      return true;
    },
  };
}

function createEmailDeliveryGuard(): ReconciliationServices["emailDeliveries"] {
  return {
    async begin() {
      throw new Error("Eval safety violation: email delivery ledger was reached.");
    },
    async finish() {
      throw new Error("Eval safety violation: email delivery ledger was reached.");
    },
  };
}

function normalizeState(state: ReconciliationGraphState): EvalActualOutput {
  if (!state.extraction || !state.pendingReview) {
    throw new Error("Reconciliation eval did not stop at a review interrupt.");
  }
  const vendorEmail = state.vendorEmail;
  return EvalActualOutputSchema.parse({
    extraction: {
      invoiceNumber: state.extraction.invoiceNumber,
      vendorNumber: state.extraction.vendor.vendorNumber,
      purchaseOrderNumber: state.extraction.purchaseOrderNumber,
      currency: state.extraction.currency,
      lineCount: state.extraction.lines.length,
    },
    decision: {
      reviewKind: state.pendingReview.kind,
      selectedVendorNumber: state.selectedVendor?.vendorNumber ?? null,
      selectedPurchaseOrderNumber: state.selectedPurchaseOrder?.poNumber ?? null,
      discrepancyCodes: (state.discrepancies ?? [])
        .map((discrepancy) => discrepancy.code)
        .sort(),
      emailIntent: vendorEmail?.intent ?? null,
      recipientState: vendorEmail
        ? vendorEmail.draft.to.length > 0 ? "present" : "missing"
        : null,
    },
    email: vendorEmail
      ? {
          intent: vendorEmail.intent,
          to: vendorEmail.draft.to,
          cc: vendorEmail.draft.cc,
          subject: vendorEmail.draft.subject,
          text: vendorEmail.draft.text,
          facts: vendorEmail.facts,
        }
      : null,
  });
}

export function createReconciliationEvalTarget(options: TargetOptions = {}) {
  const modelServices = options.modelServices ?? createModelServices();
  const readAttachment = options.loadAttachment ?? loadAttachment;
  const graph = compileInvoiceReconciliationGraph({ checkpointer: new MemorySaver() });

  return async function reconciliationEvalTarget(
    rawInputs: EvalInput,
    config?: ReconciliationEvalTargetConfig,
  ): Promise<EvalActualOutput> {
    const inputs = EvalInputSchema.parse(rawInputs);
    if (inputs.policyVersion !== DEFAULT_RECONCILIATION_POLICY.version) {
      throw new Error(`Unsupported eval policy version: ${inputs.policyVersion}`);
    }
    const evalCase = getReconciliationEvalCase(inputs.caseId);
    const attachment = config?.attachments?.[RECONCILIATION_EVAL_ATTACHMENT];
    if (!attachment) throw new Error("The LangSmith example has no invoice attachment.");
    const bytes = await readAttachment(attachment);
    if (bytes.byteLength === 0) throw new Error("The eval invoice attachment is empty.");

    const reconciliationId = crypto.randomUUID();
    const submissionId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const objectKey = `evals/${reconciliationId}/invoice.pdf`;
    const services: ReconciliationServices = {
      accounting: new FixtureAccountingService(evalCase),
      documents: createDocumentStore(bytes, objectKey),
      submissions: createSubmissionRepository({
        submissionId,
        documentId,
        objectKey,
        filename: evalCase.sourcePdf,
        bytes,
      }),
      ...modelServices,
      email: createEmailGuard(),
      emailDeliveries: createEmailDeliveryGuard(),
      emailFrom: "reconciliation-eval@example.test",
    };

    const state = await graph.invoke(
      {
        reconciliationId,
        submissionId,
        effectivePolicy: DEFAULT_RECONCILIATION_POLICY,
      },
      {
        configurable: { thread_id: reconciliationId },
        context: { services },
      },
    );
    return normalizeState(state);
  };
}

