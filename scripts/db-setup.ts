import "dotenv/config";

import { Pool } from "pg";

import { createPurchaseOrderEmbeddings } from "../src/server/accounting/embeddings";
import { PurchaseOrderSearchIndexer } from "../src/server/accounting/purchase-order-search";
import { createDatabase } from "../src/server/db/client";
import { migrateDomainDatabase } from "../src/server/db/migrate";
import { seedDemoData } from "../src/server/db/seed";
import { setupDatabase } from "../src/server/db/setup";
import { createS3DocumentStore } from "../src/server/documents/s3";
import { getServerEnv } from "../src/server/env";
import { setupReconciliationQueues } from "../src/server/reconciliation/jobs";

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
    if (env.OPENAI_API_KEY.trim()) {
      const result = await new PurchaseOrderSearchIndexer(
        db,
        createPurchaseOrderEmbeddings(),
      ).indexAll();
      console.log(
        `Purchase order search index is ready: ${result.indexed} indexed, ${result.skipped} unchanged, ${result.total} total.`,
      );
    }
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
