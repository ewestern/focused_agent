import { expect, test } from "@playwright/test";

test("queues a manually uploaded invoice for reconciliation", async ({
  page,
}) => {
  await page.goto("/invoices");
  await expect(
    page.getByRole("heading", { name: "Submit an invoice" }),
  ).toBeVisible();

  await page.getByLabel(/Invoice document/).setInputFiles({
    name: "playwright-invoice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj"),
  });
  await page.getByRole("button", { name: "Upload and reconcile" }).click();

  await expect(page.getByText("Received", { exact: true })).toBeVisible();
  await expect(
    page
      .getByLabel("Invoice upload")
      .getByRole("heading", { name: "playwright-invoice.pdf" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Invoice upload").getByText("queued", { exact: true }),
  ).toBeVisible();
});
