import { jsonError } from "@/lib/http";
import {
  ResourceIdSchema,
  ReconciliationReviewSubmissionSchema,
} from "@/lib/reconciliation-contracts";
import { getDatabase } from "@/server/db/client";
import { getReconciliationJobPublisher } from "@/server/reconciliation/jobs";
import {
  ReconciliationNotFoundError,
  ReconciliationRepository,
  ReconciliationReviewConflictError,
} from "@/server/reconciliation/repository";
import { ReconciliationQueryService } from "@/server/reconciliation/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = ResourceIdSchema.safeParse((await context.params).id);
  if (!id.success) return jsonError("invalid_reconciliation_id", "Reconciliation ID must be a UUID.", 400);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_json", "Request body must be valid JSON.", 400);
  }
  const parsed = ReconciliationReviewSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("invalid_review", "Review decision does not match the pending review.", 400);
  }
  const repository = new ReconciliationRepository(getDatabase());
  const queries = new ReconciliationQueryService();
  try {
    const current = await queries.getCurrentState(id.data);
    if (!current) throw new ReconciliationNotFoundError();
    const review = current.state.pendingReview;
    if (
      !review ||
      current.checkpointId !== parsed.data.checkpointId ||
      review.reviewId !== parsed.data.decision.reviewId ||
      review.kind !== parsed.data.decision.kind
    ) {
      throw new ReconciliationReviewConflictError(
        "The review is stale or does not match the current checkpoint.",
      );
    }
    const jobs = await getReconciliationJobPublisher();
    await repository.claimReviewAndEnqueue({
      reconciliationId: id.data,
      checkpointId: parsed.data.checkpointId,
      review,
      resolution: {
        decision: parsed.data.decision,
        reviewedBy: "local-demo-user",
        decidedAt: new Date().toISOString(),
      },
    }, jobs);
    const reconciliation = await queries.getDetail(id.data);
    return Response.json({ reconciliation }, { status: 202 });
  } catch (caught) {
    if (caught instanceof ReconciliationNotFoundError) {
      return jsonError("reconciliation_not_found", "Reconciliation or review was not found.", 404);
    }
    if (caught instanceof ReconciliationReviewConflictError) {
      return jsonError("review_conflict", caught.message, 409);
    }
    throw caught;
  }
}
