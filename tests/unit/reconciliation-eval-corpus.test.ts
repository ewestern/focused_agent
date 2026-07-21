import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  RECONCILIATION_EVAL_CASES,
  getReconciliationEvalCase,
} from "../../evals/reconciliation/cases";
import { FixtureAccountingService } from "../../evals/reconciliation/fixture-services";
import { parseExperimentOptions } from "../../evals/reconciliation/run-experiment";

describe("reconciliation eval corpus", () => {
  it("covers every invoice manifest fixture with one checked-in PDF", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), "fixtures/invoices/manifest.json"), "utf8"),
    ) as { fixtures: Array<{ id: string }> };
    const pdfs = readdirSync(path.join(process.cwd(), "samples/pdf/invoices")).sort();

    expect(RECONCILIATION_EVAL_CASES.map((item) => item.id).sort()).toEqual(
      manifest.fixtures.map((item) => item.id).sort(),
    );
    expect(RECONCILIATION_EVAL_CASES.map((item) => item.sourcePdf).sort()).toEqual(pdfs);
    expect(RECONCILIATION_EVAL_CASES.filter((item) => item.split === "smoke")).toHaveLength(5);
  });

  it("rejects unknown case IDs", () => {
    expect(() => getReconciliationEvalCase("not-a-case")).toThrow(
      "Unknown reconciliation eval case",
    );
  });
});

describe("fixture accounting service", () => {
  const service = new FixtureAccountingService(
    getReconciliationEvalCase("acme-missing-po-number"),
  );

  it("matches vendor inputs and exact purchase orders instead of returning canned answers", async () => {
    await expect(service.findVendorCandidates({ vendorNumber: "V-100" })).resolves.toMatchObject([
      { vendorNumber: "V-100", matchedOn: ["vendorNumber"] },
    ]);
    await expect(service.findVendorCandidates({ vendorNumber: "V-999" })).resolves.toEqual([]);
    await expect(service.findVendorCandidates({ name: "Acme Supply" })).resolves.toMatchObject([
      { vendorNumber: "V-100", matchedOn: ["alias"] },
    ]);
    await expect(service.findPurchaseOrder({ poNumber: "PO-SHARED" })).resolves.toMatchObject({
      status: "ambiguous",
      matches: [{ poNumber: "PO-SHARED" }, { poNumber: "PO-SHARED" }],
    });
    await expect(service.findPurchaseOrder({ poNumber: "P0-IOOI" })).resolves.toEqual({
      status: "not_found",
    });
  });

  it("returns only the case-owned semantic candidates after relational filters", async () => {
    await expect(
      service.searchPurchaseOrders({
        query: "steel fasteners",
        vendorId: "00000000-0000-4000-8000-000000000001",
        statuses: ["open"],
        currency: "USD",
      }),
    ).resolves.toMatchObject([{ purchaseOrder: { poNumber: "PO-1001" } }]);
    await expect(
      service.searchPurchaseOrders({
        query: "steel fasteners",
        vendorId: "00000000-0000-4000-8000-000000000002",
      }),
    ).resolves.toEqual([]);
  });

  it("guards remittance", async () => {
    await expect(service.remitPayment()).rejects.toThrow("Eval safety violation");
  });
});

describe("reconciliation experiment options", () => {
  it("uses safe defaults and validates overrides", () => {
    expect(parseExperimentOptions([])).toEqual({
      split: undefined,
      repetitions: 3,
      concurrency: 1,
    });
    expect(
      parseExperimentOptions([
        "--split",
        "smoke",
        "--repetitions",
        "2",
        "--concurrency",
        "4",
      ]),
    ).toEqual({ split: "smoke", repetitions: 2, concurrency: 4 });
    expect(() => parseExperimentOptions(["--split", "unknown"])).toThrow(
      "split must be smoke or regression",
    );
  });
});
