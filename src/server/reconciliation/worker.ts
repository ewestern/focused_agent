import { Command, isInterrupted } from "@langchain/langgraph";
import type { JobWithMetadata, WorkWithMetadataHandler } from "pg-boss";

import {
  compileInvoiceReconciliationGraph,
  type ReconciliationServices,
} from "@/server/agent/graph";
import { ReconciliationJobDataSchema } from "@/server/reconciliation/jobs";

type ReconciliationGraph = ReturnType<typeof compileInvoiceReconciliationGraph>;

export function createReconciliationJobHandler(
  graph: ReconciliationGraph,
  services: ReconciliationServices,
): WorkWithMetadataHandler<unknown> {
  return async ([job]) => {
    if (!job) throw new Error("pg-boss invoked the worker without a job.");
    const data = ReconciliationJobDataSchema.parse(job.data);
    const config = {
      configurable: { thread_id: data.reconciliationId },
      context: { services },
    };
    const input =
      data.kind === "resume"
        ? new Command({ resume: data.payload })
        : data.kind === "retry"
          ? null
          : { reconciliationId: data.reconciliationId };
    const result = await graph.invoke(input as never, config);
    if (isInterrupted(result)) {
      console.log(`Reconciliation ${data.reconciliationId} is awaiting review.`);
    }
  };
}

export function createReconciliationDeadLetterHandler(
  services: ReconciliationServices,
): WorkWithMetadataHandler<unknown> {
  return async ([job]) => {
    if (!job) throw new Error("pg-boss invoked the dead-letter worker without a job.");
    const data = ReconciliationJobDataSchema.parse(job.data);
    const message = readFailureMessage(job);
    console.error("Reconciliation job exhausted its retries.", {
      jobId: job.sourceId ?? job.id,
      reconciliationId: data.reconciliationId,
      error: message,
    });
    await services.reconciliations.failAgentJob(data.reconciliationId, message);
  };
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
