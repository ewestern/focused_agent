import type { Pool } from "pg";

export type DatabaseHealth = {
  status: "ok" | "degraded";
  checks: { database: boolean; pgvector: boolean };
};

export async function checkDatabaseHealth(pool: Pool): Promise<DatabaseHealth> {
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
