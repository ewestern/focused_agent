import { Client, Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { createReconciliationProgressEvent } from "@/lib/reconciliation-events";
import {
  PostgresReconciliationProgressPublisher,
  RECONCILIATION_PROGRESS_CHANNEL,
} from "@/server/reconciliation/progress";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgreSQL reconciliation progress", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const listener = new Client({ connectionString: databaseUrl });

  afterAll(async () => {
    await listener.end().catch(() => undefined);
    await pool.end();
  });

  it("broadcasts a validated event without a durable event table", async () => {
    await listener.connect();
    await listener.query(`LISTEN ${RECONCILIATION_PROGRESS_CHANNEL}`);
    const event = createReconciliationProgressEvent(
      "00000000-0000-4000-8000-000000000050",
      { kind: "stage.started", stage: "extract_invoice" },
    );
    const received = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("PostgreSQL notification timeout")),
        5_000,
      );
      listener.once("notification", (notification) => {
        clearTimeout(timeout);
        resolve(notification.payload ?? "");
      });
    });

    await new PostgresReconciliationProgressPublisher(pool).publish(event);

    await expect(received).resolves.toBe(JSON.stringify(event));
  });
});
