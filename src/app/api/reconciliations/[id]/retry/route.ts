import type { ErrorResponse } from "@/lib/contracts";
import { ReconciliationIdSchema } from "@/lib/reconciliation-contracts";
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
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = ReconciliationIdSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    const body: ErrorResponse = {
      error: { code: "invalid_reconciliation_id", message: "Reconciliation ID must be a UUID." },
    };
    return Response.json(body, { status: 400 });
  }
  const repository = new ReconciliationRepository(getDatabase());
  try {
    await repository.retry(parsed.data, await getReconciliationJobPublisher());
    return Response.json({ reconciliation: await repository.getDetail(parsed.data) }, { status: 202 });
  } catch (caught) {
    const status = caught instanceof ReconciliationNotFoundError ? 404 : 409;
    const body: ErrorResponse = {
      error: {
        code: status === 404 ? "reconciliation_not_found" : "retry_conflict",
        message:
          caught instanceof ReconciliationReviewConflictError
            ? caught.message
            : "Reconciliation was not found.",
      },
    };
    return Response.json(body, { status });
  }
}
