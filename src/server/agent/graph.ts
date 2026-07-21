import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { Runtime } from "@langchain/langgraph";
import { z } from "zod";

import { RemittanceConflictError } from "@/server/accounting/service";
import type {
  AccountingService,
  LookupResult,
  Payment,
  PurchaseOrder,
  PurchaseOrderSemanticMatch,
  ReceivingRecord,
  Vendor,
  VendorCandidate,
} from "@/server/accounting/service";
import type { DocumentStore } from "@/server/documents/store";
import type { EmailDeliveryRepository } from "@/server/email/delivery";
import type { EmailService } from "@/server/email/service";
import type { InvoiceSubmissionRepository } from "@/server/invoices/postgres-repository";
import { matchInvoiceLinesDeterministically } from "@/server/reconciliation/line-matching";
import type {
  InvoiceExtractionLlm,
  InvoiceLineMatchingLlm,
  VendorEmailDraftingLlm,
} from "@/server/reconciliation/model-services";
import {
  assembleVendorEmail,
  buildVendorEmailFacts,
} from "@/server/reconciliation/model-services";
import {
  evaluateReconciliationPolicy,
  ReconciliationPolicySchema,
  type ReconciliationPolicy,
} from "@/server/reconciliation/policy";
import {
  EmailReviewDecisionSchema,
  ExceptionReviewDecisionSchema,
  PaymentReviewDecisionSchema,
  ReviewResolutionSchema,
  type CreateReviewInput,
  type ExtractedInvoice,
  type InvoiceLineMatch,
  type PolicyDiscrepancy,
  type ReviewRequest,
  type ReviewResolution,
  type VendorEmail,
} from "@/server/reconciliation/types";

export type ReconciliationApi = {
  accounting: AccountingService;
  documents: DocumentStore;
  submissions: Pick<InvoiceSubmissionRepository, "getForProcessing">;
  email: EmailService;
  emailDeliveries: Pick<EmailDeliveryRepository, "begin" | "finish">;
};

export type ReconciliationLlm = {
  invoiceExtraction: InvoiceExtractionLlm;
  invoiceLineMatching: InvoiceLineMatchingLlm;
  vendorEmailDrafting: VendorEmailDraftingLlm;
};

export type ReconciliationConfig = {
  emailFrom: string;
};

export type ReconciliationDependencies = {
  api: ReconciliationApi;
  llm: ReconciliationLlm;
  config: ReconciliationConfig;
};

const ReconciliationContextSchema = z.object({
  api: z.custom<ReconciliationApi>(),
  llm: z.custom<ReconciliationLlm>(),
  config: z.custom<ReconciliationConfig>(),
});

const ReconciliationState = Annotation.Root({
  reconciliationId: Annotation<string>(),
  submissionId: Annotation<string | undefined>(),
  effectivePolicy: Annotation<ReconciliationPolicy | undefined>(),
  extractionModel: Annotation<string | undefined>(),
  extraction: Annotation<ExtractedInvoice | undefined>(),
  poLookup: Annotation<LookupResult<PurchaseOrder> | undefined>(),
  vendorCandidates: Annotation<VendorCandidate[] | undefined>(),
  purchaseOrderCandidates: Annotation<
    PurchaseOrderSemanticMatch[] | undefined
  >(),
  selectedVendor: Annotation<Vendor | undefined>(),
  selectedPurchaseOrder: Annotation<PurchaseOrder | undefined>(),
  receivingRecords: Annotation<ReceivingRecord[] | undefined>(),
  previouslyInvoiced: Annotation<Record<string, string> | undefined>(),
  duplicateInvoice: Annotation<boolean | undefined>(),
  lineMatches: Annotation<InvoiceLineMatch[] | undefined>(),
  discrepancies: Annotation<PolicyDiscrepancy[] | undefined>(),
  pendingReview: Annotation<ReviewRequest | undefined>(),
  reviewResolution: Annotation<ReviewResolution | undefined>(),
  vendorEmail: Annotation<VendorEmail | undefined>(),
  payment: Annotation<Payment | undefined>(),
  humanDisputeReason: Annotation<string | undefined>(),
  terminal: Annotation<
    "cancelled" | "payment_submitted" | "email_sent" | undefined
  >(),
});

