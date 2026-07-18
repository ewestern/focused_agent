import { HumanMessage } from "@langchain/core/messages";

import {
  ChatRequestSchema,
  type ChatStreamEvent,
  type ErrorResponse,
} from "@/lib/contracts";
import { encodeSse } from "@/lib/sse";
import { messageContentAsText } from "@/server/agent/graph";
import { getAgentGraph } from "@/server/agent/runtime";
import { checkDatabaseHealth } from "@/server/db/health";
import { getPool } from "@/server/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number): Response {
  const body: ErrorResponse = { error: { code, message } };
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be valid JSON.", 400);
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "invalid_request",
      "threadId must be a UUID and message must be non-empty.",
      400,
    );
  }

  const { message, threadId } = parsed.data;
  const health = await checkDatabaseHealth(getPool());
  if (health.status !== "ok") {
    return errorResponse(
      "service_unavailable",
      "The agent persistence service is unavailable.",
      503,
    );
  }

  const runId = crypto.randomUUID();
  const messageId = crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => controller.enqueue(encodeSse(event));

      try {
        send({ type: "run.started", runId, threadId });

        const result = await getAgentGraph().invoke(
          { messages: [new HumanMessage(message)] },
          {
            configurable: { thread_id: threadId },
            signal: request.signal,
          },
        );
        const responseText = messageContentAsText(result.messages.at(-1));

        send({
          type: "message.delta",
          runId,
          messageId,
          delta: responseText,
        });
        send({ type: "run.completed", runId });
      } catch (error) {
        console.error("Agent run failed", { runId, error });
        if (!request.signal.aborted) {
          send({
            type: "run.failed",
            runId,
            code: "agent_run_failed",
            message: "The agent run could not be completed.",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
