import { getPool } from "@/server/db/pool";
import { getDocumentStore } from "@/server/documents/s3";
import { getEmailService } from "@/server/email/smtp";
import { getServerEnv } from "@/server/env";
import { checkApplicationHealth } from "@/server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const env = getServerEnv();
  const health = await checkApplicationHealth(
    getPool(),
    getDocumentStore(),
    getEmailService(),
    env.OPENAI_API_KEY.length > 0,
  );
  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
