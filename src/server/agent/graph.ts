import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
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
import type { EmailService } from "@/server/email/service";
import type { InvoiceSubmissionRepository } from "@/server/invoices/postgres-repository";
import type {
  DisputeEmailComposer,
  InvoiceExtractor,
  InvoiceLineMatcher,
} from "@/server/reconciliation/model-services";
import {
  evaluateReconciliationPolicy,
  type ReconciliationPolicy,
} from "@/server/reconciliation/policy";
import type { ReconciliationRepository } from "@/server/reconciliation/repository";
import {
  EmailReviewDecisionSchema,
  ExceptionReviewDecisionSchema,
  PaymentReviewDecisionSchema,
  type EmailDraft,
  type ExtractedInvoice,
  type InvoiceLineMatch,
  type PolicyDiscrepancy,
  type ReviewDecision,
  type ReviewRequest,
} from "@/server/reconciliation/types";

export type ReconciliationServices = {
  accounting: AccountingService;
  documents: DocumentStore;
  submissions: InvoiceSubmissionRepository;
  reconciliations: ReconciliationRepository;
  extractor: InvoiceExtractor;
  lineMatcher: InvoiceLineMatcher;
  emailComposer: DisputeEmailComposer;
  email: EmailService;
  emailFrom: string;
};

const ReconciliationContextSchema = z.object({
  services: z.custom<ReconciliationServices>(),
});

const ReconciliationState = Annotation.Root({
  reconciliationId: Annotation<string>(),
  submissionId: Annotation<string | undefined>(),
  effectivePolicy: Annotation<ReconciliationPolicy | undefined>(),
  extraction: Annotation<ExtractedInvoice | undefined>(),
  poLookup: Annotation<LookupResult<PurchaseOrder> | undefined>(),
  vendorCandidates: Annotation<VendorCandidate[] | undefined>(),
  purchaseOrderCandidates: Annotation<PurchaseOrderSemanticMatch[] | undefined>(),
  selectedVendor: Annotation<Vendor | undefined>(),
  selectedPurchaseOrder: Annotation<PurchaseOrder | undefined>(),
  receivingRecords: Annotation<ReceivingRecord[] | undefined>(),
  previouslyInvoiced: Annotation<Record<string, string> | undefined>(),
  duplicateInvoice: Annotation<boolean | undefined>(),
  lineMatches: Annotation<InvoiceLineMatch[] | undefined>(),
  discrepancies: Annotation<PolicyDiscrepancy[] | undefined>(),
  pendingReview: Annotation<ReviewRequest | undefined>(),
  reviewDecision: Annotation<ReviewDecision | undefined>(),
  emailDraft: Annotation<EmailDraft | undefined>(),
  payment: Annotation<Payment | undefined>(),
  humanDisputeReason: Annotation<string | undefined>(),
  terminal: Annotation<"cancelled" | "payment_submitted" | "dispute_sent" | undefined>(),
});

type AgentState = typeof ReconciliationState.State;
type AgentRuntime = Runtime<z.infer<typeof ReconciliationContextSchema>>;

function services(runtime: AgentRuntime): ReconciliationServices {
  const value = runtime.context?.services;
  if (!value) throw new Error("Reconciliation services were not supplied to the graph.");
  return value;
}

function policy(state: AgentState): ReconciliationPolicy {
  if (!state.effectivePolicy) {
    throw new Error("The persisted reconciliation policy is missing from graph state.");
  }
  return state.effectivePolicy;
}

async function cancelReconciliation(
  state: AgentState,
  runtime: AgentRuntime,
  decision: ReviewDecision,
) {
  await services(runtime).reconciliations.transition(
    state.reconciliationId,
    { status: "cancelled", stage: "cancelled", completedAt: new Date() },
    "reconciliation.cancelled",
  );
  return {
    reviewDecision: decision,
    pendingReview: undefined,
    terminal: "cancelled" as const,
  };
}

