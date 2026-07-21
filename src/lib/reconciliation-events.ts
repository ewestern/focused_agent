import { z } from "zod";

export const ReconciliationProgressStageSchema = z.enum([
  "load_submission",
  "extract_invoice",
  "lookup_purchase_order",
  "match_vendor",
  "resolve_matches",
  "load_evidence",
  "match_lines",
  "evaluate_policy",
  "prepare_payment_review",
  "compose_vendor_email",
  "remit_payment",
  "send_email",
]);

export type ReconciliationProgressStage = z.infer<
  typeof ReconciliationProgressStageSchema
>;

export const ReconciliationReviewKindSchema = z.enum([
  "exception",
  "payment",
  "email",
]);

export const ReconciliationTerminalStatusSchema = z.enum([
  "payment_submitted",
  "email_sent",
  "cancelled",
]);

const EventIdentitySchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  reconciliationId: z.string().uuid(),
  occurredAt: z.iso.datetime(),
});

const RunLifecycleEventSchema = EventIdentitySchema.extend({
  kind: z.enum(["run.started", "run.resumed", "run.retrying", "run.failed"]),
});

const StageLifecycleEventSchema = EventIdentitySchema.extend({
  kind: z.enum(["stage.started", "stage.completed"]),
  stage: ReconciliationProgressStageSchema,
});

const ReviewRequiredEventSchema = EventIdentitySchema.extend({
  kind: z.literal("review.required"),
  review: ReconciliationReviewKindSchema,
});

const RunCompletedEventSchema = EventIdentitySchema.extend({
  kind: z.literal("run.completed"),
  status: ReconciliationTerminalStatusSchema,
});

export const ReconciliationProgressEventSchema = z.discriminatedUnion("kind", [
  RunLifecycleEventSchema,
  StageLifecycleEventSchema,
  ReviewRequiredEventSchema,
  RunCompletedEventSchema,
]);

export type ReconciliationProgressEvent = z.infer<
  typeof ReconciliationProgressEventSchema
>;

export type ReconciliationProgressEventInput =
  | { kind: z.infer<typeof RunLifecycleEventSchema>["kind"] }
  | {
      kind: z.infer<typeof StageLifecycleEventSchema>["kind"];
      stage: ReconciliationProgressStage;
    }
  | {
      kind: "review.required";
      review: z.infer<typeof ReconciliationReviewKindSchema>;
    }
  | {
      kind: "run.completed";
      status: z.infer<typeof ReconciliationTerminalStatusSchema>;
    };

export const RECONCILIATION_PROGRESS_LABELS = {
  load_submission: "Loading invoice",
  extract_invoice: "Extracting invoice",
  lookup_purchase_order: "Finding purchase order",
  match_vendor: "Matching vendor",
  resolve_matches: "Resolving matches",
  load_evidence: "Loading receiving evidence",
  match_lines: "Matching invoice lines",
  evaluate_policy: "Checking reconciliation policy",
  prepare_payment_review: "Preparing payment approval",
  compose_vendor_email: "Drafting vendor email",
  remit_payment: "Submitting payment",
  send_email: "Sending vendor email",
} satisfies Record<ReconciliationProgressStage, string>;

export function createReconciliationProgressEvent(
  reconciliationId: string,
  input: ReconciliationProgressEventInput,
): ReconciliationProgressEvent {
  return ReconciliationProgressEventSchema.parse({
    version: 1,
    id: crypto.randomUUID(),
    reconciliationId,
    occurredAt: new Date().toISOString(),
    ...input,
  });
}

export function reconciliationProgressEventLabel(
  event: ReconciliationProgressEvent,
): string {
  switch (event.kind) {
    case "run.started":
      return "Agent started";
    case "run.resumed":
      return "Agent resumed";
    case "run.retrying":
      return "Agent will retry";
    case "run.failed":
      return "Agent failed";
    case "run.completed":
      return event.status === "payment_submitted"
        ? "Payment submitted"
        : event.status === "email_sent"
          ? "Vendor email sent"
          : "Reconciliation cancelled";
    case "review.required":
      return event.review === "exception"
        ? "Exception review required"
        : event.review === "payment"
          ? "Payment approval required"
          : "Vendor email review required";
    case "stage.started":
      return `${RECONCILIATION_PROGRESS_LABELS[event.stage]}…`;
    case "stage.completed":
      return RECONCILIATION_PROGRESS_LABELS[event.stage];
  }
}
