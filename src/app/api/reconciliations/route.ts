import { getDatabase } from "@/server/db/client";
import { ReconciliationRepository } from "@/server/reconciliation/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const reconciliations = await new ReconciliationRepository(getDatabase()).list();
  return Response.json(
    { reconciliations },
    { headers: { "Cache-Control": "no-store" } },
  );
}
