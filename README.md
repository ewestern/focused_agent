# Focused Agent

A runnable application scaffold for a TypeScript LangGraph agent. It provides a
Next.js frontend and API, Postgres-backed LangGraph checkpoints, a provider-neutral
pgvector retrieval boundary, and Docker Compose orchestration. The graph itself is
deliberately deterministic until the actual agent behavior is designed.

## What is included

- Next.js App Router frontend and Node.js Route Handlers
- Typed server-sent event protocol for chat runs
- Deterministic LangGraph node with durable Postgres checkpoints
- pgvector-enabled Postgres and a deferred `PGVectorStore` factory
- Health endpoint, Docker images, Compose orchestration, tests, and CI

No LLM provider, embedding provider, prompt, tool, document ingestion pipeline,
authentication, or production deployment platform is selected yet.

## Run the full stack

Requirements: Docker with Compose.

```bash
docker compose up --build
```

Open <http://localhost:3000>. Compose starts Postgres, runs the idempotent database
setup job, and then starts the application. Check readiness with:

```bash
curl --fail http://localhost:3000/api/health
```

Stop the stack without deleting its named Postgres volume:

```bash
docker compose down
```

To intentionally remove all local database data as well, run
`docker compose down --volumes`.

## Host-based development

Use Node.js 24 and pnpm. Start Postgres in Docker, install packages, initialize the
database, and run Next.js on the host:

```bash
cp .env.example .env
docker compose up -d db
pnpm install
pnpm db:setup
pnpm dev
```

The database setup command enables pgvector and creates LangGraph's checkpoint
schema. It is idempotent. It intentionally does not create the RAG document table:
`PGVectorStore` needs a concrete embeddings implementation before it can choose and
initialize the vector representation.

## Interfaces

`POST /api/chat` accepts:

```json
{ "threadId": "a UUID", "message": "Hello" }
```

Successful requests return `text/event-stream` events named `run.started`,
`message.delta`, `run.completed`, or `run.failed`. The browser retains the thread ID
in local storage and sends it as LangGraph's `configurable.thread_id`.

`GET /api/health` checks database connectivity and the pgvector extension. It
returns HTTP 200 when both checks pass and HTTP 503 when either fails.

The server code is split into explicit boundaries:

- `src/server/agent` owns graph construction and runtime wiring.
- `src/server/db` owns connections, health, and checkpoint setup.
- `src/server/rag` owns the retriever contract and deferred pgvector adapter.
- `src/lib/contracts.ts` owns browser/API wire types.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Integration tests require `DATABASE_URL` and a running pgvector database. End-to-end
tests require a production build plus the same database; Playwright starts the app.

## Next implementation phase

Choose model and embedding providers, implement the graph nodes and tools, initialize
the vector store through `createPgVectorRetriever`, and add a document ingestion
workflow. Those decisions are intentionally outside this scaffold.
