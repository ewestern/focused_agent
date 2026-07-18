import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/health", () => ({
  checkDatabaseHealth: vi.fn().mockResolvedValue({
    status: "degraded",
    checks: { database: false, pgvector: false },
  }),
}));
vi.mock("@/server/db/pool", () => ({ getPool: vi.fn().mockReturnValue({}) }));

import { POST } from "@/app/api/chat/route";

describe("chat route availability", () => {
  it("returns 503 before opening a stream when persistence is unavailable", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          threadId: "2eacda09-36ca-4d51-8aed-85e0a5b6fd44",
          message: "hello",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable" },
    });
  });
});
