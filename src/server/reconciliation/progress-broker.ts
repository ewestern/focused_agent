import { Client, type Notification } from "pg";

import {
  ReconciliationProgressEventSchema,
  type ReconciliationProgressEvent,
} from "@/lib/reconciliation-events";
import { getServerEnv } from "@/server/env";
import { RECONCILIATION_PROGRESS_CHANNEL } from "@/server/reconciliation/progress";

export type ReconciliationProgressListener = (
  event: ReconciliationProgressEvent,
) => void;

export class ReconciliationProgressSubscriptions {
  private readonly listeners = new Map<
    string,
    Set<ReconciliationProgressListener>
  >();

  subscribe(
    reconciliationId: string,
    listener: ReconciliationProgressListener,
  ): () => void {
    const listeners = this.listeners.get(reconciliationId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(reconciliationId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(reconciliationId);
    };
  }

  dispatch(event: ReconciliationProgressEvent): void {
    for (const listener of this.listeners.get(event.reconciliationId) ?? []) {
      listener(event);
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

export class ReconciliationProgressBroker {
  private readonly subscriptions = new ReconciliationProgressSubscriptions();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(
    reconciliationId: string,
    listener: ReconciliationProgressListener,
  ): () => void {
    const unsubscribe = this.subscriptions.subscribe(reconciliationId, listener);
    this.ensureConnected();
    return unsubscribe;
  }

  dispatchPayload(payload: string): void {
    const parsed = parseReconciliationProgressPayload(payload);
    if (!parsed) return;
    this.subscriptions.dispatch(parsed);
  }

  async ready(): Promise<void> {
    this.ensureConnected();
    await this.connecting;
    if (!this.client) {
      throw new Error("PostgreSQL progress listener is not connected.");
    }
  }

  private ensureConnected(): void {
    if (this.client || this.connecting) return;
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    void this.connecting.catch((error: unknown) => {
      console.warn("PostgreSQL progress listener could not connect.", error);
      this.scheduleReconnect();
    });
  }

  private async connect(): Promise<void> {
    const client = new Client({ connectionString: getServerEnv().DATABASE_URL });
    this.client = client;
    client.on("notification", (notification) =>
      this.handleNotification(notification),
    );
    client.on("error", (error) => this.handleDisconnect(client, error));
    client.on("end", () => this.handleDisconnect(client));

    try {
      await client.connect();
      await client.query(`LISTEN ${RECONCILIATION_PROGRESS_CHANNEL}`);
    } catch (error) {
      if (this.client === client) this.client = null;
      await client.end().catch(() => undefined);
      throw error;
    }
  }

  private handleNotification(notification: Notification): void {
    if (
      notification.channel !== RECONCILIATION_PROGRESS_CHANNEL ||
      !notification.payload
    ) {
      return;
    }
    this.dispatchPayload(notification.payload);
  }

  private handleDisconnect(client: Client, error?: Error): void {
    if (this.client !== client) return;
    this.client = null;
    if (error) console.warn("PostgreSQL progress listener disconnected.", error);
    void client.end().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.subscriptions.size === 0) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, 1_000);
  }
}

export function parseReconciliationProgressPayload(
  payload: string,
): ReconciliationProgressEvent | null {
  try {
    return ReconciliationProgressEventSchema.parse(JSON.parse(payload));
  } catch (error) {
    console.warn("Invalid reconciliation progress notification was ignored.", error);
    return null;
  }
}

declare global {
  var focusedReconciliationProgressBroker:
    | ReconciliationProgressBroker
    | undefined;
}

export function getReconciliationProgressBroker(): ReconciliationProgressBroker {
  globalThis.focusedReconciliationProgressBroker ??=
    new ReconciliationProgressBroker();
  return globalThis.focusedReconciliationProgressBroker;
}
