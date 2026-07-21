import type { JobWithMetadata } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import type { ReconciliationDependencies } from "@/server/agent/graph";
import { ReconciliationJobDataSchema } from "@/server/reconciliation/jobs";
import { DEFAULT_RECONCILIATION_POLICY } from "@/server/reconciliation/policy";
import type { ReconciliationRepository } from "@/server/reconciliation/repository";
import {
  createReconciliationDeadLetterHandler,
  createReconciliationJobHandler,
} from "@/server/reconciliation/worker";
import type { ReconciliationProgressPublisher } from "@/server/reconciliation/progress";

const reconciliationId = "00000000-0000-4000-8000-000000000010";
const submissionId = "00000000-0000-4000-8000-000000000012";
const reviewId = "00000000-0000-4000-8000-000000000011";

const startJob = {
  kind: "start" as const,
  reconciliationId,
  submissionId,
  effectivePolicy: DEFAULT_RECONCILIATION_POLICY,
};

const resolution = {
  decision: {
    reviewId,
    kind: "payment" as const,
    action: "approve_payment" as const,
  },
  reviewedBy: "test-reviewer",
  decidedAt: "2026-07-21T18:00:00.000Z",
};

describe("reconciliation jobs", () => {
  it("validates checkpoint bootstrap and resume payloads", () => {
    expect(ReconciliationJobDataSchema.parse(startJob)).toEqual(startJob);
    expect(
      ReconciliationJobDataSchema.safeParse({
        kind: "resume",
        reconciliationId,
      }),
    ).toMatchObject({ success: false });
  });

  it("starts a new graph with the durable bootstrap input", async () => {
    const { graph, stream } = graphMock([
      snapshot(),
      snapshot({
        checkpointId: "completed",
        state: { terminal: "payment_submitted" },
      }),
    ]);
    const repository = repositoryMock();
    const dependencies = {} as ReconciliationDependencies;

    await createReconciliationJobHandler(
      graph,
      dependencies,
      repository,
      progressMock(),
    )([job(startJob)]);

    expect(stream).toHaveBeenCalledWith(
      {
        reconciliationId,
        submissionId,
        effectivePolicy: DEFAULT_RECONCILIATION_POLICY,
      },
      expect.objectContaining({
        configurable: { thread_id: reconciliationId },
        context: dependencies,
        streamMode: ["tasks", "updates", "checkpoints"],
      }),
    );
    expect(repository.markTerminal).toHaveBeenCalledWith(
      reconciliationId,
      "payment_submitted",
    );
  });

  it("resumes only the checkpoint containing the submitted review", async () => {
    const current = snapshot({
      checkpointId: "checkpoint-review",
      state: {
        pendingReview: {
          reviewId,
          reconciliationId,
          kind: "payment",
          title: "Approve payment",
          summary: "Ready",
          payload: {
            extraction: null,
            vendor: null,
            purchaseOrder: null,
            receivingRecords: [],
            lineMatches: [],
            discrepancies: [],
          },
        },
      },
      next: ["payment_review"],
    });
    const { graph, stream } = graphMock([
      current,
      snapshot({
        checkpointId: "completed",
        state: { terminal: "payment_submitted" },
      }),
    ]);
    const repository = repositoryMock();

    await createReconciliationJobHandler(
      graph,
      {} as ReconciliationDependencies,
      repository,
      progressMock(),
    )([
      job({
        kind: "resume",
        reconciliationId,
        checkpointId: "checkpoint-review",
        payload: resolution,
      }),
    ]);

    expect(stream.mock.calls[0]?.[0]).toMatchObject({ resume: resolution });
  });

  it("resumes failed work from an existing checkpoint", async () => {
    const { graph, stream } = graphMock([
      snapshot({ checkpointId: "failed-step", next: ["extract_invoice"] }),
      snapshot({
        checkpointId: "review",
        state: {
          pendingReview: {
            reviewId,
            reconciliationId,
            kind: "exception",
            title: "Review",
            summary: "Needs attention",
            payload: {
              issues: ["missing data"],
              extraction: null,
              vendorCandidates: [],
              purchaseOrderCandidates: [],
              exactPurchaseOrderCandidates: [],
              lineMatches: [],
            },
          },
        },
      }),
    ]);
    const repository = repositoryMock();

    await createReconciliationJobHandler(
      graph,
      {} as ReconciliationDependencies,
      repository,
      progressMock(),
    )([job({ kind: "retry", reconciliationId })]);

    expect(stream).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        configurable: { thread_id: reconciliationId },
      }),
    );
    expect(repository.markAwaitingReview).toHaveBeenCalledWith(
      reconciliationId,
      "exception",
    );
  });

  it("records terminal pg-boss failures through the run repository", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const repository = repositoryMock();
    const handler = createReconciliationDeadLetterHandler(
      repository,
      progressMock(),
    );

    await handler([
      job(
        { kind: "retry", reconciliationId },
        {
          output: { message: "model unavailable" },
          sourceId: crypto.randomUUID(),
        },
      ),
    ]);

    expect(repository.failAgentJob).toHaveBeenCalledWith(
      reconciliationId,
      "model unavailable",
    );
    consoleError.mockRestore();
  });
});

function repositoryMock(): ReconciliationRepository {
  return {
    markProcessing: vi.fn().mockResolvedValue(true),
    markAwaitingReview: vi.fn().mockResolvedValue(undefined),
    markTerminal: vi.fn().mockResolvedValue(undefined),
    failAgentJob: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReconciliationRepository;
}

function progressMock(): ReconciliationProgressPublisher {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

function graphMock(states: unknown[]) {
  const stream = vi.fn().mockResolvedValue(emptyStream());
  return {
    stream,
    graph: {
      stream,
      getState: vi.fn().mockImplementation(async () => states.shift()),
    } as unknown as Parameters<typeof createReconciliationJobHandler>[0],
  };
}

async function* emptyStream(): AsyncGenerator<never> {}

function snapshot(
  input: {
    checkpointId?: string;
    state?: Record<string, unknown>;
    next?: string[];
  } = {},
) {
  return {
    values: input.state ?? {},
    next: input.next ?? [],
    config: {
      configurable: {
        thread_id: reconciliationId,
        ...(input.checkpointId ? { checkpoint_id: input.checkpointId } : {}),
      },
    },
    tasks: [],
  };
}

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
