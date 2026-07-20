import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createS3DocumentStore } from "@/server/documents/s3";
import { createSmtpEmailService } from "@/server/email/smtp";
import { getServerEnv } from "@/server/env";

const hasExternalServices = process.env.S3_ENDPOINT && process.env.SMTP_HOST;

describe.skipIf(!hasExternalServices)("local external service adapters", () => {
  const env = getServerEnv();
  const store = createS3DocumentStore(env);
  const key = `integration-tests/${crypto.randomUUID()}`;

  beforeAll(async () => store.ensureReady());
  afterAll(async () => store.delete(key));

  it("round-trips document bytes through S3", async () => {
    const body = new TextEncoder().encode("%PDF-1.4 integration");
    await store.put({
      key,
      body,
      contentType: "application/pdf",
      sha256: "test-checksum",
    });
    await expect(store.get(key)).resolves.toEqual(body);
  });

  it("delivers email to Mailpit", async () => {
    const email = createSmtpEmailService(env);
    const subject = `Integration ${crypto.randomUUID()}`;
    await expect(
      email.send({
        from: env.SMTP_FROM,
        to: ["invoice-contact@example.test"],
        cc: ["vendor-ap@example.test"],
        subject,
        text: "Reconciliation test message",
      }),
    ).resolves.toMatchObject({ accepted: ["invoice-contact@example.test", "vendor-ap@example.test"] });

    const api = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025";
    let captured: { Subject: string; ID: string } | undefined;
    for (let attempt = 0; attempt < 10 && !captured; attempt += 1) {
      const response = await fetch(`${api}/api/v1/messages`);
      const payload = (await response.json()) as { messages: { Subject: string; ID: string }[] };
      captured = payload.messages.find((message) => message.Subject === subject);
      if (!captured) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(captured).toBeDefined();
    const response = await fetch(`${api}/api/v1/message/${captured!.ID}`);
    const message = (await response.json()) as { Text: string };
    expect(message.Text).toContain("Reconciliation test message");
  });
});
