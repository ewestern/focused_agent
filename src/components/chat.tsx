"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import type { ChatStreamEvent, ErrorResponse } from "@/lib/contracts";
import { consumeSseStream } from "@/lib/sse";

type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const THREAD_STORAGE_KEY = "focused-agent-thread-id";

function createThreadId(): string {
  return crypto.randomUUID();
}

export function Chat(): React.ReactElement {
  const [threadId, setThreadId] = useState(() => {
    if (typeof window === "undefined") {
      return createThreadId();
    }
    return window.localStorage.getItem(THREAD_STORAGE_KEY) ?? createThreadId();
  });
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortController = useRef<AbortController | null>(null);

  useEffect(() => {
    window.localStorage.setItem(THREAD_STORAGE_KEY, threadId);

    return () => abortController.current?.abort();
  }, [threadId]);

  function startNewThread(): void {
    abortController.current?.abort();
    const nextThreadId = createThreadId();
    window.localStorage.setItem(THREAD_STORAGE_KEY, nextThreadId);
    setThreadId(nextThreadId);
    setMessages([]);
    setInput("");
    setError(null);
    setIsRunning(false);
  }

  function applyStreamEvent(event: ChatStreamEvent): void {
    if (event.type === "message.delta") {
      setMessages((current) => {
        const existing = current.find((message) => message.id === event.messageId);
        if (existing) {
          return current.map((message) =>
            message.id === event.messageId
              ? { ...message, content: message.content + event.delta }
              : message,
          );
        }
        return [
          ...current,
          { id: event.messageId, role: "assistant", content: event.delta },
        ];
      });
    }

    if (event.type === "run.failed") {
      setError(event.message);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const message = input.trim();
    if (!message || !threadId || isRunning) {
      return;
    }

    const userMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError(null);
    setIsRunning(true);

    const controller = new AbortController();
    abortController.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.json()) as ErrorResponse;
        throw new Error(body.error?.message ?? "The request failed.");
      }
      if (!response.body) {
        throw new Error("The server returned no event stream.");
      }

      await consumeSseStream(response.body, applyStreamEvent);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "The request failed.");
      }
    } finally {
      if (abortController.current === controller) {
        abortController.current = null;
      }
      setIsRunning(false);
    }
  }

  return (
    <main className="shell">
      <section className="chat-panel" aria-label="Agent chat">
        <header className="chat-header">
          <div>
            <p className="eyebrow">LangGraph scaffold</p>
            <h1>Focused Agent</h1>
          </div>
          <button className="secondary-button" type="button" onClick={startNewThread}>
            New thread
          </button>
        </header>

        <div className="status-strip">
          <span className="status-dot" aria-hidden="true" />
          Deterministic placeholder · Postgres checkpoints · pgvector ready
        </div>

        <div className="messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">The plumbing is ready.</p>
              <p>
                Send a message to exercise the frontend, streaming API, LangGraph,
                and persistent thread state without calling an external model.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <span>{message.role === "user" ? "You" : "Agent"}</span>
                <p>{message.content}</p>
              </article>
            ))
          )}
          {isRunning ? <p className="running-indicator">Running graph…</p> : null}
        </div>

        {error ? <p className="error-message" role="alert">{error}</p> : null}

        <form className="composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="message">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Send a message to the placeholder graph…"
            rows={3}
            maxLength={20_000}
            disabled={isRunning}
          />
          <button type="submit" disabled={isRunning || !input.trim() || !threadId}>
            {isRunning ? "Running…" : "Send"}
          </button>
        </form>
      </section>
    </main>
  );
}
