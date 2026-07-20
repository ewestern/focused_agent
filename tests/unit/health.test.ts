import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { checkDatabaseHealth } from "@/server/db/health";

describe("database health", () => {
  it("reports a healthy pgvector database", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ pgvector: true }] }),
    } as unknown as Pool;

    await expect(checkDatabaseHealth(pool)).resolves.toEqual({
      database: true,
      pgvector: true,
    });
  });

  it("degrades when the database cannot be reached", async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as Pool;

    await expect(checkDatabaseHealth(pool)).resolves.toEqual({
      database: false,
      pgvector: false,
    });
  });
});
