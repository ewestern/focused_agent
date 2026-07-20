import { describe, expect, it } from "vitest";

import { retryErrorResponse } from "@/app/api/reconciliations/[id]/retry/route";
import {
  ReconciliationNotFoundError,
  ReconciliationReviewConflictError,
} from "@/server/reconciliation/repository";

describe("reconciliation retry errors", () => {
  it("maps known domain errors to their API statuses", async () => {
    const missing = retryErrorResponse(new ReconciliationNotFoundError());
    const conflict = retryErrorResponse(
      new ReconciliationReviewConflictError("Only failed cases can be retried."),
    );

    expect(missing.status).toBe(404);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "retry_conflict", message: "Only failed cases can be retried." },
    });
  });

  it("does not relabel unexpected failures as conflicts", () => {
    const failure = new Error("database unavailable");
    expect(() => retryErrorResponse(failure)).toThrow(failure);
  });
});