export type ReconciliationGraphState = typeof ReconciliationState.State;
type AgentState = ReconciliationGraphState;
type AgentRuntime = Runtime<z.infer<typeof ReconciliationContextSchema>>;

function dependencies(runtime: AgentRuntime): ReconciliationDependencies {
  const value = runtime.context;
  if (!value) {
    throw new Error(
      "Reconciliation dependencies were not supplied to the graph.",
    );
  }
  return value;
}

function policy(state: AgentState): ReconciliationPolicy {
  if (!state.effectivePolicy) {
    throw new Error(
      "The persisted reconciliation policy is missing from graph state.",
    );
  }
  return state.effectivePolicy;
}

function createReview(input: CreateReviewInput): ReviewRequest {
  const common = {
    reviewId: crypto.randomUUID(),
    reconciliationId: input.reconciliationId,
    title: input.title,
    summary: input.summary,
  };
  switch (input.kind) {
    case "exception":
      return { ...common, kind: input.kind, payload: input.payload };
    case "payment":
      return { ...common, kind: input.kind, payload: input.payload };
    case "email":
      return { ...common, kind: input.kind, payload: input.payload };
  }
}

function cancelReconciliation(resolution: ReviewResolution) {
  return {
    reviewResolution: resolution,
    pendingReview: undefined,
    terminal: "cancelled" as const,
  };
}

async function prepareExceptionReview(
  state: AgentState,
  summary: string,
  issues: string[],
): Promise<ReviewRequest> {
  return createReview({
    reconciliationId: state.reconciliationId,
    kind: "exception",
    title: "Reconciliation needs attention",
    summary,
    payload: {
      issues,
      extraction: state.extraction ?? null,
      vendorCandidates: state.vendorCandidates ?? [],
      purchaseOrderCandidates: state.purchaseOrderCandidates ?? [],
      exactPurchaseOrderCandidates:
        state.poLookup?.status === "ambiguous" ? state.poLookup.matches : [],
      lineMatches: state.lineMatches ?? [],
    },
  });
}

async function loadSubmissionNode(state: AgentState, runtime: AgentRuntime) {
  const { api } = dependencies(runtime);
  if (!state.submissionId || !state.effectivePolicy) {
    throw new Error("Reconciliation bootstrap state is missing.");
  }
  const source = await api.submissions.getForProcessing(state.submissionId);
  if (
    !source ||
    source.submission.status !== "received" ||
    source.documents.length !== 1
  ) {
    throw new Error("Reconciliation requires one received invoice document.");
  }
  return {};
}

async function extractInvoiceNode(state: AgentState, runtime: AgentRuntime) {
  const { api, llm } = dependencies(runtime);
  const effectivePolicy = policy(state);
  if (!state.submissionId)
    throw new Error("Submission ID is missing from graph state.");
  const source = await api.submissions.getForProcessing(state.submissionId);
  const document = source?.documents[0];
  if (!document) throw new Error("Invoice document was not found.");
  const bytes = await api.documents.get(document.objectKey);
  const extraction = await llm.invoiceExtraction.invoke({
    bytes,
    filename: document.originalFilename,
    contentType: document.contentType,
  });
  const missing: string[] = [];
  if (!extraction.invoiceNumber) missing.push("invoice number");
  if (
    !extraction.vendor.name &&
    !extraction.vendor.vendorNumber &&
    !extraction.vendor.taxId
  ) {
    missing.push("vendor identity");
  }
  if (!extraction.currency) missing.push("currency");
  if (extraction.confidence < effectivePolicy.extractionConfidenceMinimum) {
    missing.push(
      `confidence below ${effectivePolicy.extractionConfidenceMinimum}`,
    );
  }
  if (missing.length === 0) {
    return {
      extraction,
      extractionModel: llm.invoiceExtraction.modelName,
      pendingReview: undefined,
    };
  }
  const nextState = { ...state, extraction };
  const pendingReview = await prepareExceptionReview(
    nextState,
    "The extracted invoice is incomplete or uncertain.",
    missing,
  );
  return {
    extraction,
    extractionModel: llm.invoiceExtraction.modelName,
    pendingReview,
  };
}

