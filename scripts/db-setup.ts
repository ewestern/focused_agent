import "dotenv/config";

import { Pool } from "pg";

import { setupDatabase } from "../src/server/db/setup";
import { getServerEnv } from "../src/server/env";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: getServerEnv().DATABASE_URL });

  try {
    await setupDatabase(pool);
    console.log("Database extension and LangGraph checkpoint tables are ready.");
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error("Database setup failed.", error);
  process.exitCode = 1;
});
