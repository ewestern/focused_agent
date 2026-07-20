import type { JobWithMetadata } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import type { ReconciliationServices } from "@/server/agent/graph";
import { ReconciliationJobDataSchema } from "@/server/reconciliation/jobs";
import {
  createReconciliationDeadLetterHandler,
  createReconciliationJobHandler,
} from "@/server/reconciliation/worker";

const reconciliationId = "00000000-0000-4000-8000-000000000010";
const reviewId = "00000000-0000-4000-8000-000000000011";

describe("reconciliation jobs", () => {
  it("validates each supported job payload", () => {
    expect(
      ReconciliationJobDataSchema.parse({ kind: "start", reconciliationId }),
    ).toEqual({ kind: "start", reconciliationId });
    expect(
      ReconciliationJobDataSchema.safeParse({ kind: "resume", reconciliationId }),
    ).toMatchObject({ success: false });
  });

  it("maps start, resume, and retry jobs to LangGraph inputs", async () => {
    const invoke = vi.fn().mockResolvedValue({});
    const graph = { invoke } as unknown as Parameters<
      typeof createReconciliationJobHandler
    >[0];
    const services = {} as ReconciliationServices;
    const handler = createReconciliationJobHandler(graph, services);
    const decision = {
      reviewId,
      kind: "payment" as const,
      action: "approve_payment" as const,
    };

    await handler([job({ kind: "start", reconciliationId })]);
    await handler([job({ kind: "resume", reconciliationId, payload: decision })]);
    await handler([job({ kind: "retry", reconciliationId })]);

    expect(invoke.mock.calls[0]?.[0]).toEqual({ reconciliationId });
    expect(invoke.mock.calls[1]?.[0]).toMatchObject({ resume: decision });
    expect(invoke.mock.calls[2]?.[0]).toBeNull();
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      configurable: { thread_id: reconciliationId },
      context: { services },
    });
  });

  it("records terminal pg-boss failures through the domain repository", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failAgentJob = vi.fn();
    const services = {
      reconciliations: { failAgentJob },
    } as unknown as ReconciliationServices;
    const handler = createReconciliationDeadLetterHandler(services);

    await handler([
      job(
        { kind: "retry", reconciliationId },
        { output: { message: "model unavailable" }, sourceId: crypto.randomUUID() },
      ),
    ]);

    expect(failAgentJob).toHaveBeenCalledWith(
      reconciliationId,
      "model unavailable",
    );
    consoleError.mockRestore();
  });
});

function job(
  data: unknown,
  overrides: Partial<JobWithMetadata<unknown>> = {},
): JobWithMetadata<unknown> {
  return {
    id: crypto.randomUUID(),
    name: "reconciliation",
    data,
    signal: new AbortController().signal,
    priority: 0,
    state: "active",
    retryLimit: 2,
    retryCount: 0,
    retryDelay: 5,
    retryBackoff: true,
    startAfter: new Date(),
    startedOn: new Date(),
    singletonKey: null,
    singletonOn: null,
    expireInSeconds: 1_800,
    heartbeatSeconds: 60,
    heartbeatOn: new Date(),
    deleteAfterSeconds: 604_800,
    createdOn: new Date(),
    completedOn: null,
    keepUntil: new Date(),
    policy: "standard",
    blocked: false,
    blocking: false,
    pendingDependencies: 0,
    deadLetter: "reconciliation-dead-letter",
    output: {},
    sourceName: null,
    sourceId: null,
    sourceCreatedOn: null,
    sourceRetryCount: null,
    ...overrides,
  };
}