async function lookupPurchaseOrderNode(
  state: AgentState,
  runtime: AgentRuntime,
) {
  const { api } = dependencies(runtime);
  const poNumber = state.extraction?.purchaseOrderNumber;
  const poLookup = poNumber
    ? await api.accounting.findPurchaseOrder({ poNumber })
    : ({ status: "not_found" } as const);
  return { poLookup, purchaseOrderCandidates: [], pendingReview: undefined };
}

async function matchVendorNode(state: AgentState, runtime: AgentRuntime) {
  const { api } = dependencies(runtime);
  if (!state.extraction) throw new Error("Invoice extraction is missing.");
  const vendorCandidates = await api.accounting.findVendorCandidates({
    vendorNumber: state.extraction.vendor.vendorNumber ?? undefined,
    taxId: state.extraction.vendor.taxId ?? undefined,
    email: state.extraction.vendor.email ?? undefined,
    name: state.extraction.vendor.name ?? undefined,
  });
  return { vendorCandidates };
}

async function resolveMatchesNode(state: AgentState, runtime: AgentRuntime) {
  const { api } = dependencies(runtime);
  const vendorCandidates = state.vendorCandidates ?? [];
  if (vendorCandidates.length !== 1) {
    const pendingReview = await prepareExceptionReview(
      state,
      vendorCandidates.length === 0
        ? "No vendor matched the invoice identity."
        : "More than one vendor matched the invoice identity.",
      [vendorCandidates.length === 0 ? "vendor not found" : "vendor ambiguous"],
    );
    return { pendingReview };
  }
  const selectedVendor = vendorCandidates[0];
  let selectedPurchaseOrder: PurchaseOrder | undefined;
  if (state.poLookup?.status === "found") {
    selectedPurchaseOrder = state.poLookup.value;
  } else if (
    state.poLookup?.status === "ambiguous" &&
    state.extraction?.purchaseOrderNumber
  ) {
    const narrowed = await api.accounting.findPurchaseOrder({
      poNumber: state.extraction.purchaseOrderNumber,
      vendorId: selectedVendor.id,
    });
    if (narrowed.status === "found") selectedPurchaseOrder = narrowed.value;
  }
  if (selectedPurchaseOrder) {
    return { selectedVendor, selectedPurchaseOrder, pendingReview: undefined };
  }

  if (!state.extraction) throw new Error("Invoice extraction is missing.");
  const query = [
    state.extraction.purchaseOrderNumber,
    state.extraction.vendor.name,
    ...state.extraction.lines.map((line) => line.description),
  ]
    .filter(Boolean)
    .join(" | ");
  const purchaseOrderCandidates = await api.accounting.searchPurchaseOrders({
    query,
    vendorId: selectedVendor.id,
    statuses: ["open"],
    currency: state.extraction.currency ?? undefined,
    limit: 5,
  });
  const reviewState = { ...state, selectedVendor, purchaseOrderCandidates };
  const pendingReview = await prepareExceptionReview(
    reviewState,
    "Exact PO resolution failed; semantic candidates require human selection.",
    [
      purchaseOrderCandidates.length
        ? "semantic PO candidate"
        : "purchase order not found",
    ],
  );
  return { selectedVendor, purchaseOrderCandidates, pendingReview };
}

