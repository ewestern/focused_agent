"use client";

import { type FormEvent, useState } from "react";

import {
  MAX_INVOICE_DOCUMENT_BYTES,
  type ErrorResponse,
  type InvoiceSubmissionResponse,
} from "@/lib/contracts";

export function InvoiceUpload(props: {
  onQueued?: (reconciliationId: string) => void;
}): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<InvoiceSubmissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file || isUploading) return;
    setIsUploading(true);
    setError(null);
    setResult(null);

    if (file.size > MAX_INVOICE_DOCUMENT_BYTES) {
      setError("Invoice documents must be 20 MB or smaller.");
      setIsUploading(false);
      return;
    }

    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch("/api/invoice-submissions", {
        method: "POST",
        body,
      });
      const responseBody = (await response.json()) as
        | InvoiceSubmissionResponse
        | ErrorResponse;
      if (!response.ok || !("submission" in responseBody)) {
        throw new Error(
          "error" in responseBody
            ? responseBody.error.message
            : "The upload could not be completed.",
        );
      }
      form.reset();
      setFile(null);
      setResult(responseBody);
      if (responseBody.submission.reconciliationId) {
        props.onQueued?.(responseBody.submission.reconciliationId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
      <section className="upload-panel" aria-label="Invoice upload">
        <header className="upload-header">
          <div>
            <p className="eyebrow">Invoice intake</p>
            <h2>Submit an invoice</h2>
          </div>
        </header>

        <div className="upload-copy">
          <p>Upload a PDF or image to start reconciliation.</p>
        </div>

        <form className="upload-form" onSubmit={submit}>
          <label className="file-field" htmlFor="invoice-file">
            <span>Invoice document</span>
            <input
              id="invoice-file"
              name="file"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              required
              disabled={isUploading}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError(null);
                setResult(null);
              }}
            />
            <small>PDF, PNG, or JPEG · maximum 20 MB</small>
          </label>
          <button className="primary-button" type="submit" disabled={!file || isUploading}>
            {isUploading ? "Uploading…" : "Upload and reconcile"}
          </button>
        </form>

        {error ? <p className="upload-message error-message" role="alert">{error}</p> : null}
        {result ? (
          <section className="upload-result" aria-live="polite">
            <p className="result-label">Received</p>
            <h2>{result.submission.documents[0]?.originalFilename}</h2>
            <dl>
              <div>
                <dt>Submission ID</dt>
                <dd>{result.submission.id}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>queued</dd>
              </div>
            </dl>
          </section>
        ) : null}
      </section>
  );
}