async function prepareExceptionReview(
  state: AgentState,
  runtime: AgentRuntime,
  summary: string,
  issues: string[],
): Promise<ReviewRequest> {
  const api = services(runtime);
  return api.reconciliations.createReview({
    reconciliationId: state.reconciliationId,
    kind: "exception",
    title: "Reconciliation needs attention",
    summary,
    status: "awaiting_exception_review",
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
  const api = services(runtime);
  const reconciliation = await api.reconciliations.getCore(state.reconciliationId);
  if (!reconciliation) throw new Error("Reconciliation was not found.");
  const source = await api.submissions.getForProcessing(reconciliation.submissionId);
  if (!source || source.submission.status !== "received" || source.documents.length !== 1) {
    throw new Error("Reconciliation requires one received invoice document.");
  }
  await api.reconciliations.transition(
    state.reconciliationId,
    {
      status: "processing",
      stage: "load_submission",
      startedAt: reconciliation.startedAt ?? new Date(),
      failureCode: null,
      failureMessage: null,
    },
    "reconciliation.started",
  );
  return {
    submissionId: reconciliation.submissionId,
    effectivePolicy: reconciliation.effectivePolicy,
  };
}

async function extractInvoiceNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  const effectivePolicy = policy(state);
  if (!state.submissionId) throw new Error("Submission ID is missing from graph state.");
  const source = await api.submissions.getForProcessing(state.submissionId);
  const document = source?.documents[0];
  if (!document) throw new Error("Invoice document was not found.");
  const bytes = await api.documents.get(document.objectKey);
  const extraction = await api.extractor.extract({
    bytes,
    filename: document.originalFilename,
    contentType: document.contentType,
  });
  await api.reconciliations.transition(
    state.reconciliationId,
    {
      stage: "extract_invoice",
      extraction,
      extractionModel: api.extractor.modelName,
    },
    "invoice.extracted",
    { model: api.extractor.modelName, confidence: extraction.confidence },
  );
  const missing: string[] = [];
  if (!extraction.invoiceNumber) missing.push("invoice number");
  if (!extraction.vendor.name && !extraction.vendor.vendorNumber && !extraction.vendor.taxId) {
    missing.push("vendor identity");
  }
  if (!extraction.currency) missing.push("currency");
  if (extraction.confidence < effectivePolicy.extractionConfidenceMinimum) {
    missing.push(`confidence below ${effectivePolicy.extractionConfidenceMinimum}`);
  }
  if (missing.length === 0) return { extraction, pendingReview: undefined };
  const nextState = { ...state, extraction };
  const pendingReview = await prepareExceptionReview(
    nextState,
    runtime,
    "The extracted invoice is incomplete or uncertain.",
    missing,
  );
  return { extraction, pendingReview };
}

async function lookupPurchaseOrderNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  const poNumber = state.extraction?.purchaseOrderNumber;
  const poLookup = poNumber
    ? await api.accounting.findPurchaseOrder({ poNumber })
    : ({ status: "not_found" } as const);
  const candidates = poLookup.status === "ambiguous" ? poLookup.matches : [];
  await api.reconciliations.update(state.reconciliationId, {
    stage: "lookup_purchase_order",
    purchaseOrderCandidates: candidates,
  });
  return { poLookup, purchaseOrderCandidates: [], pendingReview: undefined };
}

async function matchVendorNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  if (!state.extraction) throw new Error("Invoice extraction is missing.");
  const vendorCandidates = await api.accounting.findVendorCandidates({
    vendorNumber: state.extraction.vendor.vendorNumber ?? undefined,
    taxId: state.extraction.vendor.taxId ?? undefined,
    email: state.extraction.vendor.email ?? undefined,
    name: state.extraction.vendor.name ?? undefined,
  });
  await api.reconciliations.update(state.reconciliationId, {
    stage: "match_vendor",
    vendorCandidates,
  });
  return { vendorCandidates };
}

