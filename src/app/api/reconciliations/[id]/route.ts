import type { ErrorResponse } from "@/lib/contracts";
import { ReconciliationIdSchema } from "@/lib/reconciliation-contracts";
import { getDatabase } from "@/server/db/client";
import { ReconciliationRepository } from "@/server/reconciliation/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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
  const reconciliation = await new ReconciliationRepository(getDatabase()).getDetail(
    parsed.data,
  );
  if (!reconciliation) {
    const body: ErrorResponse = {
      error: { code: "reconciliation_not_found", message: "Reconciliation was not found." },
    };
    return Response.json(body, { status: 404 });
  }
  return Response.json(
    { reconciliation },
    { headers: { "Cache-Control": "no-store" } },
  );
}
