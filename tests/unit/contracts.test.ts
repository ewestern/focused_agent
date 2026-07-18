import { describe, expect, it } from "vitest";

import { ChatRequestSchema, ChatStreamEventSchema } from "@/lib/contracts";

describe("chat contracts", () => {
  it("accepts a valid request", () => {
    const result = ChatRequestSchema.parse({
      threadId: "2eacda09-36ca-4d51-8aed-85e0a5b6fd44",
      message: " hello ",
    });

    expect(result.message).toBe("hello");
  });

  it("rejects invalid thread identifiers and empty messages", () => {
    expect(
      ChatRequestSchema.safeParse({ threadId: "not-a-uuid", message: " " }).success,
    ).toBe(false);
  });

  it("rejects unknown stream event types", () => {
    expect(ChatStreamEventSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });
});