async function resolveMatchesNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  const vendorCandidates = state.vendorCandidates ?? [];
  if (vendorCandidates.length !== 1) {
    const pendingReview = await prepareExceptionReview(
      state,
      runtime,
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
  } else if (state.poLookup?.status === "ambiguous" && state.extraction?.purchaseOrderNumber) {
    const narrowed = await api.accounting.findPurchaseOrder({
      poNumber: state.extraction.purchaseOrderNumber,
      vendorId: selectedVendor.id,
    });
    if (narrowed.status === "found") selectedPurchaseOrder = narrowed.value;
  }
  if (selectedPurchaseOrder) {
    await api.reconciliations.update(state.reconciliationId, {
      stage: "resolve_matches",
      selectedVendorId: selectedVendor.id,
      selectedPurchaseOrderId: selectedPurchaseOrder.id,
    });
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
  await api.reconciliations.update(state.reconciliationId, {
    selectedVendorId: selectedVendor.id,
    vendorCandidates,
    purchaseOrderCandidates,
  });
  const reviewState = { ...state, selectedVendor, purchaseOrderCandidates };
  const pendingReview = await prepareExceptionReview(
    reviewState,
    runtime,
    "Exact PO resolution failed; semantic candidates require human selection.",
    [purchaseOrderCandidates.length ? "semantic PO candidate" : "purchase order not found"],
  );
  return { selectedVendor, purchaseOrderCandidates, pendingReview };
}

async function exceptionReviewNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  if (!state.pendingReview || state.pendingReview.kind !== "exception") {
    throw new Error("Exception review state is missing.");
  }
  const decision = ExceptionReviewDecisionSchema.parse(
    interrupt(state.pendingReview),
  );
  if (decision.action === "cancel") {
    return cancelReconciliation(state, runtime, decision);
  }

  const extraction = decision.extraction ?? state.extraction;
  const selectedVendor = decision.vendorId
    ? (state.vendorCandidates ?? []).find((candidate) => candidate.id === decision.vendorId) ??
      (await api.accounting.getVendor(decision.vendorId)) ?? undefined
    : state.selectedVendor;
  const selectedPurchaseOrder = decision.purchaseOrderId
    ? [
        ...(state.poLookup?.status === "found" ? [state.poLookup.value] : []),
        ...(state.poLookup?.status === "ambiguous" ? state.poLookup.matches : []),
        ...(state.purchaseOrderCandidates ?? []).map((candidate) => candidate.purchaseOrder),
      ].find((candidate) => candidate.id === decision.purchaseOrderId)
    : state.selectedPurchaseOrder ??
      (state.poLookup?.status === "found" &&
      (!selectedVendor || state.poLookup.value.vendorId === selectedVendor.id)
        ? state.poLookup.value
        : undefined);
  await api.reconciliations.update(state.reconciliationId, {
    status: "processing",
    stage: "exception_resolved",
    extraction,
    selectedVendorId: selectedVendor?.id ?? null,
    selectedPurchaseOrderId: selectedPurchaseOrder?.id ?? null,
    lineMatches: decision.lineMatches ?? state.lineMatches ?? [],
  });
  return {
    extraction,
    selectedVendor,
    selectedPurchaseOrder,
    lineMatches: decision.lineMatches ?? state.lineMatches,
    reviewDecision: decision,
    pendingReview: undefined,
  };
}

async function loadEvidenceNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  if (!state.selectedPurchaseOrder || !state.selectedVendor || !state.extraction?.invoiceNumber) {
    throw new Error("Resolved invoice, vendor, and purchase order are required.");
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
  await api.reconciliations.update(state.reconciliationId, {
    stage: "load_receipts_and_history",
    receivingSnapshot: receivingRecords,
  });
  return { receivingRecords, previouslyInvoiced, duplicateInvoice: duplicate !== null };
}

async function matchLinesNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  const effectivePolicy = policy(state);
  if (!state.extraction || !state.selectedPurchaseOrder) {
    throw new Error("Invoice and purchase order are required for line matching.");
  }
  const lineMatches = state.lineMatches?.length
    ? state.lineMatches
    : await api.lineMatcher.match({
        invoiceLines: state.extraction.lines,
        purchaseOrder: state.selectedPurchaseOrder,
      });
  await api.reconciliations.update(state.reconciliationId, {
    stage: "match_lines",
    lineMatches,
  });
  const ambiguous = lineMatches.filter(
    (match) => match.confidence < effectivePolicy.lineMatchConfidenceMinimum,
  );
  const unmapped = state.extraction.lines.length - lineMatches.length;
  if (ambiguous.length === 0 && unmapped === 0) return { lineMatches };
  const reviewState = { ...state, lineMatches };
  const pendingReview = await prepareExceptionReview(
    reviewState,
    runtime,
    "One or more invoice lines need human mapping.",
    [
      ...(unmapped ? [`${unmapped} unmapped line(s)`] : []),
      ...(ambiguous.length ? [`${ambiguous.length} low-confidence line match(es)`] : []),
    ],
  );
  return { lineMatches, pendingReview };
}

