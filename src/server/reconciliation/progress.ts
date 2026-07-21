import type { Pool } from "pg";

import {
  createReconciliationProgressEvent,
  ReconciliationProgressEventSchema,
  ReconciliationProgressStageSchema,
  type ReconciliationProgressEvent,
  type ReconciliationProgressEventInput,
  type ReconciliationProgressStage,
} from "@/lib/reconciliation-events";
import type { ReconciliationGraphState } from "@/server/agent/graph";

export const RECONCILIATION_PROGRESS_CHANNEL = "reconciliation_progress_v1";
export const MAX_POSTGRES_NOTIFICATION_BYTES = 7_900;

export interface ReconciliationProgressPublisher {
  publish(event: ReconciliationProgressEvent): Promise<void>;
}

export class PostgresReconciliationProgressPublisher
  implements ReconciliationProgressPublisher
{
  constructor(private readonly pool: Pool) {}

  async publish(event: ReconciliationProgressEvent): Promise<void> {
    const payload = serializeReconciliationProgressEvent(event);
    await this.pool.query("select pg_notify($1, $2)", [
      RECONCILIATION_PROGRESS_CHANNEL,
      payload,
    ]);
  }
}

export function serializeReconciliationProgressEvent(
  event: ReconciliationProgressEvent,
): string {
  const payload = JSON.stringify(ReconciliationProgressEventSchema.parse(event));
  if (Buffer.byteLength(payload, "utf8") > MAX_POSTGRES_NOTIFICATION_BYTES) {
    throw new Error("Reconciliation progress event exceeds the PostgreSQL payload limit.");
  }
  return payload;
}

export class ReconciliationProgressTracker {
  private readonly pendingCompletions = new Set<ReconciliationProgressStage>();

  constructor(
    private readonly reconciliationId: string,
    private readonly publisher: ReconciliationProgressPublisher,
  ) {}

  async runStarted(kind: "start" | "resume" | "retry"): Promise<void> {
    await this.emit({ kind: kind === "start" ? "run.started" : "run.resumed" });
  }

  async consume(chunk: unknown): Promise<void> {
    if (!Array.isArray(chunk) || chunk.length !== 2) return;
    const [mode, payload] = chunk;
    if (mode === "tasks") {
      await this.consumeTask(payload);
      return;
    }
    if (mode === "updates") {
      this.consumeUpdate(payload);
      return;
    }
    if (mode === "checkpoints") {
      await this.flushCompletions();
    }
  }

  async finish(
    state: Partial<Pick<ReconciliationGraphState, "pendingReview" | "terminal">>,
  ): Promise<void> {
    await this.flushCompletions();
    if (state.pendingReview) {
      await this.emit({ kind: "review.required", review: state.pendingReview.kind });
      return;
    }
    if (state.terminal) {
      await this.emit({ kind: "run.completed", status: state.terminal });
    }
  }

  async failed(willRetry: boolean): Promise<void> {
    await this.emit({ kind: willRetry ? "run.retrying" : "run.failed" });
  }

  private async consumeTask(payload: unknown): Promise<void> {
    if (!isRecord(payload) || !("input" in payload) || typeof payload.name !== "string") {
      return;
    }
    const stage = ReconciliationProgressStageSchema.safeParse(payload.name);
    if (stage.success) await this.emit({ kind: "stage.started", stage: stage.data });
  }

  private consumeUpdate(payload: unknown): void {
    if (!isRecord(payload)) return;
    for (const node of Object.keys(payload)) {
      const stage = ReconciliationProgressStageSchema.safeParse(node);
      if (stage.success) this.pendingCompletions.add(stage.data);
    }
  }

  private async flushCompletions(): Promise<void> {
    const stages = [...this.pendingCompletions];
    this.pendingCompletions.clear();
    for (const stage of stages) {
      await this.emit({ kind: "stage.completed", stage });
    }
  }

  private async emit(input: ReconciliationProgressEventInput): Promise<void> {
    try {
      await this.publisher.publish(
        createReconciliationProgressEvent(this.reconciliationId, input),
      );
    } catch (error) {
      console.warn("Reconciliation progress event could not be published.", {
        reconciliationId: this.reconciliationId,
        kind: input.kind,
        error,
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
