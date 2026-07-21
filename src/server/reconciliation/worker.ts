import { Command } from "@langchain/langgraph";
import type { JobWithMetadata, WorkWithMetadataHandler } from "pg-boss";

import {
  compileInvoiceReconciliationGraph,
  type ReconciliationDependencies,
  type ReconciliationGraphState,
} from "@/server/agent/graph";
import { ReconciliationJobDataSchema } from "@/server/reconciliation/jobs";
import {
  ReconciliationProgressTracker,
  type ReconciliationProgressPublisher,
} from "@/server/reconciliation/progress";
import type { ReconciliationRepository } from "@/server/reconciliation/repository";

type ReconciliationGraph = ReturnType<typeof compileInvoiceReconciliationGraph>;
type GraphSnapshot = Awaited<ReturnType<ReconciliationGraph["getState"]>>;

export function createReconciliationJobHandler(
  graph: ReconciliationGraph,
  dependencies: ReconciliationDependencies,
  repository: ReconciliationRepository,
  progress: ReconciliationProgressPublisher,
): WorkWithMetadataHandler<unknown> {
  return async ([job]) => {
    if (!job) throw new Error("pg-boss invoked the worker without a job.");
    const data = ReconciliationJobDataSchema.parse(job.data);
    const config = {
      configurable: { thread_id: data.reconciliationId },
      context: dependencies,
    };

    if (!(await repository.markProcessing(data.reconciliationId))) return;

    let snapshot = await graph.getState(config);
    if (graphState(snapshot).terminal) {
      await synchronizeRun(repository, data.reconciliationId, snapshot);
      return;
    }

    const tracker = new ReconciliationProgressTracker(
      data.reconciliationId,
      progress,
    );
    let input: Parameters<ReconciliationGraph["stream"]>[0];
    if (data.kind === "resume") {
      const currentCheckpointId = checkpointId(snapshot);
      const pendingReview = graphState(snapshot).pendingReview;
      if (
        currentCheckpointId !== data.checkpointId ||
        pendingReview?.reviewId !== data.payload.decision.reviewId
      ) {
        await synchronizeRun(repository, data.reconciliationId, snapshot);
        return;
      }
      input = new Command({ resume: data.payload });
    } else if (graphState(snapshot).pendingReview) {
      await synchronizeRun(repository, data.reconciliationId, snapshot);
      return;
    } else if (data.kind === "start" && !checkpointId(snapshot)) {
      input = {
        reconciliationId: data.reconciliationId,
        submissionId: data.submissionId,
        effectivePolicy: data.effectivePolicy,
      };
    } else {
      if (!checkpointId(snapshot)) {
        throw new Error(
          "The failed reconciliation has no checkpoint to resume.",
        );
      }
      input = null;
    }

    await tracker.runStarted(data.kind);
    try {
      const stream = await graph.stream(input, {
        ...config,
        streamMode: ["tasks", "updates", "checkpoints"],
      });
      for await (const chunk of stream) await tracker.consume(chunk);

      snapshot = await graph.getState(config);
      await synchronizeRun(repository, data.reconciliationId, snapshot);
      await tracker.finish(graphState(snapshot));
    } catch (error) {
      if (job.retryCount < job.retryLimit) await tracker.failed(true);
      throw error;
    }
  };
}

export function createReconciliationDeadLetterHandler(
  repository: ReconciliationRepository,
  progress: ReconciliationProgressPublisher,
): WorkWithMetadataHandler<unknown> {
  return async ([job]) => {
    if (!job)
      throw new Error("pg-boss invoked the dead-letter worker without a job.");
    const data = ReconciliationJobDataSchema.parse(job.data);
    const message = readFailureMessage(job);
    console.error("Reconciliation job exhausted its retries.", {
      jobId: job.sourceId ?? job.id,
      reconciliationId: data.reconciliationId,
      error: message,
    });
    await repository.failAgentJob(data.reconciliationId, message);
    await new ReconciliationProgressTracker(
      data.reconciliationId,
      progress,
    ).failed(false);
  };
}

function graphState(snapshot: GraphSnapshot): ReconciliationGraphState {
  return snapshot.values as ReconciliationGraphState;
}

function checkpointId(snapshot: GraphSnapshot): string | undefined {
  const value = snapshot.config.configurable?.checkpoint_id;
  return typeof value === "string" ? value : undefined;
}

async function synchronizeRun(
  repository: ReconciliationRepository,
  reconciliationId: string,
  snapshot: GraphSnapshot,
): Promise<void> {
  const state = graphState(snapshot);
  if (state.pendingReview) {
    await repository.markAwaitingReview(
      reconciliationId,
      state.pendingReview.kind,
    );
    return;
  }
  if (state.terminal) {
    await repository.markTerminal(reconciliationId, state.terminal);
    return;
  }
  if (snapshot.next.length === 0) {
    throw new Error(
      "Reconciliation graph completed without a terminal outcome.",
    );
  }
}

function readFailureMessage(job: JobWithMetadata<unknown>): string {
  if (
    job.output &&
    typeof job.output === "object" &&
    "message" in job.output &&
    typeof job.output.message === "string"
  ) {
    return job.output.message;
  }
  return "Reconciliation job exhausted all retry attempts.";
}
