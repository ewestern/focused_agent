"use client";

import { useCallback, useEffect, useState } from "react";

import type { ErrorResponse } from "@/lib/contracts";
import {
  RECONCILIATION_PROGRESS_LABELS,
  reconciliationProgressEventLabel,
  ReconciliationProgressEventSchema,
  type ReconciliationProgressEvent,
  type ReconciliationProgressStage,
} from "@/lib/reconciliation-events";
import type {
  ReconciliationDetail,
  ReconciliationSummary,
} from "@/server/reconciliation/query";
import type {
  ReviewDecision,
  ReviewRequest,
} from "@/server/reconciliation/types";
import {
  ExtractedInvoiceSchema,
  InvoiceLineMatchSchema,
} from "@/server/reconciliation/types";
import { z } from "zod";
import { InvoiceUpload } from "@/components/invoice-upload";

type ListResponse = { reconciliations: ReconciliationSummary[] };
type DetailResponse = { reconciliation: ReconciliationDetail };
type ProgressConnection = "idle" | "connecting" | "live" | "reconnecting";
type ActivityStatus = "in_progress" | "completed" | "failed";

type ActivityItem = {
  id: string;
  label: string;
  occurredAt: string;
  stage?: ReconciliationProgressStage;
  status: ActivityStatus;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | ErrorResponse;
  if (!response.ok) {
    throw new Error("error" in (body as ErrorResponse) ? (body as ErrorResponse).error.message : "Request failed.");
  }
  return body as T;
}

