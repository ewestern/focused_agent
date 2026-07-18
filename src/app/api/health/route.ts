import { checkDatabaseHealth } from "@/server/db/health";
import { getPool } from "@/server/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const health = await checkDatabaseHealth(getPool());
  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
