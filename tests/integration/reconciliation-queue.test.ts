import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "@/server/db/client";
import {
  createReconciliationPgBoss,
  PgBossReconciliationJobPublisher,
  RECONCILIATION_DEAD_LETTER_QUEUE,
  RECONCILIATION_QUEUE,
  setupReconciliationQueues,
} from "@/server/reconciliation/jobs";
import { DEFAULT_RECONCILIATION_POLICY } from "@/server/reconciliation/policy";

const databaseUrl = process.env.DATABASE_URL;
const reconciliationId = "00000000-0000-4000-8000-000000000020";
const submissionId = "00000000-0000-4000-8000-000000000021";

describe.skipIf(!databaseUrl)("pg-boss reconciliation queue", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = createDatabase(pool);
  const boss = createReconciliationPgBoss({
    migrate: false,
    useListenNotify: false,
    supervise: false,
  });
  const jobs = new PgBossReconciliationJobPublisher(boss);

  beforeAll(async () => {
    await setupReconciliationQueues();
    await setupReconciliationQueues();
    await boss.start();
    await boss.deleteAllJobs(RECONCILIATION_QUEUE);
    await boss.deleteAllJobs(RECONCILIATION_DEAD_LETTER_QUEUE);
  });

  afterAll(async () => {
    await boss.deleteAllJobs(RECONCILIATION_QUEUE);
    await boss.deleteAllJobs(RECONCILIATION_DEAD_LETTER_QUEUE);
    await boss.stop();
    await pool.end();
  });

  it("provisions the managed queues with the expected policy", async () => {
    await expect(boss.getQueue(RECONCILIATION_QUEUE)).resolves.toMatchObject({
      policy: "standard",
      retryLimit: 2,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 120,
      heartbeatSeconds: 60,
      expireInSeconds: 1_800,
      deadLetter: RECONCILIATION_DEAD_LETTER_QUEUE,
      notify: true,
    });
  });

  it("commits a job with its surrounding Drizzle transaction", async () => {
    const id = await db.transaction((tx) =>
      jobs.enqueue(tx, {
        kind: "start",
        reconciliationId,
        submissionId,
        effectivePolicy: DEFAULT_RECONCILIATION_POLICY,
      }),
    );

    await expect(
      boss.findJobs(RECONCILIATION_QUEUE, { id }),
    ).resolves.toHaveLength(1);
  });

  it("rolls a job back with its surrounding Drizzle transaction", async () => {
    let jobId: string | undefined;
    await expect(
      db.transaction(async (tx) => {
        jobId = await jobs.enqueue(tx, { kind: "retry", reconciliationId });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(jobId).toBeDefined();
    await expect(
      boss.findJobs(RECONCILIATION_QUEUE, { id: jobId }),
    ).resolves.toHaveLength(0);
  });

  it("retries twice before routing a terminal failure to dead letter", async () => {
    await boss.deleteAllJobs(RECONCILIATION_QUEUE);
    await boss.deleteAllJobs(RECONCILIATION_DEAD_LETTER_QUEUE);
    let attempts = 0;
    let resolveDeadLetter: ((value: unknown) => void) | undefined;
    const deadLettered = new Promise<unknown>((resolve) => {
      resolveDeadLetter = resolve;
    });
    const workerId = await boss.work(
      RECONCILIATION_QUEUE,
      { pollingIntervalSeconds: 0.5 },
      async () => {
        attempts += 1;
        throw new Error("permanent failure");
      },
    );
    const deadLetterWorkerId = await boss.work(
      RECONCILIATION_DEAD_LETTER_QUEUE,
      { includeMetadata: true, pollingIntervalSeconds: 0.5 },
      async ([job]) => {
        resolveDeadLetter?.(job?.output);
      },
    );
    let timeout: NodeJS.Timeout | undefined;

    try {
      await boss.send(
        RECONCILIATION_QUEUE,
        { kind: "retry", reconciliationId },
        { retryDelay: 0 },
      );
      await expect(
        Promise.race([
          deadLettered,
          new Promise(
            (_, reject) =>
              (timeout = setTimeout(
                () => reject(new Error("dead-letter timeout")),
                10_000,
              )),
          ),
        ]),
      ).resolves.toMatchObject({ message: "permanent failure" });
      expect(attempts).toBe(3);
    } finally {
      clearTimeout(timeout);
      await boss.offWork(RECONCILIATION_QUEUE, { id: workerId });
      await boss.offWork(RECONCILIATION_DEAD_LETTER_QUEUE, {
        id: deadLetterWorkerId,
      });
    }
  }, 15_000);
});
