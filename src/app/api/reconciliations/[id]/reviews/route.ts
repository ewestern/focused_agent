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
  try {
    const jobs = await getReconciliationJobPublisher();
    await repository.submitReview({
      reconciliationId: id.data,
      reviewId: parsed.data.decision.reviewId,
      expectedVersion: parsed.data.expectedVersion,
      decision: parsed.data.decision,
      reviewedBy: "local-demo-user",
    }, jobs);
    const reconciliation = await repository.getDetail(id.data);
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
