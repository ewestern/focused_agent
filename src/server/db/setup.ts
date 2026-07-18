import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Pool } from "pg";

export const LANGGRAPH_SCHEMA = "langgraph";

export async function setupDatabase(pool: Pool): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${LANGGRAPH_SCHEMA}`);

  const checkpointer = new PostgresSaver(pool, undefined, {
    schema: LANGGRAPH_SCHEMA,
  });
  await checkpointer.setup();
}
