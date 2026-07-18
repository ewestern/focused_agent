import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { createAgentGraph, messageContentAsText } from "@/server/agent/graph";
import type { Retriever } from "@/server/rag/retriever";

describe("placeholder graph", () => {
  it("returns deterministic output without invoking the deferred retriever", async () => {
    const retrieve = vi.fn<Retriever["retrieve"]>();
    const graph = createAgentGraph({
      checkpointer: new MemorySaver(),
      retriever: { retrieve },
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage("hello")] },
      { configurable: { thread_id: crypto.randomUUID() } },
    );

    expect(messageContentAsText(result.messages.at(-1))).toBe(
      "Scaffold received: hello",
    );
    expect(retrieve).not.toHaveBeenCalled();
  });
});
