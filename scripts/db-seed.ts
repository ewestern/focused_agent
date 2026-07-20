import "dotenv/config";

import { Pool } from "pg";

import { createDatabase } from "../src/server/db/client";
import { migrateDomainDatabase } from "../src/server/db/migrate";
import { seedDemoData } from "../src/server/db/seed";
import { getServerEnv } from "../src/server/env";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: getServerEnv().DATABASE_URL });
  try {
    await migrateDomainDatabase(pool);
    await seedDemoData(createDatabase(pool));
    console.log("Demo accounting data is ready.");
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error("Database seed failed.", error);
  process.exitCode = 1;
});
