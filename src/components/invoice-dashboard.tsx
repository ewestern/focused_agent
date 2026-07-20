"use client";

import { useCallback, useEffect, useState } from "react";

import type { ErrorResponse } from "@/lib/contracts";
import type {
  ReconciliationDetail,
  ReconciliationSummary,
} from "@/server/reconciliation/repository";
import type { EmailDraft, ReviewRequest } from "@/server/reconciliation/types";
import { InvoiceUpload } from "@/components/invoice-upload";

type ListResponse = { reconciliations: ReconciliationSummary[] };
type DetailResponse = { reconciliation: ReconciliationDetail };

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | ErrorResponse;
  if (!response.ok) {
    throw new Error("error" in (body as ErrorResponse) ? (body as ErrorResponse).error.message : "Request failed.");
  }
  return body as T;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

export function InvoiceDashboard(): React.ReactElement {
  const [cases, setCases] = useState<ReconciliationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (preferredId?: string) => {
    try {
      const list = await readJson<ListResponse>(await fetch("/api/reconciliations", { cache: "no-store" }));
      setCases(list.reconciliations);
      const id = preferredId ?? selectedId ?? list.reconciliations[0]?.id ?? null;
      if (!id) {
        setDetail(null);
        return;
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
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return (
    <main className="invoice-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">PO reconciliation agent</p>
          <h1>Invoice review</h1>
        </div>
        <span className="reviewer-badge">local-demo-user</span>
      </header>

      <InvoiceUpload onQueued={(id) => void refresh(id)} />

      {error ? <p className="dashboard-error" role="alert">{error}</p> : null}
      <section className="dashboard-grid">
        <aside className="case-list" aria-label="Reconciliation queue">
          <h2>Cases</h2>
          {cases.length === 0 ? <p className="muted">No invoices have been submitted.</p> : null}
          {cases.map((item) => (
            <button
              className={item.id === selectedId ? "case-card selected" : "case-card"}
              key={item.id}
              type="button"
              onClick={() => void refresh(item.id)}
            >
              <strong>{item.invoiceNumber ?? item.originalFilename ?? "Unidentified invoice"}</strong>
              <span>{item.vendorName ?? "Vendor pending"}</span>
              <span className={`status-pill status-${item.status}`}>{item.status.replaceAll("_", " ")}</span>
            </button>
          ))}
        </aside>

        <section className="case-detail" aria-live="polite">
          {detail ? (
            <CaseDetail
              key={`${detail.id}:${detail.version}:${detail.pendingReview?.reviewId ?? "none"}`}
              detail={detail}
              onChanged={() => void refresh(detail.id)}
            />
          ) : (
            <div className="detail-empty">
              <h2>Select a case</h2>
              <p>Upload an invoice or select an existing reconciliation.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function CaseDetail(props: {
  detail: ReconciliationDetail;
  onChanged: () => void;
}): React.ReactElement {
  const { detail } = props;
  return (
    <>
      <header className="detail-header">
        <div>
          <p className="eyebrow">{detail.status.replaceAll("_", " ")}</p>
          <h2>{detail.invoiceNumber ?? detail.originalFilename ?? "Invoice"}</h2>
          <p>{detail.vendorName ?? "Vendor unresolved"} · {detail.total ? `${detail.total} ${detail.currency ?? ""}` : "Amount pending"}</p>
        </div>
        <a className="secondary-button" href={`/api/reconciliations/${detail.id}/document`} target="_blank" rel="noreferrer">
          View source
        </a>
      </header>

      {detail.failureMessage ? (
        <section className="review-panel error-panel">
          <h3>Processing failed</h3>
          <p>{detail.failureMessage}</p>
          <button className="primary-button" type="button" onClick={async () => {
            await fetch(`/api/reconciliations/${detail.id}/retry`, { method: "POST" });
            props.onChanged();
          }}>Retry</button>
        </section>
      ) : null}

      {detail.pendingReview ? (
        <ReviewPanel detail={detail} review={detail.pendingReview} onChanged={props.onChanged} />
      ) : (
        <section className="review-panel">
          <h3>Current stage</h3>
          <p>{detail.stage.replaceAll("_", " ")}</p>
        </section>
      )}

      <section className="evidence-grid">
        <article>
          <h3>Extracted invoice</h3>
          <pre>{detail.extraction ? JSON.stringify(detail.extraction, null, 2) : "Extraction pending"}</pre>
        </article>
        <article>
          <h3>Policy discrepancies</h3>
          {detail.discrepancies.length ? (
            <ul>{detail.discrepancies.map((item, index) => <li key={`${item.code}:${index}`}><strong>{item.code}</strong>: {item.message}</li>)}</ul>
          ) : <p className="muted">No discrepancies recorded.</p>}
        </article>
        <article>
          <h3>Line matches</h3>
          <pre>{JSON.stringify(detail.lineMatches, null, 2)}</pre>
        </article>
        <article>
          <h3>Audit trail</h3>
          <ol>{detail.events.map((event) => <li key={event.id}><time>{new Date(event.createdAt).toLocaleString()}</time> {event.type}</li>)}</ol>
        </article>
      </section>
    </>
  );
}

function ReviewPanel(props: {
  detail: ReconciliationDetail;
  review: ReviewRequest;
  onChanged: () => void;
}): React.ReactElement {
  if (props.review.kind === "exception") return <ExceptionReview {...props} />;
  if (props.review.kind === "payment") return <PaymentReview {...props} />;
  return <EmailReview {...props} />;
}

async function submitReview(
  detail: ReconciliationDetail,
  review: ReviewRequest,
  decision: Record<string, unknown>,
): Promise<void> {
  await readJson<DetailResponse>(await fetch(`/api/reconciliations/${detail.id}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedVersion: review.requestedVersion,
      decision: { reviewId: review.reviewId, kind: review.kind, ...decision },
    }),
  }));
}

function ExceptionReview(props: {
  detail: ReconciliationDetail;
  review: ReviewRequest;
  onChanged: () => void;
}): React.ReactElement {
  const vendors = records(props.review.payload.vendorCandidates);
  const purchaseOrders = [
    ...records(props.review.payload.purchaseOrderCandidates),
    ...records(props.review.payload.exactPurchaseOrderCandidates),
  ].map((item) => {
    const purchaseOrder = item.purchaseOrder;
    return typeof purchaseOrder === "object" && purchaseOrder !== null
      ? purchaseOrder as Record<string, unknown>
      : item;
  });
  const [vendorId, setVendorId] = useState(String(props.detail.selectedVendorId ?? vendors[0]?.id ?? ""));
  const [purchaseOrderId, setPurchaseOrderId] = useState(String(props.detail.selectedPurchaseOrderId ?? purchaseOrders[0]?.id ?? ""));
  const [extraction, setExtraction] = useState(JSON.stringify(props.detail.extraction, null, 2));
  const [lineMatches, setLineMatches] = useState(JSON.stringify(props.detail.lineMatches, null, 2));
  const [message, setMessage] = useState<string | null>(null);

  async function continueReview(): Promise<void> {
    try {
      await submitReview(props.detail, props.review, {
        action: "continue",
        ...(vendorId ? { vendorId } : {}),
        ...(purchaseOrderId ? { purchaseOrderId } : {}),
        ...(extraction && extraction !== "null" ? { extraction: JSON.parse(extraction) as unknown } : {}),
        ...(lineMatches ? { lineMatches: JSON.parse(lineMatches) as unknown } : {}),
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
      {vendors.length ? <label>Vendor<select value={vendorId} onChange={(event) => setVendorId(event.target.value)}>{vendors.map((item) => <option value={String(item.id)} key={String(item.id)}>{String(item.displayName ?? item.legalName ?? item.id)}</option>)}</select></label> : null}
      {purchaseOrders.length ? <label>Purchase order<select value={purchaseOrderId} onChange={(event) => setPurchaseOrderId(event.target.value)}>{purchaseOrders.map((item) => <option value={String(item.id)} key={String(item.id)}>{String(item.poNumber ?? item.id)}</option>)}</select></label> : null}
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
  review: ReviewRequest;
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
  review: ReviewRequest;
  onChanged: () => void;
}): React.ReactElement {
  const initial = (props.review.payload.draft ?? props.detail.emailDraft) as EmailDraft | null;
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
