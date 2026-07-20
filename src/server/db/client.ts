import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { getPool } from "@/server/db/pool";
import * as schema from "@/server/db/schema";

export type AppDatabase = NodePgDatabase<typeof schema>;

export function createDatabase(pool: Pool): AppDatabase {
  return drizzle({ client: pool, schema });
}

export function getDatabase(): AppDatabase {
  return createDatabase(getPool());
}