async function exceptionReviewNode(state: AgentState, runtime: AgentRuntime) {
  const { api } = dependencies(runtime);
  if (!state.pendingReview || state.pendingReview.kind !== "exception") {
    throw new Error("Exception review state is missing.");
  }
  const resolution = ReviewResolutionSchema.parse(
    interrupt(state.pendingReview),
  );
  const decision = ExceptionReviewDecisionSchema.parse(resolution.decision);
  if (decision.action === "cancel") {
    return cancelReconciliation(resolution);
  }

  const extraction = decision.extraction ?? state.extraction;
  const selectedVendor = decision.vendorId
    ? ((state.vendorCandidates ?? []).find(
        (candidate) => candidate.id === decision.vendorId,
      ) ??
      (await api.accounting.getVendor(decision.vendorId)) ??
      undefined)
    : state.selectedVendor;
  const selectedPurchaseOrder = decision.purchaseOrderId
    ? [
        ...(state.poLookup?.status === "found" ? [state.poLookup.value] : []),
        ...(state.poLookup?.status === "ambiguous"
          ? state.poLookup.matches
          : []),
        ...(state.purchaseOrderCandidates ?? []).map(
          (candidate) => candidate.purchaseOrder,
        ),
      ].find((candidate) => candidate.id === decision.purchaseOrderId)
    : (state.selectedPurchaseOrder ??
      (state.poLookup?.status === "found" &&
      (!selectedVendor || state.poLookup.value.vendorId === selectedVendor.id)
        ? state.poLookup.value
        : undefined));
  return {
    extraction,
    selectedVendor,
    selectedPurchaseOrder,
    lineMatches: decision.lineMatches ?? state.lineMatches,
    reviewResolution: resolution,
    pendingReview: undefined,
  };
}

async function loadEvidenceNode(state: AgentState, runtime: AgentRuntime) {
  const { api } = dependencies(runtime);
  if (
    !state.selectedPurchaseOrder ||
    !state.selectedVendor ||
    !state.extraction?.invoiceNumber
  ) {
    throw new Error(
      "Resolved invoice, vendor, and purchase order are required.",
    );
  }
  const [receivingRecords, invoiced, duplicate] = await Promise.all([
    api.accounting.getReceivingRecords(state.selectedPurchaseOrder.id),
    api.accounting.getInvoicedQuantities(state.selectedPurchaseOrder.id),
    api.accounting.getInvoice({
      vendorId: state.selectedVendor.id,
      invoiceNumber: state.extraction.invoiceNumber,
    }),
  ]);
  const previouslyInvoiced = Object.fromEntries(
    invoiced.map((row) => [row.purchaseOrderLineId, row.quantityInvoiced]),
  );
  return {
    receivingRecords,
    previouslyInvoiced,
    duplicateInvoice: duplicate !== null,
  };
}