async function evaluatePolicyNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
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
  await api.reconciliations.update(state.reconciliationId, {
    stage: "evaluate_policy",
    discrepancies,
  });
  return { discrepancies };
}

async function preparePaymentReviewNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  const pendingReview = await api.reconciliations.createReview({
    reconciliationId: state.reconciliationId,
    kind: "payment",
    title: "Approve invoice payment",
    summary: "The invoice passed the configured three-way reconciliation policy.",
    status: "awaiting_payment_approval",
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

async function paymentReviewNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  if (!state.pendingReview || state.pendingReview.kind !== "payment") {
    throw new Error("Payment review state is missing.");
  }
  const decision = PaymentReviewDecisionSchema.parse(interrupt(state.pendingReview));
  if (decision.action === "cancel") {
    return cancelReconciliation(state, runtime, decision);
  }
  await api.reconciliations.update(state.reconciliationId, {
    status: "processing",
    stage: decision.action === "approve_payment" ? "payment_approved" : "routed_to_dispute",
  });
  return {
    reviewDecision: decision,
    pendingReview: undefined,
    humanDisputeReason:
      decision.action === "route_to_dispute" ? decision.reason : undefined,
  };
}

async function composeDisputeNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  if (!state.extraction || !state.selectedVendor || !state.selectedPurchaseOrder) {
    throw new Error("Resolved invoice context is required to compose a dispute.");
  }
  const discrepancies = state.discrepancies ?? [];
  const reasons = discrepancies.map((discrepancy) => discrepancy.message);
  if (state.humanDisputeReason) reasons.push(state.humanDisputeReason);
  if (reasons.length === 0) {
    throw new Error("A policy discrepancy or reviewer dispute reason is required.");
  }
  const emailDraft = await api.emailComposer.compose({
    invoice: state.extraction,
    vendor: state.selectedVendor,
    purchaseOrder: state.selectedPurchaseOrder,
    reasons,
  });
  const pendingReview = await api.reconciliations.createReview({
    reconciliationId: state.reconciliationId,
    kind: "email",
    title: "Review dispute email",
    summary: emailDraft.to.length
      ? "Review and send the proposed vendor email."
      : "Add a recipient before sending the proposed vendor email.",
    status: "awaiting_email_approval",
    payload: { draft: emailDraft, discrepancies },
  });
  await api.reconciliations.update(state.reconciliationId, {
    emailDraft,
    discrepancies,
  });
  return { emailDraft, discrepancies, pendingReview };
}

async function emailReviewNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  if (!state.pendingReview || state.pendingReview.kind !== "email") {
    throw new Error("Email review state is missing.");
  }
  const decision = EmailReviewDecisionSchema.parse(interrupt(state.pendingReview));
  if (decision.action === "cancel") {
    return cancelReconciliation(state, runtime, decision);
  }
  const emailDraft = decision.draft;
  if (!emailDraft.to.length) throw new Error("A dispute email recipient is required.");
  await api.reconciliations.update(state.reconciliationId, {
    status: "processing",
    stage: "email_approved",
    emailDraft,
  });
  return { reviewDecision: decision, pendingReview: undefined, emailDraft };
}

async function remitPaymentNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
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
    await api.reconciliations.transition(
      state.reconciliationId,
      {
        status: "payment_submitted",
        stage: "payment_submitted",
        completedAt: new Date(),
      },
      "payment.submitted",
      payment,
    );
    return { payment, terminal: "payment_submitted" as const };
  } catch (error) {
    if (!(error instanceof RemittanceConflictError)) throw error;
    const pendingReview = await prepareExceptionReview(
      state,
      runtime,
      "Accounting data changed after payment approval.",
      [error.message],
    );
    return { pendingReview };
  }
}

