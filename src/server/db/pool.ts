import { Pool } from "pg";

import { getServerEnv } from "@/server/env";

declare global {
  var focusedAgentPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.focusedAgentPool) {
    globalThis.focusedAgentPool = new Pool({
      connectionString: getServerEnv().DATABASE_URL,
      max: 10,
    });
  }

  return globalThis.focusedAgentPool;
}

export async function closePool(): Promise<void> {
  const pool = globalThis.focusedAgentPool;
  globalThis.focusedAgentPool = undefined;
  await pool?.end();
}
