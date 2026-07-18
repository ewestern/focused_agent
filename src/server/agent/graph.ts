import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";

import type { Retriever } from "@/server/rag/retriever";

function contentAsText(message: BaseMessage | undefined): string {
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export function createAgentGraph(options: {
  checkpointer: BaseCheckpointSaver;
  retriever?: Retriever;
}) {
  const placeholderNode = async (state: typeof MessagesAnnotation.State) => {
    const latestMessage = state.messages.at(-1);
    const message = contentAsText(latestMessage);

    // The retriever is intentionally injected but unused until RAG behavior is
    // implemented. Keeping it here establishes the graph's dependency boundary.
    void options.retriever;

    return {
      messages: [
        new AIMessage(
          message
            ? `Scaffold received: ${message}`
            : "Scaffold is ready for agent implementation.",
        ),
      ],
    };
  };

  return new StateGraph(MessagesAnnotation)
    .addNode("placeholder", placeholderNode)
    .addEdge(START, "placeholder")
    .addEdge("placeholder", END)
    .compile({ checkpointer: options.checkpointer });
}

export function messageContentAsText(message: BaseMessage | undefined): string {
  return contentAsText(message);
}
