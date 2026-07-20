# Focused Agent

A runnable PO/invoice reconciliation agent built with Next.js, TypeScript,
LangGraph/LangChain, Postgres, pgvector, pg-boss, MinIO, and SMTP. Uploading an invoice
creates a durable reconciliation case and queues it for a separate worker. The
dashboard shows the extracted evidence, matches, discrepancies, audit events, and
human approval tasks.

## Reconciliation workflow

The top-level graph is exported from `src/server/agent/graph.ts` as both an
inspectable definition and a compiled preview:

- `invoiceReconciliationGraphDefinition` can be compiled with a checkpointer.
- `invoiceReconciliationGraph` can be imported directly for topology inspection
  and Mermaid generation.
- `compileInvoiceReconciliationGraph` is used by the worker with Postgres-backed
  LangGraph checkpoints.

The graph performs these stages:

1. Load the uploaded source document and extract a typed invoice with evidence.
2. Prefer exact PO lookup, match the vendor, and fall back to semantic PO
   candidates when exact resolution fails.
3. Load receiving records and prior invoice allocations, then map invoice lines to
   PO lines.
4. Evaluate the stored strict three-way policy snapshot.
5. Interrupt for payment approval when the invoice passes policy.
6. Compose a dispute email when it fails policy, then interrupt for editing and
   send approval.
7. Remit an approved payment or send an approved email through idempotency ledgers.

Low-confidence extraction, ambiguous vendors or lines, semantic-only PO candidates,
and remittance-time accounting conflicts interrupt into an exception review instead
of being guessed through.

The default policy is code-owned in `src/server/reconciliation/policy.ts` and copied
onto each reconciliation when it is created. It currently requires an open PO,
exact prices and quantities, receiving records, unique line mappings, valid invoice
arithmetic, no unsupported tax/freight charges, and no duplicate vendor invoice
number.

## Local stack

Requirements: Docker with Compose and an OpenAI API key. Model access is exclusively
through LangChain's `ChatOpenAI` and embeddings adapters; the application does not
call a provider SDK directly.

```bash
cp .env.example .env
# Set OPENAI_API_KEY in .env.
docker compose up --build
```

Open:

- Dashboard: <http://localhost:3000/invoices>
- Captured email: <http://localhost:8025>
- MinIO console: <http://localhost:9001>
- Readiness: <http://localhost:3000/api/health>

Compose starts pgvector Postgres, MinIO, Mailpit, an idempotent setup/migration/seed
job, the reconciliation worker, and the web app. When `OPENAI_API_KEY` is present,
setup also builds or refreshes the semantic PO index. Readiness is HTTP 200 only
when Postgres, pgvector, object storage, SMTP, and agent configuration are healthy.
Worker process health is owned by the container runtime rather than the web app.

To stop without deleting data:

```bash
docker compose down
```

To intentionally delete the named local volumes as well:

```bash
docker compose down --volumes
```

## Host-based development

Use Node.js 24 and pnpm:

```bash
cp .env.example .env
# Set OPENAI_API_KEY in .env.
docker compose up -d db minio mailpit
pnpm install
pnpm db:setup
pnpm dev
```

Run the durable worker in another terminal:

```bash
pnpm agent:worker
```

`pnpm db:setup` enables pgvector, installs LangGraph's checkpoint schema, applies
the checked-in Drizzle migration, installs or upgrades pg-boss's separately managed
schema, configures the reconciliation and dead-letter queues, ensures the invoice
bucket exists, optionally seeds demo accounting data, and indexes seeded POs when
an API key is configured. Each step is idempotent. The index can also be refreshed
explicitly:

```bash
pnpm accounting:index-purchase-orders
```

The example configuration uses `gpt-5.6-luna`; change `AGENT_MODEL` in `.env`
to use another LangChain-supported model identifier. Runtime service, model,
and credential settings must be supplied explicitly.

## Dashboard and API

The root route redirects to `/invoices`. The dashboard polls the durable case state
and supports exception correction, payment approval or dispute routing, dispute
email editing/sending, cancellation, and retry of failed jobs.

- `POST /api/invoice-submissions` accepts multipart form data with exactly one
  `file` field. PDF, PNG, and JPEG files up to 20 MB are accepted. The response
  includes the queued reconciliation ID.
- `GET /api/invoice-submissions/:id` returns intake metadata.
- `GET /api/reconciliations` lists cases.
- `GET /api/reconciliations/:id` returns case evidence, reviews, side effects, and
  audit events.
- `GET /api/reconciliations/:id/document` streams the source document inline.
- `POST /api/reconciliations/:id/reviews` submits an optimistic-versioned human
  decision and queues graph resumption.
- `POST /api/reconciliations/:id/retry` queues a failed checkpoint for retry.

This is intentionally single-account and uses a fixed `local-demo-user` reviewer.
Add authentication, authorization, and account ownership before multi-tenant use.

## Fixtures and graph inspection

Canonical Markdown invoices and their expected seeded accounting scenarios live in
`fixtures/invoices`. Generate PDF and PNG variants under ignored `output/` paths:

```bash
pnpm fixtures:generate --clean
```

Render the graph to a PNG at the requested path:

```bash
pnpm agent:graph -- output/invoice-reconciliation-graph.png
```

LangGraph's `drawMermaidPng()` sends the Mermaid definition to the public
Mermaid.INK rendering endpoint; do not use it for graph definitions that contain
secrets or other sensitive metadata.

## Service boundaries

- `src/server/agent`: graph topology and runtime composition.
- `src/server/reconciliation`: typed state, policy, model ports, durable case/review
  repository, and pg-boss producer/worker integration.
- `src/server/invoices`: source-neutral intake and manual upload adapter.
- `src/server/accounting`: exact lookups, semantic PO search, receipts, allocation
  history, and idempotent remittance.
- `src/server/documents`: object-storage port and S3-compatible adapter.
- `src/server/email`: email port and SMTP adapter.
- `src/server/db`: Drizzle schema, migrations, seeding, health, and LangGraph setup.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Integration tests require `DATABASE_URL` and a running pgvector database. The full
agent path additionally requires object storage, SMTP, a worker, and model access.
