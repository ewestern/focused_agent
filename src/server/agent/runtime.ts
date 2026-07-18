import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { createAgentGraph } from "@/server/agent/graph";
import { getPool } from "@/server/db/pool";
import { LANGGRAPH_SCHEMA } from "@/server/db/setup";

declare global {
  var focusedAgentGraph: ReturnType<typeof createAgentGraph> | undefined;
}

export function getAgentGraph(): ReturnType<typeof createAgentGraph> {
  if (!globalThis.focusedAgentGraph) {
    const checkpointer = new PostgresSaver(getPool(), undefined, {
      schema: LANGGRAPH_SCHEMA,
    });
    globalThis.focusedAgentGraph = createAgentGraph({ checkpointer });
  }

  return globalThis.focusedAgentGraph;
}
