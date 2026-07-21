import { eq } from "drizzle-orm";

import type { AppDatabase } from "@/server/db/client";
import { emailDeliveries } from "@/server/db/schema";
import type { EmailDraft } from "@/server/reconciliation/types";

export type EmailDeliverySummary = {
  id: string;
  status: "sending" | "sent" | "failed" | "uncertain";
  sentAt: string | null;
};

export class EmailDeliveryRepository {
  constructor(private readonly db: AppDatabase) {}

  async begin(
    reconciliationId: string,
    message: EmailDraft,
  ): Promise<{
    id: string;
    status: EmailDeliverySummary["status"];
    created: boolean;
  }> {
    const [created] = await this.db
      .insert(emailDeliveries)
      .values({ reconciliationId, status: "sending", message })
      .onConflictDoNothing({ target: emailDeliveries.reconciliationId })
      .returning();
    if (created)
      return { id: created.id, status: created.status, created: true };

    const [existing] = await this.db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.reconciliationId, reconciliationId))
      .limit(1);
    if (!existing)
      throw new Error("Email delivery ledger could not be created.");
    return { id: existing.id, status: existing.status, created: false };
  }

  async finish(input: {
    reconciliationId: string;
    status: "sent" | "failed" | "uncertain";
    providerMessageId?: string;
    accepted?: string[];
    rejected?: string[];
    failureMessage?: string;
  }): Promise<void> {
    await this.db
      .update(emailDeliveries)
      .set({
        status: input.status,
        providerMessageId: input.providerMessageId,
        accepted: input.accepted,
        rejected: input.rejected,
        failureMessage: input.failureMessage,
        sentAt: input.status === "sent" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(emailDeliveries.reconciliationId, input.reconciliationId));
  }

  async getSummary(
    reconciliationId: string,
  ): Promise<EmailDeliverySummary | null> {
    const [row] = await this.db
      .select({
        id: emailDeliveries.id,
        status: emailDeliveries.status,
        sentAt: emailDeliveries.sentAt,
      })
      .from(emailDeliveries)
      .where(eq(emailDeliveries.reconciliationId, reconciliationId))
      .limit(1);
    return row
      ? {
          id: row.id,
          status: row.status,
          sentAt: row.sentAt?.toISOString() ?? null,
        }
      : null;
  }
}
