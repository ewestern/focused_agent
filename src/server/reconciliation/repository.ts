import { and, desc, eq, notInArray } from "drizzle-orm";

import type { AppDatabase } from "@/server/db/client";
import {
  emailDeliveries,
  invoiceDocuments,
  invoiceSubmissions,
  payments,
  reconciliationEvents,
  reconciliationReviews,
  reconciliations,
} from "@/server/db/schema";
import type { ReconciliationJobPublisher } from "@/server/reconciliation/jobs";
import {
  ReviewDecisionSchema,
  ReviewRequestSchema,
  type EmailDraft,
  type ExtractedInvoice,
  type InvoiceLineMatch,
  type PolicyDiscrepancy,
  type ReconciliationStatus,
  type ReviewDecision,
  type ReviewRequest,
} from "@/server/reconciliation/types";

export class ReconciliationNotFoundError extends Error {}
export class ReconciliationReviewConflictError extends Error {}

export type ReconciliationSummary = {
  id: string;
  submissionId: string;
  status: ReconciliationStatus;
  stage: string;
  version: number;
  originalFilename: string | null;
  invoiceNumber: string | null;
  vendorName: string | null;
  total: string | null;
  currency: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReconciliationDetail = ReconciliationSummary & {
  threadId: string;
  extractionModel: string | null;
  extraction: ExtractedInvoice | null;
  selectedVendorId: string | null;
  selectedPurchaseOrderId: string | null;
  vendorCandidates: unknown[];
  purchaseOrderCandidates: unknown[];
  receivingSnapshot: unknown[];
  lineMatches: InvoiceLineMatch[];
  discrepancies: PolicyDiscrepancy[];
  emailDraft: EmailDraft | null;
  failureCode: string | null;
  failureMessage: string | null;
  pendingReview: ReviewRequest | null;
  reviews: Array<{
    id: string;
    kind: "exception" | "payment" | "email";
    status: "pending" | "resolved";
    request: ReviewRequest;
    decision: ReviewDecision | null;
    reviewedBy: string | null;
    createdAt: string;
    decidedAt: string | null;
  }>;
  events: Array<{ id: string; type: string; payload: unknown; createdAt: string }>;
  payment: { id: string; status: string; submittedAt: string } | null;
  emailDelivery: { id: string; status: string; sentAt: string | null } | null;
};

type ReconciliationPatch = {
  status?: ReconciliationStatus;
  stage?: string;
  extractionModel?: string | null;
  extraction?: ExtractedInvoice | null;
  selectedVendorId?: string | null;
  selectedPurchaseOrderId?: string | null;
  vendorCandidates?: unknown[];
  purchaseOrderCandidates?: unknown[];
  receivingSnapshot?: unknown[];
  lineMatches?: InvoiceLineMatch[];
  discrepancies?: PolicyDiscrepancy[];
  emailDraft?: EmailDraft | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
};

export class ReconciliationRepository {
  constructor(private readonly db: AppDatabase) {}

  async getCore(id: string) {
    const [row] = await this.db
      .select()
      .from(reconciliations)
      .where(eq(reconciliations.id, id))
      .limit(1);
    return row ?? null;
  }

  async update(id: string, patch: ReconciliationPatch): Promise<void> {
    const result = await this.db
      .update(reconciliations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(reconciliations.id, id))
      .returning({ id: reconciliations.id });
    if (!result[0]) throw new ReconciliationNotFoundError();
  }

  async transition(
    id: string,
    patch: ReconciliationPatch,
    eventType: string,
    payload?: unknown,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(reconciliations)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(reconciliations.id, id))
        .returning({ id: reconciliations.id });
      if (!updated[0]) throw new ReconciliationNotFoundError();
      await tx.insert(reconciliationEvents).values({
        reconciliationId: id,
        eventType,
        payload: payload ?? null,
      });
    });
  }

  async createReview(input: {
    reconciliationId: string;
    kind: "exception" | "payment" | "email";
    title: string;
    summary: string;
    payload: Record<string, unknown>;
    status: ReconciliationStatus;
  }): Promise<ReviewRequest> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ version: reconciliations.version })
        .from(reconciliations)
        .where(eq(reconciliations.id, input.reconciliationId))
        .limit(1);
      if (!row) throw new ReconciliationNotFoundError();
      const existing = await tx
        .select()
        .from(reconciliationReviews)
        .where(
          and(
            eq(reconciliationReviews.reconciliationId, input.reconciliationId),
            eq(reconciliationReviews.status, "pending"),
          ),
        )
        .limit(1);
      if (existing[0]) return ReviewRequestSchema.parse(existing[0].request);

      const reviewId = crypto.randomUUID();
      const requestedVersion = row.version + 1;
      const request = ReviewRequestSchema.parse({
        reviewId,
        reconciliationId: input.reconciliationId,
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        payload: input.payload,
        requestedVersion,
      });
      await tx.insert(reconciliationReviews).values({
        id: reviewId,
        reconciliationId: input.reconciliationId,
        kind: input.kind,
        request,
        requestedVersion,
      });
      await tx
        .update(reconciliations)
        .set({
          status: input.status,
          stage: `review_${input.kind}`,
          version: requestedVersion,
          updatedAt: new Date(),
        })
        .where(eq(reconciliations.id, input.reconciliationId));
      await tx.insert(reconciliationEvents).values({
        reconciliationId: input.reconciliationId,
        eventType: "review.requested",
        payload: request,
      });
      return request;
    });
  }

  async submitReview(input: {
    reconciliationId: string;
    reviewId: string;
    expectedVersion: number;
    decision: ReviewDecision;
    reviewedBy: string;
  }, jobs: ReconciliationJobPublisher): Promise<void> {
    const decision = ReviewDecisionSchema.parse(input.decision);
    if (decision.reviewId !== input.reviewId) {
      throw new ReconciliationReviewConflictError("Review IDs do not match.");
    }
    await this.db.transaction(async (tx) => {
      const [caseRow] = await tx
        .select({ version: reconciliations.version })
        .from(reconciliations)
        .where(eq(reconciliations.id, input.reconciliationId))
        .limit(1);
      const [review] = await tx
        .select()
        .from(reconciliationReviews)
        .where(
          and(
            eq(reconciliationReviews.id, input.reviewId),
            eq(reconciliationReviews.reconciliationId, input.reconciliationId),
          ),
        )
        .limit(1);
      if (!caseRow || !review) throw new ReconciliationNotFoundError();
      if (
        review.status !== "pending" ||
        review.requestedVersion !== input.expectedVersion ||
        caseRow.version !== input.expectedVersion ||
        review.kind !== decision.kind
      ) {
        throw new ReconciliationReviewConflictError(
          "The review is stale, resolved, or does not match the pending action.",
        );
      }
      await tx
        .update(reconciliationReviews)
        .set({
          status: "resolved",
          decision,
          reviewedBy: input.reviewedBy,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(reconciliationReviews.id, input.reviewId));
      await tx
        .update(reconciliations)
        .set({ status: "queued", stage: "resume_queued", updatedAt: new Date() })
        .where(eq(reconciliations.id, input.reconciliationId));
      await jobs.enqueue(tx, {
        reconciliationId: input.reconciliationId,
        kind: "resume",
        payload: decision,
      });
      await tx.insert(reconciliationEvents).values({
        reconciliationId: input.reconciliationId,
        eventType: "review.resolved",
        payload: { reviewId: input.reviewId, decision, reviewedBy: input.reviewedBy },
      });
    });
  }

  async retry(id: string, jobs: ReconciliationJobPublisher): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: reconciliations.status })
        .from(reconciliations)
        .where(eq(reconciliations.id, id))
        .limit(1);
      if (!row) throw new ReconciliationNotFoundError();
      if (row.status !== "failed") {
        throw new ReconciliationReviewConflictError(
          "Only failed reconciliations can be retried.",
        );
      }
      await tx
        .update(reconciliations)
        .set({
          status: "queued",
          stage: "retry_queued",
          failureCode: null,
          failureMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(reconciliations.id, id));
      await jobs.enqueue(tx, {
        reconciliationId: id,
        kind: "retry",
      });
      await tx.insert(reconciliationEvents).values({
        reconciliationId: id,
        eventType: "reconciliation.retry_requested",
      });
    });
  }

  async failAgentJob(id: string, message: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(reconciliations)
        .set({
          status: "failed",
          stage: "failed",
          failureCode: "agent_job_failed",
          failureMessage: message,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reconciliations.id, id),
            notInArray(reconciliations.status, [
              "failed",
              "cancelled",
              "payment_submitted",
              "dispute_sent",
            ]),
          ),
        )
        .returning({ id: reconciliations.id });
      if (!updated[0]) {
        const [existing] = await tx
          .select({ id: reconciliations.id })
          .from(reconciliations)
          .where(eq(reconciliations.id, id))
          .limit(1);
        if (!existing) throw new ReconciliationNotFoundError();
        return;
      }
      await tx.insert(reconciliationEvents).values({
        reconciliationId: id,
        eventType: "reconciliation.failed",
        payload: { code: "agent_job_failed", message },
      });
    });
  }

  async beginEmailDelivery(reconciliationId: string, message: EmailDraft): Promise<{
    id: string;
    status: "sending" | "sent" | "failed" | "uncertain";
    created: boolean;
  }> {
    const [created] = await this.db
      .insert(emailDeliveries)
      .values({ reconciliationId, status: "sending", message })
      .onConflictDoNothing({ target: emailDeliveries.reconciliationId })
      .returning();
    if (created) return { id: created.id, status: created.status, created: true };
    const [existing] = await this.db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.reconciliationId, reconciliationId))
      .limit(1);
    if (!existing) throw new Error("Email delivery ledger could not be created.");
    return { id: existing.id, status: existing.status, created: false };
  }

  async finishEmailDelivery(input: {
    reconciliationId: string;
    status: "sent" | "failed" | "uncertain";
    providerMessageId?: string;
    accepted?: string[];
    rejected?: string[];
    failureMessage?: string;
  }): Promise<void> {
    await this.db
      .update(emailDeliveries)
      .set({
        status: input.status,
        providerMessageId: input.providerMessageId,
        accepted: input.accepted,
        rejected: input.rejected,
        failureMessage: input.failureMessage,
        sentAt: input.status === "sent" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(emailDeliveries.reconciliationId, input.reconciliationId));
  }

  async list(): Promise<ReconciliationSummary[]> {
    const rows = await this.db
      .select({ reconciliation: reconciliations, document: invoiceDocuments })
      .from(reconciliations)
      .leftJoin(
        invoiceDocuments,
        eq(invoiceDocuments.submissionId, reconciliations.submissionId),
      )
      .orderBy(desc(reconciliations.createdAt));
    return rows.map(({ reconciliation, document }) =>
      mapSummary(reconciliation, document?.originalFilename ?? null),
    );
  }

  async getDetail(id: string): Promise<ReconciliationDetail | null> {
    const [row] = await this.db
      .select({ reconciliation: reconciliations, document: invoiceDocuments })
      .from(reconciliations)
      .leftJoin(
        invoiceDocuments,
        eq(invoiceDocuments.submissionId, reconciliations.submissionId),
      )
      .where(eq(reconciliations.id, id))
      .limit(1);
    if (!row) return null;
    const [reviews, events, paymentRows, deliveryRows] = await Promise.all([
      this.db
        .select()
        .from(reconciliationReviews)
        .where(eq(reconciliationReviews.reconciliationId, id))
        .orderBy(reconciliationReviews.createdAt),
      this.db
        .select()
        .from(reconciliationEvents)
        .where(eq(reconciliationEvents.reconciliationId, id))
        .orderBy(reconciliationEvents.createdAt),
      this.db.select().from(payments).where(eq(payments.reconciliationId, id)).limit(1),
      this.db
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.reconciliationId, id))
        .limit(1),
    ]);
    const reconciliation = row.reconciliation;
    const extraction = reconciliation.extraction as ExtractedInvoice | null;
    return {
      ...mapSummary(reconciliation, row.document?.originalFilename ?? null),
      threadId: reconciliation.threadId,
      extractionModel: reconciliation.extractionModel,
      extraction,
      selectedVendorId: reconciliation.selectedVendorId,
      selectedPurchaseOrderId: reconciliation.selectedPurchaseOrderId,
      vendorCandidates: (reconciliation.vendorCandidates as unknown[] | null) ?? [],
      purchaseOrderCandidates:
        (reconciliation.purchaseOrderCandidates as unknown[] | null) ?? [],
      receivingSnapshot: (reconciliation.receivingSnapshot as unknown[] | null) ?? [],
      lineMatches: (reconciliation.lineMatches as InvoiceLineMatch[] | null) ?? [],
      discrepancies:
        (reconciliation.discrepancies as PolicyDiscrepancy[] | null) ?? [],
      emailDraft: reconciliation.emailDraft as EmailDraft | null,
      failureCode: reconciliation.failureCode,
      failureMessage: reconciliation.failureMessage,
      pendingReview: reviews.find((review) => review.status === "pending")
        ? ReviewRequestSchema.parse(
            reviews.find((review) => review.status === "pending")!.request,
          )
        : null,
      reviews: reviews.map((review) => ({
        id: review.id,
        kind: review.kind,
        status: review.status,
        request: ReviewRequestSchema.parse(review.request),
        decision: review.decision
          ? ReviewDecisionSchema.parse(review.decision)
          : null,
        reviewedBy: review.reviewedBy,
        createdAt: review.createdAt.toISOString(),
        decidedAt: review.decidedAt?.toISOString() ?? null,
      })),
      events: events.map((event) => ({
        id: event.id,
        type: event.eventType,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })),
      payment: paymentRows[0]
        ? {
            id: paymentRows[0].id,
            status: paymentRows[0].status,
            submittedAt: paymentRows[0].submittedAt.toISOString(),
          }
        : null,
      emailDelivery: deliveryRows[0]
        ? {
            id: deliveryRows[0].id,
            status: deliveryRows[0].status,
            sentAt: deliveryRows[0].sentAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  async getDocument(id: string, documentId: string) {
    const [row] = await this.db
      .select({ document: invoiceDocuments })
      .from(reconciliations)
      .innerJoin(
        invoiceSubmissions,
        eq(invoiceSubmissions.id, reconciliations.submissionId),
      )
      .innerJoin(
        invoiceDocuments,
        eq(invoiceDocuments.submissionId, invoiceSubmissions.id),
      )
      .where(and(eq(reconciliations.id, id), eq(invoiceDocuments.id, documentId)))
      .limit(1);
    return row?.document ?? null;
  }
}

function mapSummary(
  row: typeof reconciliations.$inferSelect,
  originalFilename: string | null,
): ReconciliationSummary {
  const extraction = row.extraction as ExtractedInvoice | null;
  return {
    id: row.id,
    submissionId: row.submissionId,
    status: row.status,
    stage: row.stage,
    version: row.version,
    originalFilename,
    invoiceNumber: extraction?.invoiceNumber ?? null,
    vendorName: extraction?.vendor.name ?? null,
    total: extraction?.total ?? null,
    currency: extraction?.currency ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
