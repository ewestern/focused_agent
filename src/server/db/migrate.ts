import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

import { createDatabase } from "@/server/db/client";

export async function migrateDomainDatabase(pool: Pool): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await migrate(createDatabase(pool), {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
}