async function sendEmailNode(state: AgentState, runtime: AgentRuntime) {
  const api = services(runtime);
  if (!state.emailDraft) throw new Error("Approved email draft is missing.");
  const ledger = await api.reconciliations.beginEmailDelivery(
    state.reconciliationId,
    state.emailDraft,
  );
  if (ledger.status === "sent") return { terminal: "dispute_sent" as const };
  if (!ledger.created && ledger.status === "sending") {
    await api.reconciliations.finishEmailDelivery({
      reconciliationId: state.reconciliationId,
      status: "uncertain",
      failureMessage:
        "A prior send attempt did not record a provider result; automatic resend was suppressed.",
    });
    throw new Error("Email outcome is uncertain; automatic resend was suppressed.");
  }
  if (ledger.status !== "sending") {
    throw new Error(`Email delivery is ${ledger.status} and requires manual review.`);
  }
  try {
    const result = await api.email.send({
      from: api.emailFrom,
      ...state.emailDraft,
    });
    await api.reconciliations.finishEmailDelivery({
      reconciliationId: state.reconciliationId,
      status: "sent",
      providerMessageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
    });
    await api.reconciliations.transition(
      state.reconciliationId,
      { status: "dispute_sent", stage: "dispute_sent", completedAt: new Date() },
      "email.sent",
      result,
    );
    return { terminal: "dispute_sent" as const };
  } catch (error) {
    await api.reconciliations.finishEmailDelivery({
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
    return state.receivingRecords && state.lineMatches ? "evaluate_policy" : "load_evidence";
  }
  return "lookup_purchase_order";
}

function afterLineMatching(state: AgentState) {
  return state.pendingReview ? "exception_review" : "evaluate_policy";
}

function afterPolicy(state: AgentState) {
  return state.discrepancies?.length ? "compose_dispute" : "prepare_payment_review";
}

function afterPaymentReview(state: AgentState) {
  if (state.terminal) return END;
  return state.reviewDecision?.kind === "payment" &&
    state.reviewDecision.action === "approve_payment"
    ? "remit_payment"
    : "compose_dispute";
}

function afterEmailReview(state: AgentState) {
  return state.terminal ? END : "send_email";
}

function afterRemittance(state: AgentState) {
  return state.pendingReview ? "exception_review" : END;
}

export const invoiceReconciliationGraphDefinition = new StateGraph({
  state: ReconciliationState,
  input: z.object({ reconciliationId: z.string().uuid() }),
  context: ReconciliationContextSchema,
})
  .addNode("load_submission", loadSubmissionNode)
  .addNode("extract_invoice", extractInvoiceNode)
  .addNode("lookup_purchase_order", lookupPurchaseOrderNode)
  .addNode("match_vendor", matchVendorNode)
  .addNode("resolve_matches", resolveMatchesNode)
  .addNode("exception_review", exceptionReviewNode)
  .addNode("load_evidence", loadEvidenceNode)
  .addNode("match_lines", matchLinesNode)
  .addNode("evaluate_policy", evaluatePolicyNode)
  .addNode("prepare_payment_review", preparePaymentReviewNode)
  .addNode("payment_review", paymentReviewNode)
  .addNode("compose_dispute", composeDisputeNode)
  .addNode("email_review", emailReviewNode)
  .addNode("remit_payment", remitPaymentNode)
  .addNode("send_email", sendEmailNode)
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
    "compose_dispute",
    "prepare_payment_review",
  ])
  .addEdge("prepare_payment_review", "payment_review")
  .addConditionalEdges("payment_review", afterPaymentReview, [
    "remit_payment",
    "compose_dispute",
    END,
  ])
  .addEdge("compose_dispute", "email_review")
  .addConditionalEdges("email_review", afterEmailReview, ["send_email", END])
  .addConditionalEdges("remit_payment", afterRemittance, ["exception_review", END])
  .addEdge("send_email", END);

/** Import this graph directly for topology inspection and Mermaid rendering. */
export const invoiceReconciliationGraph = invoiceReconciliationGraphDefinition.compile({
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