async function matchLinesNode(state: AgentState, runtime: AgentRuntime) {
  const { llm } = dependencies(runtime);
  const effectivePolicy = policy(state);
  if (!state.extraction || !state.selectedPurchaseOrder) {
    throw new Error(
      "Invoice and purchase order are required for line matching.",
    );
  }
  const suppliedLineMatches = state.lineMatches?.length
    ? state.lineMatches
    : undefined;
  let lineMatches =
    suppliedLineMatches ??
    matchInvoiceLinesDeterministically({
      invoiceLines: state.extraction.lines,
      purchaseOrderLines: state.selectedPurchaseOrder.lines,
    });
  const matchedInvoiceLineIndexes = new Set(
    lineMatches.map((match) => match.invoiceLineIndex),
  );
  const usedPurchaseOrderLineIds = new Set(
    lineMatches.map((match) => match.purchaseOrderLineId),
  );
  const unresolvedInvoiceLines = state.extraction.lines
    .map((invoiceLine, invoiceLineIndex) => ({
      invoiceLine,
      invoiceLineIndex,
    }))
    .filter(
      ({ invoiceLineIndex }) =>
        !matchedInvoiceLineIndexes.has(invoiceLineIndex),
    );
  if (suppliedLineMatches === undefined && unresolvedInvoiceLines.length > 0) {
    const modelMatches = await llm.invoiceLineMatching.invoke({
      invoiceLines: unresolvedInvoiceLines,
      purchaseOrderLines: state.selectedPurchaseOrder.lines.filter(
        (line) => !usedPurchaseOrderLineIds.has(line.id),
      ),
    });
    lineMatches = [...lineMatches, ...modelMatches].sort(
      (left, right) => left.invoiceLineIndex - right.invoiceLineIndex,
    );
  }
  const ambiguous = lineMatches.filter(
    (match) => match.confidence < effectivePolicy.lineMatchConfidenceMinimum,
  );
  const unmapped = state.extraction.lines.length - lineMatches.length;
  if (ambiguous.length === 0 && unmapped === 0) return { lineMatches };
  const reviewState = { ...state, lineMatches };
  const pendingReview = await prepareExceptionReview(
    reviewState,
    "One or more invoice lines need human mapping.",
    [
      ...(unmapped ? [`${unmapped} unmapped line(s)`] : []),
      ...(ambiguous.length
        ? [`${ambiguous.length} low-confidence line match(es)`]
        : []),
    ],
  );
  return { lineMatches, pendingReview };
}

async function evaluatePolicyNode(state: AgentState) {
  if (
    !state.extraction ||
    !state.selectedVendor ||
    !state.selectedPurchaseOrder ||
    !state.receivingRecords ||
    !state.lineMatches
  ) {
    throw new Error("Reconciliation evidence is incomplete.");
  }
  const discrepancies = evaluateReconciliationPolicy({
    policy: policy(state),
    invoice: state.extraction,
    vendor: state.selectedVendor,
    purchaseOrder: state.selectedPurchaseOrder,
    receivingRecords: state.receivingRecords,
    lineMatches: state.lineMatches,
    previouslyInvoiced: state.previouslyInvoiced ?? {},
    duplicateInvoice: state.duplicateInvoice ?? false,
  });
  return { discrepancies };
}

async function preparePaymentReviewNode(state: AgentState) {
  const pendingReview = createReview({
    reconciliationId: state.reconciliationId,
    kind: "payment",
    title: "Approve invoice payment",
    summary:
      "The invoice passed the configured three-way reconciliation policy.",
    payload: {
      extraction: state.extraction ?? null,
      vendor: state.selectedVendor ?? null,
      purchaseOrder: state.selectedPurchaseOrder ?? null,
      receivingRecords: state.receivingRecords ?? [],
      lineMatches: state.lineMatches ?? [],
      discrepancies: [],
    },
  });
  return { pendingReview };
}

async function paymentReviewNode(state: AgentState) {
  if (!state.pendingReview || state.pendingReview.kind !== "payment") {
    throw new Error("Payment review state is missing.");
  }
  const resolution = ReviewResolutionSchema.parse(
    interrupt(state.pendingReview),
  );
  const decision = PaymentReviewDecisionSchema.parse(resolution.decision);
  if (decision.action === "cancel") {
    return cancelReconciliation(resolution);
  }
  return {
    reviewResolution: resolution,
    pendingReview: undefined,
    humanDisputeReason:
      decision.action === "route_to_dispute" ? decision.reason : undefined,
  };
}

function isRequiredReceiptMissing(state: AgentState): boolean {
  return (
    policy(state).requireReceivingRecords &&
    state.receivingRecords?.length === 0
  );
}

