import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import type { AppDatabase } from "@/server/db/client";
import {
  invoiceDocuments,
  payments,
  reconciliations,
} from "@/server/db/schema";
import type { ReconciliationJobPublisher } from "@/server/reconciliation/jobs";
import type {
  ReconciliationStatus,
  ReviewRequest,
  ReviewResolution,
} from "@/server/reconciliation/types";

export class ReconciliationNotFoundError extends Error {}
export class ReconciliationReviewConflictError extends Error {}

export type ReconciliationRun = typeof reconciliations.$inferSelect;

export type ReconciliationRunListItem = ReconciliationRun & {
  originalFilename: string | null;
};

const terminalStatuses: ReconciliationStatus[] = [
  "payment_submitted",
  "dispute_sent",
  "email_sent",
  "cancelled",
  "failed",
];

function awaitingStatus(kind: ReviewRequest["kind"]): ReconciliationStatus {
  switch (kind) {
    case "exception":
      return "awaiting_exception_review";
    case "payment":
      return "awaiting_payment_approval";
    case "email":
      return "awaiting_email_approval";
  }
}

export class ReconciliationRepository {
  constructor(private readonly db: AppDatabase) {}

  async getCore(id: string): Promise<ReconciliationRun | null> {
    const [row] = await this.db
      .select()
      .from(reconciliations)
      .where(eq(reconciliations.id, id))
      .limit(1);
    return row ?? null;
  }

  async listRuns(): Promise<ReconciliationRunListItem[]> {
    const rows = await this.db
      .select({ reconciliation: reconciliations, document: invoiceDocuments })
      .from(reconciliations)
      .leftJoin(
        invoiceDocuments,
        eq(invoiceDocuments.submissionId, reconciliations.submissionId),
      )
      .orderBy(desc(reconciliations.createdAt));
    return rows.map(({ reconciliation, document }) => ({
      ...reconciliation,
      originalFilename: document?.originalFilename ?? null,
    }));
  }

  async markProcessing(id: string): Promise<boolean> {
    const [row] = await this.db
      .update(reconciliations)
      .set({
        status: "processing",
        startedAt: sql`coalesce(${reconciliations.startedAt}, now())`,
        failureCode: null,
        failureMessage: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reconciliations.id, id),
          inArray(reconciliations.status, ["queued", "processing"]),
        ),
      )
      .returning({ id: reconciliations.id });
    if (row) return true;
    if (!(await this.getCore(id))) throw new ReconciliationNotFoundError();
    return false;
  }

  async markAwaitingReview(id: string, kind: ReviewRequest["kind"]): Promise<void> {
    await this.updateStatus(id, awaitingStatus(kind));
  }

  async markTerminal(
    id: string,
    status: Extract<
      ReconciliationStatus,
      "payment_submitted" | "email_sent" | "cancelled"
    >,
  ): Promise<void> {
    const updated = await this.db
      .update(reconciliations)
      .set({ status, completedAt: new Date(), updatedAt: new Date() })
      .where(eq(reconciliations.id, id))
      .returning({ id: reconciliations.id });
    if (!updated[0]) throw new ReconciliationNotFoundError();
  }

  async claimReviewAndEnqueue(input: {
    reconciliationId: string;
    checkpointId: string;
    review: ReviewRequest;
    resolution: ReviewResolution;
  }, jobs: ReconciliationJobPublisher): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(reconciliations)
        .set({ status: "queued", updatedAt: new Date() })
        .where(
          and(
            eq(reconciliations.id, input.reconciliationId),
            eq(reconciliations.status, awaitingStatus(input.review.kind)),
          ),
        )
        .returning({ id: reconciliations.id });
      if (!claimed) {
        const [existing] = await tx
          .select({ id: reconciliations.id })
          .from(reconciliations)
          .where(eq(reconciliations.id, input.reconciliationId))
          .limit(1);
        if (!existing) throw new ReconciliationNotFoundError();
        throw new ReconciliationReviewConflictError(
          "The review is stale, resolved, or is already being resumed.",
        );
      }
      await jobs.enqueue(tx, {
        kind: "resume",
        reconciliationId: input.reconciliationId,
        checkpointId: input.checkpointId,
        payload: input.resolution,
      });
    });
  }

  async retry(id: string, jobs: ReconciliationJobPublisher): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(reconciliations)
        .set({
          status: "queued",
          failureCode: null,
          failureMessage: null,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(reconciliations.id, id), eq(reconciliations.status, "failed")),
        )
        .returning({ id: reconciliations.id });
      if (!claimed) {
        const [existing] = await tx
          .select({ id: reconciliations.id })
          .from(reconciliations)
          .where(eq(reconciliations.id, id))
          .limit(1);
        if (!existing) throw new ReconciliationNotFoundError();
        throw new ReconciliationReviewConflictError(
          "Only failed reconciliations can be retried.",
        );
      }
      await jobs.enqueue(tx, { reconciliationId: id, kind: "retry" });
    });
  }

  async failAgentJob(id: string, message: string): Promise<void> {
    const updated = await this.db
      .update(reconciliations)
      .set({
        status: "failed",
        failureCode: "agent_job_failed",
        failureMessage: message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reconciliations.id, id),
          notInArray(reconciliations.status, terminalStatuses),
        ),
      )
      .returning({ id: reconciliations.id });
    if (updated[0]) return;
    if (!(await this.getCore(id))) throw new ReconciliationNotFoundError();
  }

  async getPaymentSummary(reconciliationId: string): Promise<{
    id: string;
    status: string;
    submittedAt: string;
  } | null> {
    const [row] = await this.db
      .select({
        id: payments.id,
        status: payments.status,
        submittedAt: payments.submittedAt,
      })
      .from(payments)
      .where(eq(payments.reconciliationId, reconciliationId))
      .limit(1);
    return row
      ? { id: row.id, status: row.status, submittedAt: row.submittedAt.toISOString() }
      : null;
  }

  private async updateStatus(id: string, status: ReconciliationStatus): Promise<void> {
    const updated = await this.db
      .update(reconciliations)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(reconciliations.id, id),
          notInArray(reconciliations.status, terminalStatuses),
          isNull(reconciliations.completedAt),
        ),
      )
      .returning({ id: reconciliations.id });
    if (!updated[0] && !(await this.getCore(id))) {
      throw new ReconciliationNotFoundError();
    }
  }
}
