import "dotenv/config";

import {
  getReconciliationGraph,
  getReconciliationServices,
} from "../src/server/agent/runtime";
import { closePool } from "../src/server/db/pool";
import {
  createReconciliationPgBoss,
  RECONCILIATION_DEAD_LETTER_QUEUE,
  RECONCILIATION_QUEUE,
} from "../src/server/reconciliation/jobs";
import {
  createReconciliationDeadLetterHandler,
  createReconciliationJobHandler,
} from "../src/server/reconciliation/worker";

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
    const services = getReconciliationServices();
    await boss.work(
      RECONCILIATION_QUEUE,
      {
        batchSize: 1,
        heartbeatRefreshSeconds: 30,
        includeMetadata: true,
        localConcurrency: 1,
        pollingIntervalSeconds: 2,
      },
      createReconciliationJobHandler(graph, services),
    );
    await boss.work(
      RECONCILIATION_DEAD_LETTER_QUEUE,
      {
        batchSize: 1,
        includeMetadata: true,
        localConcurrency: 1,
        pollingIntervalSeconds: 2,
      },
      createReconciliationDeadLetterHandler(services),
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