async function composeVendorEmailNode(
  state: AgentState,
  runtime: AgentRuntime,
) {
  const { llm } = dependencies(runtime);
  if (
    !state.extraction ||
    !state.selectedVendor ||
    !state.selectedPurchaseOrder ||
    !state.receivingRecords ||
    !state.lineMatches
  ) {
    throw new Error(
      "Resolved reconciliation context is required to compose vendor email.",
    );
  }
  const discrepancies = state.discrepancies ?? [];
  const additionalReasons = state.humanDisputeReason
    ? [state.humanDisputeReason]
    : [];
  const receiptMissing = isRequiredReceiptMissing(state);
  if (!discrepancies.length && !additionalReasons.length && !receiptMissing) {
    throw new Error(
      "A discrepancy, reviewer concern, or missing receipt is required.",
    );
  }
  const intent =
    discrepancies.length || additionalReasons.length
      ? ("discrepancy" as const)
      : ("receipt_proof_request" as const);
  const emailInput = {
    intent,
    invoice: state.extraction,
    vendor: state.selectedVendor,
    purchaseOrder: state.selectedPurchaseOrder,
    receivingRecords: state.receivingRecords,
    previouslyInvoiced: state.previouslyInvoiced ?? {},
    lineMatches: state.lineMatches,
    discrepancies,
    additionalReasons,
    requireReceivingRecords: policy(state).requireReceivingRecords,
  };
  const facts = buildVendorEmailFacts(emailInput);
  const framing = await llm.vendorEmailDrafting.invoke({
    intent,
    vendorName:
      state.extraction.vendor.name ?? state.selectedVendor.displayName,
    facts,
  });
  const vendorEmail = assembleVendorEmail({
    intent,
    invoice: state.extraction,
    vendor: state.selectedVendor,
    facts,
    framing,
  });
  const pendingReview = createReview({
    reconciliationId: state.reconciliationId,
    kind: "email",
    title:
      intent === "receipt_proof_request"
        ? "Review receipt proof request"
        : "Review discrepancy email",
    summary: vendorEmail.draft.to.length
      ? "Review and send the proposed vendor email."
      : "Add a recipient before sending the proposed vendor email.",
    payload: { email: vendorEmail, discrepancies },
  });
  return { vendorEmail, discrepancies, pendingReview };
}

async function emailReviewNode(state: AgentState) {
  if (!state.pendingReview || state.pendingReview.kind !== "email") {
    throw new Error("Email review state is missing.");
  }
  const resolution = ReviewResolutionSchema.parse(
    interrupt(state.pendingReview),
  );
  const decision = EmailReviewDecisionSchema.parse(resolution.decision);
  if (decision.action === "cancel") {
    return cancelReconciliation(resolution);
  }
  if (!decision.draft.to.length)
    throw new Error("A vendor email recipient is required.");
  if (!state.vendorEmail) throw new Error("Vendor email context is missing.");
  return {
    reviewResolution: resolution,
    pendingReview: undefined,
    vendorEmail: { ...state.vendorEmail, draft: decision.draft },
  };
}

async function remitPaymentNode(state: AgentState, runtime: AgentRuntime) {
  const { api } = dependencies(runtime);
  const extraction = state.extraction;
  if (
    !extraction?.invoiceNumber ||
    !extraction.currency ||
    !state.selectedVendor ||
    !state.selectedPurchaseOrder ||
    !state.lineMatches
  ) {
    throw new Error("Payment context is incomplete.");
  }
  try {
    const payment = await api.accounting.remitPayment({
      reconciliationId: state.reconciliationId,
      idempotencyKey: state.reconciliationId,
      vendorId: state.selectedVendor.id,
      purchaseOrderId: state.selectedPurchaseOrder.id,
      invoiceNumber: extraction.invoiceNumber,
      invoiceDate: extraction.invoiceDate,
      dueDate: extraction.dueDate,
      currency: extraction.currency,
      amount: extraction.total,
      lines: state.lineMatches.map((match) => {
        const line = extraction.lines[match.invoiceLineIndex];
        if (!line) {
          throw new Error(`Invoice line ${match.invoiceLineIndex} is missing.`);
        }
        return {
          sourceLineNumber: line.sourceLineNumber,
          purchaseOrderLineId: match.purchaseOrderLineId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          amount: line.amount,
        };
      }),
    });
    return { payment, terminal: "payment_submitted" as const };
  } catch (error) {
    if (!(error instanceof RemittanceConflictError)) throw error;
    const pendingReview = await prepareExceptionReview(
      state,
      "Accounting data changed after payment approval.",
      [error.message],
    );
    return { pendingReview };
  }
}

