import type { HealthResponse } from "@/lib/contracts";
import { checkDatabaseHealth } from "@/server/db/health";
import type { DocumentStore } from "@/server/documents/store";
import type { EmailService } from "@/server/email/service";
import type { Pool } from "pg";

export async function checkApplicationHealth(
  pool: Pool,
  documents: DocumentStore,
  email: EmailService,
  agentConfigured: boolean,
): Promise<HealthResponse> {
  const [database, objectStorage, emailHealthy] = await Promise.all([
    checkDatabaseHealth(pool),
    documents.isHealthy(),
    email.isHealthy(),
  ]);
  const checks = {
    ...database.checks,
    objectStorage,
    email: emailHealthy,
    agentConfigured,
  };
  return {
    status: Object.values(checks).every(Boolean) ? "ok" : "degraded",
    checks,
  };
}
