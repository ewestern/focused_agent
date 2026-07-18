// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Chat } from "@/components/chat";
import type { ChatStreamEvent } from "@/lib/contracts";
import { encodeSse } from "@/lib/sse";

function streamResponse(events: ChatStreamEvent[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encodeSse(event));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("Chat", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("submits a message and renders streamed agent output", async () => {
    const runId = "559ef02c-2079-498d-8824-f8c35b17a38e";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        {
          type: "run.started",
          runId,
          threadId: "3508fc33-ebd5-4937-9565-a3c991f3f702",
        },
        {
          type: "message.delta",
          runId,
          messageId: "db762d32-855e-4f19-b445-a8d77c36b5f5",
          delta: "Scaffold received: hello",
        },
        { type: "run.completed", runId },
      ]),
    );
    const user = userEvent.setup();
    render(<Chat />);

    await user.type(
      screen.getByPlaceholderText("Send a message to the placeholder graph…"),
      "hello",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Scaffold received: hello")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Running graph…")).not.toBeInTheDocument());
    expect(screen.getByPlaceholderText("Send a message to the placeholder graph…")).toBeEnabled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("starts a new persisted thread and clears messages", async () => {
    const user = userEvent.setup();
    render(<Chat />);
    await waitFor(() => expect(window.localStorage.getItem("focused-agent-thread-id")).toBeTruthy());
    const firstId = window.localStorage.getItem("focused-agent-thread-id");

    await user.click(screen.getByRole("button", { name: "New thread" }));

    expect(window.localStorage.getItem("focused-agent-thread-id")).not.toBe(firstId);
    expect(screen.getByText("The plumbing is ready.")).toBeInTheDocument();
  });
});
