import { expect, test } from "@playwright/test";

test("exercises the composed agent scaffold", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toEqual({
    status: "ok",
    checks: { database: true, pgvector: true },
  });

  await page.goto("/");
  await page.getByPlaceholder("Send a message to the placeholder graph…").fill("hello");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Scaffold received: hello")).toBeVisible();
});