async function sendEmailNode(state: AgentState, runtime: AgentRuntime) {
  const { api, config } = dependencies(runtime);
  if (!state.vendorEmail) throw new Error("Approved vendor email is missing.");
  const emailDraft = state.vendorEmail.draft;
  const ledger = await api.emailDeliveries.begin(
    state.reconciliationId,
    emailDraft,
  );
  if (ledger.status === "sent") return { terminal: "email_sent" as const };
  if (!ledger.created && ledger.status === "sending") {
    await api.emailDeliveries.finish({
      reconciliationId: state.reconciliationId,
      status: "uncertain",
      failureMessage:
        "A prior send attempt did not record a provider result; automatic resend was suppressed.",
    });
    throw new Error(
      "Email outcome is uncertain; automatic resend was suppressed.",
    );
  }
  if (ledger.status !== "sending") {
    throw new Error(
      `Email delivery is ${ledger.status} and requires manual review.`,
    );
  }
  try {
    const result = await api.email.send({
      from: config.emailFrom,
      ...emailDraft,
    });
    await api.emailDeliveries.finish({
      reconciliationId: state.reconciliationId,
      status: "sent",
      providerMessageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
    });
    return { terminal: "email_sent" as const };
  } catch (error) {
    await api.emailDeliveries.finish({
      reconciliationId: state.reconciliationId,
      status: "uncertain",
      failureMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function afterExtraction(state: AgentState) {
  return state.pendingReview ? "exception_review" : "lookup_purchase_order";
}

function afterResolution(state: AgentState) {
  return state.pendingReview ? "exception_review" : "load_evidence";
}

function afterExceptionReview(state: AgentState) {
  if (state.terminal) return END;
  if (state.selectedVendor && state.selectedPurchaseOrder) {
    return state.receivingRecords && state.lineMatches
      ? "evaluate_policy"
      : "load_evidence";
  }
  return "lookup_purchase_order";
}

function afterLineMatching(state: AgentState) {
  return state.pendingReview ? "exception_review" : "evaluate_policy";
}

function afterPolicy(state: AgentState) {
  return state.discrepancies?.length || isRequiredReceiptMissing(state)
    ? "compose_vendor_email"
    : "prepare_payment_review";
}

function afterPaymentReview(state: AgentState) {
  if (state.terminal) return END;
  const decision = state.reviewResolution?.decision;
  return decision?.kind === "payment" && decision.action === "approve_payment"
    ? "remit_payment"
    : "compose_vendor_email";
}

function afterEmailReview(state: AgentState) {
  return state.terminal ? END : "send_email";
}

function afterRemittance(state: AgentState) {
  return state.pendingReview ? "exception_review" : END;
}

function nodeMetadata(
  llmUsage: "always" | "conditional" | "never",
  description?: string,
) {
  return {
    metadata: {
      llmUsage,
      ...(description ? { description } : {}),
    },
  };
}

export const invoiceReconciliationGraphDefinition = new StateGraph({
  state: ReconciliationState,
  input: z.object({
    reconciliationId: z.string().uuid(),
    submissionId: z.string().uuid(),
    effectivePolicy: ReconciliationPolicySchema,
  }),
  context: ReconciliationContextSchema,
})
  .addNode(
    "load_submission",
    loadSubmissionNode,
    nodeMetadata("never", "Load the invoice submission from the database."),
  )
  .addNode(
    "extract_invoice",
    extractInvoiceNode,
    nodeMetadata("always", "Extract the invoice from the document."),
  )
  .addNode(
    "lookup_purchase_order",
    lookupPurchaseOrderNode,
    nodeMetadata(
      "never",
      "Look up the purchase order from the database. Uses RAG.",
    ),
  )
  .addNode(
    "match_vendor",
    matchVendorNode,
    nodeMetadata("never", "Match the vendor to the invoice."),
  )
  .addNode(
    "resolve_matches",
    resolveMatchesNode,
    nodeMetadata(
      "never",
      "Select from among candidate purchase orders and vendors.",
    ),
  )
  .addNode(
    "exception_review",
    exceptionReviewNode,
    nodeMetadata(
      "never",
      "Review the invoice and purchase order matches for exceptions. Human-in-the-loop.",
    ),
  )
  .addNode(
    "load_evidence",
    loadEvidenceNode,
    nodeMetadata(
      "never",
      "For the selected PO, retrieve receiving records and prior invoice allocations.",
    ),
  )
  .addNode(
    "match_lines",
    matchLinesNode,
    nodeMetadata(
      "conditional",
      "Match the invoice lines to the purchase order lines.",
    ),
  )
  .addNode(
    "evaluate_policy",
    evaluatePolicyNode,
    nodeMetadata(
      "never",
      "Evaluate the reconciliation results against the policy.",
    ),
  )
  .addNode(
    "prepare_payment_review",
    preparePaymentReviewNode,
    nodeMetadata("never"),
  )
  .addNode(
    "payment_review",
    paymentReviewNode,
    nodeMetadata(
      "never",
      "Review the payment approval decision. Human-in-the-loop.",
    ),
  )
  .addNode(
    "compose_vendor_email",
    composeVendorEmailNode,
    nodeMetadata("always", "Compose a vendor email to the vendor."),
  )
  .addNode(
    "email_review",
    emailReviewNode,
    nodeMetadata("never", "Review the vendor email draft. Human-in-the-loop."),
  )
  .addNode(
    "remit_payment",
    remitPaymentNode,
    nodeMetadata("never", "Remit the payment to the vendor."),
  )
  .addNode(
    "send_email",
    sendEmailNode,
    nodeMetadata("never", "Send the vendor email to the vendor."),
  )
  .addEdge(START, "load_submission")
  .addEdge("load_submission", "extract_invoice")
  .addConditionalEdges("extract_invoice", afterExtraction, [
    "exception_review",
    "lookup_purchase_order",
  ])
  .addEdge("lookup_purchase_order", "match_vendor")
  .addEdge("match_vendor", "resolve_matches")
  .addConditionalEdges("resolve_matches", afterResolution, [
    "exception_review",
    "load_evidence",
  ])
  .addConditionalEdges("exception_review", afterExceptionReview, [
    "lookup_purchase_order",
    "load_evidence",
    "evaluate_policy",
    END,
  ])
  .addEdge("load_evidence", "match_lines")
  .addConditionalEdges("match_lines", afterLineMatching, [
    "exception_review",
    "evaluate_policy",
  ])
  .addConditionalEdges("evaluate_policy", afterPolicy, [
    "compose_vendor_email",
    "prepare_payment_review",
  ])
  .addEdge("prepare_payment_review", "payment_review")
  .addConditionalEdges("payment_review", afterPaymentReview, [
    "remit_payment",
    "compose_vendor_email",
    END,
  ])
  .addEdge("compose_vendor_email", "email_review")
  .addConditionalEdges("email_review", afterEmailReview, ["send_email", END])
  .addConditionalEdges("remit_payment", afterRemittance, [
    "exception_review",
    END,
  ])
  .addEdge("send_email", END);

/** Import this graph directly for topology inspection and Mermaid rendering. */
export const invoiceReconciliationGraph =
  invoiceReconciliationGraphDefinition.compile({
    name: "invoice-reconciliation",
  });

export function compileInvoiceReconciliationGraph(options: {
  checkpointer: BaseCheckpointSaver;
}) {
  return invoiceReconciliationGraphDefinition.compile({
    checkpointer: options.checkpointer,
    name: "invoice-reconciliation",
  });
}

export { Command };
