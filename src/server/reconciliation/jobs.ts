import { sql } from "drizzle-orm";
import {
  fromDrizzle,
  PgBoss,
  type DrizzleTransactionLike,
  type Queue,
} from "pg-boss";
import { z } from "zod";

import { getServerEnv } from "@/server/env";
import { ReviewDecisionSchema } from "@/server/reconciliation/types";

export const PGBOSS_SCHEMA = "pgboss";
export const RECONCILIATION_QUEUE = "reconciliation";
export const RECONCILIATION_DEAD_LETTER_QUEUE = "reconciliation-dead-letter";

export const ReconciliationJobDataSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("start"),
    reconciliationId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("resume"),
    reconciliationId: z.string().uuid(),
    payload: ReviewDecisionSchema,
  }),
  z.object({
    kind: z.literal("retry"),
    reconciliationId: z.string().uuid(),
  }),
]);

export type ReconciliationJobData = z.infer<typeof ReconciliationJobDataSchema>;

export interface ReconciliationJobPublisher {
  enqueue(
    transaction: DrizzleTransactionLike,
    data: ReconciliationJobData,
  ): Promise<string>;
}

export class PgBossReconciliationJobPublisher
  implements ReconciliationJobPublisher
{
  constructor(private readonly boss: PgBoss) {}

  async enqueue(
    transaction: DrizzleTransactionLike,
    data: ReconciliationJobData,
  ): Promise<string> {
    const parsed = ReconciliationJobDataSchema.parse(data);
    const id = await this.boss.send(RECONCILIATION_QUEUE, parsed, {
      db: fromDrizzle(transaction, sql),
    });
    if (!id) throw new Error("pg-boss did not create the reconciliation job.");
    return id;
  }
}

const sharedQueueOptions = {
  policy: "standard",
  retryLimit: 2,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 120,
  heartbeatSeconds: 60,
  expireInSeconds: 30 * 60,
  retentionSeconds: 14 * 24 * 60 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
  notify: true,
} satisfies Omit<Queue, "name">;

const mainQueueOptions = {
  ...sharedQueueOptions,
  deadLetter: RECONCILIATION_DEAD_LETTER_QUEUE,
} satisfies Omit<Queue, "name">;

export type ReconciliationPgBossOptions = {
  migrate: boolean;
  useListenNotify: boolean;
  supervise?: boolean;
};

export function createReconciliationPgBoss(
  options: ReconciliationPgBossOptions,
): PgBoss {
  const boss = new PgBoss({
    connectionString: getServerEnv().DATABASE_URL,
    schema: PGBOSS_SCHEMA,
    max: 4,
    migrate: options.migrate,
    schedule: false,
    supervise: options.supervise ?? true,
    useListenNotify: options.useListenNotify,
  });
  boss.on("error", (error) => {
    console.error("pg-boss error", error);
  });
  boss.on("warning", (warning) => {
    console.warn("pg-boss warning", warning);
  });
  return boss;
}

export async function setupReconciliationQueues(): Promise<void> {
  const boss = createReconciliationPgBoss({
    migrate: true,
    useListenNotify: false,
    supervise: false,
  });
  let started = false;
  try {
    await boss.start();
    started = true;
    await ensureQueue(boss, RECONCILIATION_DEAD_LETTER_QUEUE, sharedQueueOptions);
    await ensureQueue(boss, RECONCILIATION_QUEUE, mainQueueOptions);
  } finally {
    if (started) await boss.stop();
  }
}

async function ensureQueue(
  boss: PgBoss,
  name: string,
  options: Omit<Queue, "name">,
): Promise<void> {
  const existing = await boss.getQueue(name);
  if (!existing) {
    await boss.createQueue(name, options);
    return;
  }
  if (existing.policy !== options.policy) {
    throw new Error(
      `pg-boss queue ${name} has policy ${existing.policy}; expected ${options.policy}.`,
    );
  }
  const updates = { ...options };
  delete updates.policy;
  delete updates.partition;
  await boss.updateQueue(name, updates);
}

declare global {
  var focusedReconciliationBossPromise: Promise<PgBoss> | undefined;
}

export async function getReconciliationJobPublisher(): Promise<
  ReconciliationJobPublisher
> {
  globalThis.focusedReconciliationBossPromise ??= startRuntimeBoss();
  return new PgBossReconciliationJobPublisher(
    await globalThis.focusedReconciliationBossPromise,
  );
}

async function startRuntimeBoss(): Promise<PgBoss> {
  const boss = createReconciliationPgBoss({
    migrate: false,
    useListenNotify: false,
    supervise: false,
  });
  try {
    return await boss.start();
  } catch (error) {
    globalThis.focusedReconciliationBossPromise = undefined;
    throw error;
  }
}
