import { jsonError } from "@/lib/http";
import { ResourceIdSchema } from "@/lib/reconciliation-contracts";
import type { ReconciliationProgressEvent } from "@/lib/reconciliation-events";
import { getReconciliationRepository } from "@/server/agent/runtime";
import { getReconciliationProgressBroker } from "@/server/reconciliation/progress-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 15_000;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsed = ResourceIdSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    return jsonError("invalid_reconciliation_id", "Reconciliation ID must be a UUID.", 400);
  }
  if (!(await getReconciliationRepository().getCore(parsed.data))) {
    return jsonError("reconciliation_not_found", "Reconciliation was not found.", 404);
  }

  const reconciliationId = parsed.data;
  const broker = getReconciliationProgressBroker();
  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // The browser may cancel the stream before the abort signal arrives.
        }
      };
      const send = (value: string) => {
        if (!closed) controller.enqueue(encoder.encode(value));
      };

      unsubscribe = broker.subscribe(
        reconciliationId,
        (event: ReconciliationProgressEvent) =>
          send(encodeSseEvent("progress", event)),
      );
      request.signal.addEventListener("abort", close, { once: true });
      try {
        await broker.ready();
      } catch (error) {
        if (closed) return;
        closed = true;
        unsubscribe();
        request.signal.removeEventListener("abort", close);
        controller.error(error);
        return;
      }
      if (closed) return;
      send(encodeSseEvent("ready", { reconciliationId }));
      heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
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

export function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
