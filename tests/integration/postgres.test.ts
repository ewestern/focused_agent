import { HumanMessage } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgentGraph } from "@/server/agent/graph";
import { LANGGRAPH_SCHEMA, setupDatabase } from "@/server/db/setup";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("Postgres persistence", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await setupDatabase(pool);
    await setupDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("installs pgvector", async () => {
    const result = await pool.query<{ installed: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS installed
    `);
    expect(result.rows[0]?.installed).toBe(true);
  });

  it("retains messages within a thread and isolates other threads", async () => {
    const graph = createAgentGraph({
      checkpointer: new PostgresSaver(pool, undefined, { schema: LANGGRAPH_SCHEMA }),
    });
    const firstThread = crypto.randomUUID();
    const secondThread = crypto.randomUUID();

    await graph.invoke(
      { messages: [new HumanMessage("first")] },
      { configurable: { thread_id: firstThread } },
    );
    const continued = await graph.invoke(
      { messages: [new HumanMessage("second")] },
      { configurable: { thread_id: firstThread } },
    );
    const isolated = await graph.invoke(
      { messages: [new HumanMessage("separate")] },
      { configurable: { thread_id: secondThread } },
    );

    expect(continued.messages).toHaveLength(4);
    expect(isolated.messages).toHaveLength(2);
  });
});
