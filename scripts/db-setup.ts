import "dotenv/config";

import { Pool } from "pg";

import { createDatabase } from "../src/server/db/client";
import { migrateDomainDatabase } from "../src/server/db/migrate";
import { seedDemoData } from "../src/server/db/seed";
import { setupDatabase } from "../src/server/db/setup";
import { getServerEnv } from "../src/server/env";
import { setupReconciliationQueues } from "../src/server/reconciliation/jobs";
import { createS3DocumentStore } from "@/server/documents/s3";

async function main(): Promise<void> {
  const env = getServerEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });

  try {
    await setupDatabase(pool);
    await migrateDomainDatabase(pool);
    await setupReconciliationQueues();
    await createS3DocumentStore(env).ensureReady();
    const db = createDatabase(pool);
    if (env.SEED_DEMO_DATA) await seedDemoData(db);
    console.log(
      "Database, pg-boss queues, object storage, and optional demo data are ready.",
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error("Database setup failed.", error);
  process.exitCode = 1;
});
