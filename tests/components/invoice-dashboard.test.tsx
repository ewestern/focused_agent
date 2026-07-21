// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvoiceDashboard } from "@/components/invoice-dashboard";
import { createReconciliationProgressEvent } from "@/lib/reconciliation-events";

const reconciliationId = "00000000-0000-4000-8000-000000000060";

describe("invoice dashboard live activity", () => {
  afterEach(() => {
    FakeEventSource.instances = [];
    vi.unstubAllGlobals();
  });

  it("subscribes to the selected case and displays validated progress", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/reconciliations") {
        return Response.json({ reconciliations: [summary()] });
      }
      if (url === `/api/reconciliations/${reconciliationId}`) {
        return Response.json({ reconciliation: detail() });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    vi.stubGlobal("EventSource", FakeEventSource);

    const rendered = render(<InvoiceDashboard />);

    expect(await screen.findByRole("heading", { name: "INV-60" })).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe(`/api/reconciliations/${reconciliationId}/events`);

    source.emit("ready", { reconciliationId });
    source.emit(
      "progress",
      createReconciliationProgressEvent(reconciliationId, {
        kind: "stage.started",
        stage: "extract_invoice",
      }),
    );

    expect(await screen.findByText("Extracting invoice…")).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();

    rendered.unmount();
    expect(source.closed).toBe(true);
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set();
    const callback = typeof listener === "function"
      ? listener as (event: MessageEvent<string>) => void
      : (event: MessageEvent<string>) => listener.handleEvent(event);
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close(): void {
    this.closed = true;
  }
}

function summary() {
  return {
    id: reconciliationId,
    submissionId: "00000000-0000-4000-8000-000000000061",
    status: "processing",
    stage: "extract_invoice",
    originalFilename: "invoice.pdf",
    invoiceNumber: "INV-60",
    vendorName: "Demo Vendor",
    total: "10.00",
    currency: "USD",
    createdAt: "2026-07-21T12:00:00.000Z",
    updatedAt: "2026-07-21T12:00:00.000Z",
  };
}

function detail() {
  return {
    ...summary(),
    checkpointId: "checkpoint-1",
    extractionModel: null,
    extraction: null,
    selectedVendorId: null,
    selectedPurchaseOrderId: null,
    vendorCandidates: [],
    purchaseOrderCandidates: [],
    receivingSnapshot: [],
    lineMatches: [],
    discrepancies: [],
    vendorEmail: null,
    failureCode: null,
    failureMessage: null,
    pendingReview: null,
    checkpointHistory: [],
    payment: null,
    emailDelivery: null,
  };
}
