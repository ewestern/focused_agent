import { describe, expect, it } from "vitest";

import {
  normalizeEmail,
  normalizeName,
  normalizeTaxId,
  normalizeVendorNumber,
} from "@/server/accounting/normalize";

describe("accounting lookup normalization", () => {
  it("normalizes exact business identifiers without fuzzy matching", () => {
    expect(normalizeVendorNumber(" v-100 ")).toBe("V-100");
    expect(normalizeTaxId("12-345 6789")).toBe("123456789");
    expect(normalizeEmail(" AP@Acme.Example ")).toBe("ap@acme.example");
    expect(normalizeName("Acme Industrial Supply, Inc.")).toBe(
      "acme industrial supply inc",
    );
  });
});
