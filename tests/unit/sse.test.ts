import { describe, expect, it } from "vitest";

import type { ChatStreamEvent } from "@/lib/contracts";
import { consumeSseStream, encodeSse, parseSseBlock } from "@/lib/sse";

const event: ChatStreamEvent = {
  type: "run.completed",
  runId: "4ab5b926-2600-4a06-9317-4cd8e147e915",
};

describe("SSE codec", () => {
  it("round trips a typed event", () => {
    const text = new TextDecoder().decode(encodeSse(event));
    expect(parseSseBlock(text.trim())).toEqual(event);
  });

  it("consumes events split across transport chunks", async () => {
    const bytes = encodeSse(event);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 7));
        controller.enqueue(bytes.slice(7));
        controller.close();
      },
    });
    const received: ChatStreamEvent[] = [];

    await consumeSseStream(stream, (nextEvent) => received.push(nextEvent));

    expect(received).toEqual([event]);
  });
});
