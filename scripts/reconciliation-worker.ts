import "dotenv/config";

import {
  getReconciliationGraph,
  getReconciliationRepository,
  getReconciliationDependencies,
} from "../src/server/agent/runtime";
import { closePool, getPool } from "../src/server/db/pool";
import {
  createReconciliationPgBoss,
  RECONCILIATION_DEAD_LETTER_QUEUE,
  RECONCILIATION_QUEUE,
} from "../src/server/reconciliation/jobs";
import {
  createReconciliationDeadLetterHandler,
  createReconciliationJobHandler,
} from "../src/server/reconciliation/worker";
import { PostgresReconciliationProgressPublisher } from "../src/server/reconciliation/progress";

async function waitForShutdown(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

async function main(): Promise<void> {
  const boss = createReconciliationPgBoss({
    migrate: false,
    useListenNotify: true,
    supervise: true,
  });
  let started = false;
  try {
    await boss.start();
    started = true;
    const graph = getReconciliationGraph();
    const dependencies = getReconciliationDependencies();
    const repository = getReconciliationRepository();
    const progress = new PostgresReconciliationProgressPublisher(getPool());
    await boss.work(
      RECONCILIATION_QUEUE,
      {
        batchSize: 1,
        heartbeatRefreshSeconds: 30,
        includeMetadata: true,
        localConcurrency: 1,
        pollingIntervalSeconds: 2,
      },
      createReconciliationJobHandler(graph, dependencies, repository, progress),
    );
    await boss.work(
      RECONCILIATION_DEAD_LETTER_QUEUE,
      {
        batchSize: 1,
        includeMetadata: true,
        localConcurrency: 1,
        pollingIntervalSeconds: 2,
      },
      createReconciliationDeadLetterHandler(repository, progress),
    );

    console.log("Reconciliation pg-boss worker started.");
    const signal = await waitForShutdown();
    console.log(`Reconciliation pg-boss worker received ${signal}; stopping.`);
  } finally {
    if (started) {
      await boss.stop({ graceful: true, timeout: 30_000 });
    }
    await closePool();
  }
  console.log("Reconciliation pg-boss worker stopped.");
}

void main().catch(async (error: unknown) => {
  console.error("Reconciliation pg-boss worker stopped unexpectedly.", error);
  await closePool().catch(() => undefined);
  process.exitCode = 1;
});
