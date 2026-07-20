import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const ExpectedSchema = z.object({
  vendorNumber: z.string().nullable(),
  poNumber: z.string().nullable(),
  poLookup: z.enum([
    "found",
    "found_with_vendor",
    "ambiguous",
    "not_provided",
    "not_found",
    "not_found_for_vendor",
    "requires_normalization",
  ]),
  poStatus: z.enum(["open", "closed", "cancelled"]).nullable(),
  receiptState: z.enum(["full", "partial", "none", "unknown"]),
});

const ManifestSchema = z.object({
  version: z.literal(1),
  fixtures: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        file: z.string().regex(/^\d{2}-[a-z0-9-]+\.md$/),
        fidelity: z.enum(["high", "medium", "low"]),
        expected: ExpectedSchema,
      }),
    )
    .min(1),
});

const fixturesDirectory = path.join(process.cwd(), "fixtures", "invoices");

describe("invoice fixture corpus", () => {
  const manifest = ManifestSchema.parse(
    JSON.parse(readFileSync(path.join(fixturesDirectory, "manifest.json"), "utf8")),
  );

  it("has one manifest entry for every invoice Markdown file", () => {
    const markdownFiles = readdirSync(fixturesDirectory)
      .filter((file) => /^\d{2}-.*\.md$/.test(file))
      .sort();
    const manifestedFiles = manifest.fixtures.map((fixture) => fixture.file).sort();

    expect(manifestedFiles).toEqual(markdownFiles);
    expect(new Set(manifest.fixtures.map((fixture) => fixture.id)).size).toBe(
      manifest.fixtures.length,
    );
  });

  it("contains usable invoice documents rather than expectation annotations", () => {
    for (const fixture of manifest.fixtures) {
      const markdown = readFileSync(path.join(fixturesDirectory, fixture.file), "utf8");
      expect(markdown.startsWith("# ")).toBe(true);
      expect(markdown.length).toBeGreaterThan(250);
      expect(markdown).toMatch(/invoice|1nvo1ce/i);
      expect(markdown).toMatch(/\b(?:USD|Amount due|Balance|Total)\b/i);
    }
  });

  it("covers every seeded PO and the major missing-reference cases", () => {
    const poNumbers = new Set(
      manifest.fixtures.map((fixture) => fixture.expected.poNumber).filter(Boolean),
    );
    expect(poNumbers).toEqual(
      new Set(["PO-1001", "PO-1002", "PO-1003", "PO-1004", "PO-1005", "PO-SHARED", "PO-9999", "PO-4040"]),
    );
    expect(manifest.fixtures.some((fixture) => fixture.expected.poNumber === null)).toBe(true);
    expect(manifest.fixtures.some((fixture) => fixture.expected.vendorNumber === null)).toBe(true);
    expect(new Set(manifest.fixtures.map((fixture) => fixture.fidelity))).toEqual(
      new Set(["high", "medium", "low"]),
    );
    const sharedPoVendors = manifest.fixtures
      .filter(
        (fixture) =>
          fixture.expected.poNumber === "PO-SHARED" &&
          fixture.expected.poLookup === "found_with_vendor",
      )
      .map((fixture) => fixture.expected.vendorNumber)
      .sort();
    expect(sharedPoVendors).toEqual(["V-100", "V-200"]);
  });
});
