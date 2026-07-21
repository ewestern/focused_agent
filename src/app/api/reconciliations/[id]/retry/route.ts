import { jsonError } from "@/lib/http";
import { ResourceIdSchema } from "@/lib/reconciliation-contracts";
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

export function retryErrorResponse(caught: unknown): Response {
  if (
    !(caught instanceof ReconciliationNotFoundError) &&
    !(caught instanceof ReconciliationReviewConflictError)
  ) {
    throw caught;
  }
  const status = caught instanceof ReconciliationNotFoundError ? 404 : 409;
  return jsonError(
    status === 404 ? "reconciliation_not_found" : "retry_conflict",
    status === 409 ? caught.message : "Reconciliation was not found.",
    status,
  );
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = ResourceIdSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    return jsonError(
      "invalid_reconciliation_id",
      "Reconciliation ID must be a UUID.",
      400,
    );
  }
  const repository = new ReconciliationRepository(getDatabase());
  try {
    await repository.retry(parsed.data, await getReconciliationJobPublisher());
    return Response.json(
      {
        reconciliation: await new ReconciliationQueryService().getDetail(
          parsed.data,
        ),
      },
      { status: 202 },
    );
  } catch (caught) {
    return retryErrorResponse(caught);
  }
}