export function InvoiceDashboard(): React.ReactElement {
  const [cases, setCases] = useState<ReconciliationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressEvents, setProgressEvents] = useState<
    ReconciliationProgressEvent[]
  >([]);
  const [progressConnection, setProgressConnection] =
    useState<ProgressConnection>("idle");

  const refresh = useCallback(async (preferredId?: string) => {
    try {
      const list = await readJson<ListResponse>(await fetch("/api/reconciliations", { cache: "no-store" }));
      setCases(list.reconciliations);
      const id = preferredId ?? selectedId ?? list.reconciliations[0]?.id ?? null;
      if (!id) {
        setDetail(null);
        return;
      }
      if (id !== selectedId) {
        setProgressEvents([]);
        setProgressConnection("connecting");
      }
      setSelectedId(id);
      const next = await readJson<DetailResponse>(
        await fetch(`/api/reconciliations/${id}`, { cache: "no-store" }),
      );
      setDetail(next.reconciliation);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dashboard could not be refreshed.");
    }
  }, [selectedId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;

    const reconciliationId = selectedId;
    const source = new EventSource(
      `/api/reconciliations/${reconciliationId}/events`,
    );
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(reconciliationId), 200);
    };

    source.addEventListener("ready", () => {
      setProgressConnection("live");
      scheduleRefresh();
    });
    source.addEventListener("progress", (message) => {
      try {
        const parsed = ReconciliationProgressEventSchema.safeParse(
          JSON.parse((message as MessageEvent<string>).data),
        );
        if (!parsed.success || parsed.data.reconciliationId !== reconciliationId) return;
        setProgressEvents((events) => [...events, parsed.data].slice(-100));
        scheduleRefresh();
      } catch {
        // Ignore malformed transient events; durable refresh remains the fallback.
      }
    });
    source.onerror = () => setProgressConnection("reconnecting");

    return () => {
      window.clearTimeout(refreshTimer);
      source.close();
    };
  }, [refresh, selectedId]);

  const selectCase = (id: string) => {
    setProgressEvents([]);
    setProgressConnection("connecting");
    setSelectedId(id);
    setDetail(null);
    void refresh(id);
  };

  return (
    <main className="invoice-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">PO reconciliation agent</p>
          <h1>Invoice review</h1>
        </div>
        <span className="reviewer-badge">local-demo-user</span>
      </header>

      {error ? <p className="dashboard-error" role="alert">{error}</p> : null}
      <section className="dashboard-columns">
        <div className="dashboard-column dashboard-column-left">
          <InvoiceUpload onQueued={selectCase} />

          <aside className="case-list" aria-label="Reconciliation queue">
            <h2>Cases</h2>
            {cases.length === 0 ? <p className="muted">No invoices have been submitted.</p> : null}
            {cases.map((item) => (
              <button
                className={item.id === selectedId ? "case-card selected" : "case-card"}
                key={item.id}
                type="button"
                onClick={() => selectCase(item.id)}
              >
                <strong>{item.invoiceNumber ?? item.originalFilename ?? "Unidentified invoice"}</strong>
                <span>{item.vendorName ?? "Vendor pending"}</span>
                <span className={`status-pill status-${item.status}`}>{item.status.replaceAll("_", " ")}</span>
              </button>
            ))}
          </aside>

          {detail ? (
            <>
              <EvidenceCard
                className="evidence-extraction"
                title="Extracted invoice"
                summary={detail.extraction ? "Available" : "Pending"}
              >
                <pre>{detail.extraction ? JSON.stringify(detail.extraction, null, 2) : "Extraction pending"}</pre>
              </EvidenceCard>
              <EvidenceCard
                className="evidence-line-matches"
                title="Line matches"
                summary={String(detail.lineMatches.length)}
              >
                <pre>{JSON.stringify(detail.lineMatches, null, 2)}</pre>
              </EvidenceCard>
            </>
          ) : null}
        </div>

        <div className="dashboard-column dashboard-column-right">
          <UserActions
            detail={detail}
            onChanged={() => detail ? void refresh(detail.id) : undefined}
          />

          <LiveActivity
            connection={progressConnection}
            detail={detail}
            events={progressEvents}
          />

          {detail ? (
            <>
              <EvidenceCard
                className="evidence-discrepancies"
                title="Policy discrepancies"
                summary={String(detail.discrepancies.length)}
              >
                {detail.discrepancies.length ? (
                  <ul>{detail.discrepancies.map((item, index) => <li key={`${item.code}:${index}`}><strong>{item.code}</strong>: {item.message}</li>)}</ul>
                ) : <p className="muted">No discrepancies recorded.</p>}
              </EvidenceCard>
              <EvidenceCard
                className="evidence-audit"
                title="Audit trail"
                summary={String(detail.checkpointHistory.length)}
              >
                <ol>{detail.checkpointHistory.map((checkpoint) => <li key={checkpoint.checkpointId}><time>{checkpoint.createdAt ? new Date(checkpoint.createdAt).toLocaleString() : "Unknown time"}</time> {checkpoint.nodes.join(", ") || checkpoint.next.join(", ") || "checkpoint"}</li>)}</ol>
              </EvidenceCard>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function EvidenceCard(props: {
  children: React.ReactNode;
  className: string;
  summary: string;
  title: string;
}): React.ReactElement {
  return (
    <details className={`evidence-card ${props.className}`}>
      <summary>
        <span>{props.title}</span>
        <span className="evidence-summary">{props.summary}</span>
      </summary>
      <div className="evidence-content">{props.children}</div>
    </details>
  );
}

function LiveActivity(props: {
  connection: ProgressConnection;
  detail: ReconciliationDetail | null;
  events: ReconciliationProgressEvent[];
}): React.ReactElement {
  const activityItems = toActivityItems(props.events);

  return (
    <section className="live-activity" aria-label="Live activity" aria-live="polite">
      <header className="activity-case-header">
        <div>
          <p className="eyebrow">{props.detail ? props.detail.status.replaceAll("_", " ") : "Case activity"}</p>
          <h2>{props.detail?.invoiceNumber ?? props.detail?.originalFilename ?? "Select a case"}</h2>
          <p>{props.detail ? `${props.detail.vendorName ?? "Vendor unresolved"} · ${props.detail.total ? `${props.detail.total} ${props.detail.currency ?? ""}` : "Amount pending"}` : "Choose a case to follow its reconciliation."}</p>
        </div>
        {props.detail ? (
          <a className="secondary-button" href={`/api/reconciliations/${props.detail.id}/document`} target="_blank" rel="noreferrer">
            View source
          </a>
        ) : null}
      </header>
      <header className="activity-feed-header">
        <h3>Live activity</h3>
        <span className={`connection-state connection-${props.connection}`}>
          {props.connection}
        </span>
      </header>
      {activityItems.length ? (
        <ol>
          {activityItems.map((item) => (
            <li key={item.id}>
              <span
                className={`activity-marker activity-${item.status.replace("_", "-")}`}
              />
              <span>{item.label}</span>
              <span className={`activity-status activity-status-${item.status.replace("_", "-")}`}>
                {item.status.replace("_", " ")}
              </span>
              <time>{new Date(item.occurredAt).toLocaleTimeString()}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Waiting for live agent activity.</p>
      )}
    </section>
  );
}

function toActivityItems(events: ReconciliationProgressEvent[]): ActivityItem[] {
  return events.reduce<ActivityItem[]>((items, event) => {
    if (event.kind === "stage.started") {
      const existingIndex = items.findIndex((item) => item.stage === event.stage);
      const startedItem: ActivityItem = {
        id: event.id,
        label: RECONCILIATION_PROGRESS_LABELS[event.stage],
        occurredAt: event.occurredAt,
        stage: event.stage,
        status: "in_progress",
      };
      if (existingIndex >= 0) items[existingIndex] = startedItem;
      else items.push(startedItem);
      return items;
    }

    if (event.kind === "stage.completed") {
      const startedIndex = items.findIndex((item) => item.stage === event.stage);
      if (startedIndex >= 0) {
        items[startedIndex] = {
          ...items[startedIndex]!,
          occurredAt: event.occurredAt,
          status: "completed",
        };
      } else {
        items.push({
          id: event.id,
          label: RECONCILIATION_PROGRESS_LABELS[event.stage],
          occurredAt: event.occurredAt,
          stage: event.stage,
          status: "completed",
        });
      }
      return items;
    }

    if (event.kind === "run.failed") {
      const activeIndex = items.findLastIndex((item) => item.status === "in_progress");
      if (activeIndex >= 0) {
        items[activeIndex] = {
          ...items[activeIndex]!,
          occurredAt: event.occurredAt,
          status: "failed",
        };
        return items;
      }
    }

    items.push({
      id: event.id,
      label: reconciliationProgressEventLabel(event),
      occurredAt: event.occurredAt,
      status: event.kind === "run.failed"
        ? "failed"
        : event.kind === "run.started" || event.kind === "run.resumed" || event.kind === "run.retrying"
          ? "in_progress"
          : "completed",
    });
    return items;
  }, []);
}

function UserActions(props: {
  detail: ReconciliationDetail | null;
  onChanged: () => void;
}): React.ReactElement {
  return (
    <aside className="user-actions" aria-label="User actions">
      <header className="user-actions-header">
        <p className="eyebrow">Review queue</p>
        <h2>Actions</h2>
      </header>

      {props.detail ? (
        <>
          {props.detail.failureMessage ? (
            <section className="review-panel error-panel">
              <h3>Processing failed</h3>
              <p>{props.detail.failureMessage}</p>
              <button className="primary-button" type="button" onClick={async () => {
                await fetch(`/api/reconciliations/${props.detail!.id}/retry`, { method: "POST" });
                props.onChanged();
              }}>Retry</button>
            </section>
          ) : null}

          {props.detail.pendingReview ? (
            <ReviewPanel detail={props.detail} review={props.detail.pendingReview} onChanged={props.onChanged} />
          ) : !props.detail.failureMessage ? (
            <section className="action-card action-empty">
              <h3>No action required</h3>
              <p>The agent is currently {props.detail.stage.replaceAll("_", " ")}.</p>
            </section>
          ) : null}
        </>
      ) : (
        <section className="action-card action-empty">
          <h3>No case selected</h3>
          <p>Select a case to see its available actions.</p>
        </section>
      )}
    </aside>
  );
}

function ReviewPanel(props: {
  detail: ReconciliationDetail;
  review: ReviewRequest;
  onChanged: () => void;
}): React.ReactElement {
  if (props.review.kind === "exception") {
    return <ExceptionReview {...props} review={props.review} />;
  }
  if (props.review.kind === "payment") {
    return <PaymentReview {...props} review={props.review} />;
  }
  return <EmailReview {...props} review={props.review} />;
}

type ReviewOfKind<Kind extends ReviewRequest["kind"]> = Extract<
  ReviewRequest,
  { kind: Kind }
>;

type WithoutReviewIdentity<Decision> = Decision extends ReviewDecision
  ? Omit<Decision, "reviewId" | "kind">
  : never;
type DecisionFields = WithoutReviewIdentity<ReviewDecision>;

async function submitReview(
  detail: ReconciliationDetail,
  review: ReviewRequest,
  decision: DecisionFields,
): Promise<void> {
  await readJson<DetailResponse>(await fetch(`/api/reconciliations/${detail.id}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checkpointId: detail.checkpointId,
      decision: { reviewId: review.reviewId, kind: review.kind, ...decision },
    }),
  }));
}

function ExceptionReview(props: {
  detail: ReconciliationDetail;
  review: ReviewOfKind<"exception">;
  onChanged: () => void;
}): React.ReactElement {
  const vendors = props.review.payload.vendorCandidates;
  const purchaseOrders = [
    ...props.review.payload.purchaseOrderCandidates.map(
      (candidate) => candidate.purchaseOrder,
    ),
    ...props.review.payload.exactPurchaseOrderCandidates,
  ];
  const [vendorId, setVendorId] = useState(String(props.detail.selectedVendorId ?? vendors[0]?.id ?? ""));
  const [purchaseOrderId, setPurchaseOrderId] = useState(String(props.detail.selectedPurchaseOrderId ?? purchaseOrders[0]?.id ?? ""));
  const [extraction, setExtraction] = useState(JSON.stringify(props.detail.extraction, null, 2));
  const [lineMatches, setLineMatches] = useState(JSON.stringify(props.detail.lineMatches, null, 2));
  const [message, setMessage] = useState<string | null>(null);

  async function continueReview(): Promise<void> {
    try {
      const correctedExtraction =
        extraction && extraction !== "null"
          ? ExtractedInvoiceSchema.parse(JSON.parse(extraction))
          : undefined;
      const correctedLineMatches = lineMatches
        ? z.array(InvoiceLineMatchSchema).parse(JSON.parse(lineMatches))
        : undefined;
      await submitReview(props.detail, props.review, {
        action: "continue",
        ...(vendorId ? { vendorId } : {}),
        ...(purchaseOrderId ? { purchaseOrderId } : {}),
        ...(correctedExtraction ? { extraction: correctedExtraction } : {}),
        ...(correctedLineMatches ? { lineMatches: correctedLineMatches } : {}),
      });
      props.onChanged();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Review could not be submitted.");
    }
  }

  return (
    <section className="review-panel">
      <h3>{props.review.title}</h3>
      <p>{props.review.summary}</p>
      {vendors.length ? <label>Vendor<select value={vendorId} onChange={(event) => setVendorId(event.target.value)}>{vendors.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label> : null}
      {purchaseOrders.length ? <label>Purchase order<select value={purchaseOrderId} onChange={(event) => setPurchaseOrderId(event.target.value)}>{purchaseOrders.map((item) => <option value={item.id} key={item.id}>{item.poNumber}</option>)}</select></label> : null}
      <label>Corrected extraction JSON<textarea rows={12} value={extraction} onChange={(event) => setExtraction(event.target.value)} /></label>
      <label>Line-match JSON<textarea rows={7} value={lineMatches} onChange={(event) => setLineMatches(event.target.value)} /></label>
      {message ? <p className="dashboard-error">{message}</p> : null}
      <div className="review-actions">
        <button className="primary-button" type="button" onClick={() => void continueReview()}>Continue reconciliation</button>
        <button className="secondary-action" type="button" onClick={async () => { await submitReview(props.detail, props.review, { action: "cancel" }); props.onChanged(); }}>Cancel case</button>
      </div>
    </section>
  );
}

function PaymentReview(props: {
  detail: ReconciliationDetail;
  review: ReviewOfKind<"payment">;
  onChanged: () => void;
}): React.ReactElement {
  const [reason, setReason] = useState("");
  return (
    <section className="review-panel approval-panel">
      <h3>{props.review.title}</h3><p>{props.review.summary}</p>
      <label>Dispute reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required only when routing to dispute" /></label>
      <div className="review-actions">
        <button className="primary-button" type="button" onClick={async () => { await submitReview(props.detail, props.review, { action: "approve_payment" }); props.onChanged(); }}>Approve payment</button>
        <button className="secondary-action" type="button" disabled={!reason.trim()} onClick={async () => { await submitReview(props.detail, props.review, { action: "route_to_dispute", reason }); props.onChanged(); }}>Route to dispute</button>
        <button className="danger-action" type="button" onClick={async () => { await submitReview(props.detail, props.review, { action: "cancel" }); props.onChanged(); }}>Cancel</button>
      </div>
    </section>
  );
}

function EmailReview(props: {
  detail: ReconciliationDetail;
  review: ReviewOfKind<"email">;
  onChanged: () => void;
}): React.ReactElement {
  const initial = props.review.payload.email.draft;
  const [to, setTo] = useState(initial?.to.join(", ") ?? "");
  const [cc, setCc] = useState(initial?.cc.join(", ") ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.text ?? "");
  const addresses = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
  return (
    <section className="review-panel email-panel">
      <h3>{props.review.title}</h3><p>{props.review.summary}</p>
      <label>To<input type="email" multiple value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label>CC<input type="email" multiple value={cc} onChange={(event) => setCc(event.target.value)} /></label>
      <label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
      <label>Message<textarea rows={10} value={body} onChange={(event) => setBody(event.target.value)} /></label>
      <div className="review-actions">
        <button className="primary-button" type="button" disabled={!to.trim() || !subject.trim() || !body.trim()} onClick={async () => { await submitReview(props.detail, props.review, { action: "send_email", draft: { to: addresses(to), cc: addresses(cc), subject, text: body } }); props.onChanged(); }}>Send email</button>
        <button className="danger-action" type="button" onClick={async () => { await submitReview(props.detail, props.review, { action: "cancel" }); props.onChanged(); }}>Cancel</button>
      </div>
    </section>
  );
}
