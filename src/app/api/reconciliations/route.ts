import { ReconciliationQueryService } from "@/server/reconciliation/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const reconciliations = await new ReconciliationQueryService().list();
  return Response.json(
    { reconciliations },
    { headers: { "Cache-Control": "no-store" } },
  );
}
