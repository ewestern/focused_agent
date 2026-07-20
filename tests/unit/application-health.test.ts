import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { DocumentStore } from "@/server/documents/store";
import type { EmailService } from "@/server/email/service";
import { checkApplicationHealth } from "@/server/health";

describe("application health", () => {
  it("reports every service boundary", async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ pgvector: true }] }),
    } as unknown as Pool;
    const documents = {
      isHealthy: vi.fn().mockResolvedValue(true),
    } as unknown as DocumentStore;
    const email = {
      isHealthy: vi.fn().mockResolvedValue(false),
    } as unknown as EmailService;

    await expect(checkApplicationHealth(pool, documents, email, true)).resolves.toEqual({
      status: "degraded",
      checks: {
        database: true,
        pgvector: true,
        objectStorage: true,
        email: false,
        agentConfigured: true,
      },
    });
  });
});
