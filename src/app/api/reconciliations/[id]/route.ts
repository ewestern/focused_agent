import { jsonError } from "@/lib/http";
import { ResourceIdSchema } from "@/lib/reconciliation-contracts";
import { getDatabase } from "@/server/db/client";
import { ReconciliationRepository } from "@/server/reconciliation/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = ResourceIdSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    return jsonError("invalid_reconciliation_id", "Reconciliation ID must be a UUID.", 400);
  }
  const reconciliation = await new ReconciliationRepository(getDatabase()).getDetail(
    parsed.data,
  );
  if (!reconciliation) {
    return jsonError("reconciliation_not_found", "Reconciliation was not found.", 404);
  }
  return Response.json(
    { reconciliation },
    { headers: { "Cache-Control": "no-store" } },
  );
}
