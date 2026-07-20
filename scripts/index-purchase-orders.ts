import "dotenv/config";

import { Pool } from "pg";

import { createPurchaseOrderEmbeddings } from "../src/server/accounting/embeddings";
import { PurchaseOrderSearchIndexer } from "../src/server/accounting/purchase-order-search";
import { createDatabase } from "../src/server/db/client";
import { migrateDomainDatabase } from "../src/server/db/migrate";
import { getServerEnv } from "../src/server/env";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: getServerEnv().DATABASE_URL });
  try {
    await migrateDomainDatabase(pool);
    const result = await new PurchaseOrderSearchIndexer(
      createDatabase(pool),
      createPurchaseOrderEmbeddings(),
    ).indexAll();
    console.log(
      `Purchase order search index is ready: ${result.indexed} indexed, ${result.skipped} unchanged, ${result.total} total.`,
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error("Purchase order indexing failed.", error);
  process.exitCode = 1;
});
