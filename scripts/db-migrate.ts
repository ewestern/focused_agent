import "dotenv/config";

import { Pool } from "pg";

import { migrateDomainDatabase } from "../src/server/db/migrate";
import { getServerEnv } from "../src/server/env";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: getServerEnv().DATABASE_URL });
  try {
    await migrateDomainDatabase(pool);
    console.log("Domain database migrations are ready.");
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
});
