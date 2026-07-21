import { describe, expect, it, vi } from "vitest";

import {
  createReconciliationProgressEvent,
  reconciliationProgressEventLabel,
  type ReconciliationProgressEvent,
} from "@/lib/reconciliation-events";
import {
  parseReconciliationProgressPayload,
  ReconciliationProgressSubscriptions,
} from "@/server/reconciliation/progress-broker";
import {
  ReconciliationProgressTracker,
  serializeReconciliationProgressEvent,
  type ReconciliationProgressPublisher,
} from "@/server/reconciliation/progress";

const reconciliationId = "00000000-0000-4000-8000-000000000040";

describe("reconciliation progress", () => {
  it("publishes starts immediately and completions only after a checkpoint", async () => {
    const events: ReconciliationProgressEvent[] = [];
    const tracker = new ReconciliationProgressTracker(
      reconciliationId,
      collectingPublisher(events),
    );

    await tracker.runStarted("start");
    await tracker.consume([
      "tasks",
      { id: "task", name: "extract_invoice", input: { secret: "raw invoice" } },
    ]);
    await tracker.consume([
      "updates",
      { extract_invoice: { extraction: { invoiceNumber: "SECRET-1" } } },
    ]);

    expect(events.map((event) => event.kind)).toEqual([
      "run.started",
      "stage.started",
    ]);

    await tracker.consume(["checkpoints", { values: { secret: "raw invoice" } }]);

    expect(events.map((event) => event.kind)).toEqual([
      "run.started",
      "stage.started",
      "stage.completed",
    ]);
    expect(JSON.stringify(events)).not.toContain("raw invoice");
    expect(JSON.stringify(events)).not.toContain("SECRET-1");
  });

  it("does not treat failed task result records as successful completion", async () => {
    const events: ReconciliationProgressEvent[] = [];
    const tracker = new ReconciliationProgressTracker(
      reconciliationId,
      collectingPublisher(events),
    );

    await tracker.consume([
      "tasks",
      { id: "task", name: "match_vendor", input: {} },
    ]);
    await tracker.consume([
      "tasks",
      { id: "task", name: "match_vendor", result: {}, interrupts: [] },
    ]);
    await tracker.failed(true);

    expect(events.map((event) => event.kind)).toEqual([
      "stage.started",
      "run.retrying",
    ]);
  });

  it("emits review and terminal labels from the durable final state", async () => {
    const events: ReconciliationProgressEvent[] = [];
    const tracker = new ReconciliationProgressTracker(
      reconciliationId,
      collectingPublisher(events),
    );

    await tracker.finish({
      pendingReview: {
        reviewId: "00000000-0000-4000-8000-000000000041",
        reconciliationId,
        kind: "payment",
        title: "Review",
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
    });

    expect(events).toHaveLength(1);
    expect(reconciliationProgressEventLabel(events[0]!)).toBe(
      "Payment approval required",
    );
  });

  it("routes valid notifications only to subscribers for that reconciliation", () => {
    const subscriptions = new ReconciliationProgressSubscriptions();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = subscriptions.subscribe(reconciliationId, first);
    subscriptions.subscribe(
      "00000000-0000-4000-8000-000000000042",
      second,
    );
    const event = createReconciliationProgressEvent(reconciliationId, {
      kind: "run.started",
    });

    subscriptions.dispatch(event);
    unsubscribe();
    subscriptions.dispatch(event);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(parseReconciliationProgressPayload(JSON.stringify(event))).toEqual(event);
  });

  it("serializes only the validated, bounded public contract", () => {
    const event = createReconciliationProgressEvent(reconciliationId, {
      kind: "stage.completed",
      stage: "evaluate_policy",
    });

    expect(JSON.parse(serializeReconciliationProgressEvent(event))).toEqual(event);
  });

  it("uses vendor-email terminology for outreach progress and completion", () => {
    const composing = createReconciliationProgressEvent(reconciliationId, {
      kind: "stage.started",
      stage: "compose_vendor_email",
    });
    const completed = createReconciliationProgressEvent(reconciliationId, {
      kind: "run.completed",
      status: "email_sent",
    });

    expect(reconciliationProgressEventLabel(composing)).toBe(
      "Drafting vendor email…",
    );
    expect(reconciliationProgressEventLabel(completed)).toBe("Vendor email sent");
  });
});

function collectingPublisher(
  events: ReconciliationProgressEvent[],
): ReconciliationProgressPublisher {
  return {
    publish: vi.fn(async (event: ReconciliationProgressEvent) => {
      events.push(event);
    }),
  };
}
