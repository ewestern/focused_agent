import {
  ChatStreamEventSchema,
  type ChatStreamEvent,
} from "@/lib/contracts";

const encoder = new TextEncoder();

export function encodeSse(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function parseSseBlock(block: string): ChatStreamEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data) {
    return null;
  }

  return ChatStreamEventSchema.parse(JSON.parse(data));
}

export async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const event = parseSseBlock(block);
        if (event) {
          onEvent(event);
        }
      }

      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      const event = parseSseBlock(buffer);
      if (event) {
        onEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
