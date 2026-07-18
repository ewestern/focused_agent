import type { Pool } from "pg";

import type { HealthResponse } from "@/lib/contracts";

export async function checkDatabaseHealth(pool: Pool): Promise<HealthResponse> {
  try {
    const result = await pool.query<{ pgvector: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS pgvector
    `);
    const pgvector = result.rows[0]?.pgvector === true;

    return {
      status: pgvector ? "ok" : "degraded",
      checks: { database: true, pgvector },
    };
  } catch {
    return {
      status: "degraded",
      checks: { database: false, pgvector: false },
    };
  }
}
