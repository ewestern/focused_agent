import { describe, expect, it } from "vitest";

import {
  createPurchaseOrderEmbeddings,
  EmbeddingConfigurationError,
} from "@/server/accounting/embeddings";
import {
  buildPurchaseOrderSearchDocument,
  parsePurchaseOrderSemanticQuery,
  type PurchaseOrderSearchSource,
} from "@/server/accounting/purchase-order-search";

const source: PurchaseOrderSearchSource = {
  purchaseOrder: {
    id: "00000000-0000-4000-8000-000000000101",
    poNumber: "PO-1001",
    vendorId: "00000000-0000-4000-8000-000000000001",
    status: "open",
    currency: "USD",
    orderedAt: "2026-06-01",
    closedAt: null,
    lines: [
      {
        id: "00000000-0000-4000-8000-000000001102",
        lineNumber: 2,
        description: "Protective gloves",
        quantityOrdered: "4.0000",
        unitPrice: "12.5000",
      },
      {
        id: "00000000-0000-4000-8000-000000001101",
        lineNumber: 1,
        description: "Steel fasteners",
        quantityOrdered: "10.0000",
        unitPrice: "5.2500",
      },
    ],
  },
  vendor: {
    id: "00000000-0000-4000-8000-000000000001",
    vendorNumber: "V-100",
    legalName: "Acme Industrial Supply, Inc.",
    displayName: "Acme Industrial",
    taxId: "12-3456789",
    apEmail: "ap@acme.example",
  },
  aliases: ["Industrial Acme", "Acme Supply"],
};

describe("purchase order search documents", () => {
  it("serializes stable, labeled accounting content without sensitive vendor fields", () => {
    const document = buildPurchaseOrderSearchDocument(source);
    const reordered = buildPurchaseOrderSearchDocument({
      ...source,
      aliases: [...source.aliases].reverse(),
      purchaseOrder: {
        ...source.purchaseOrder,
        lines: [...source.purchaseOrder.lines].reverse(),
      },
    });

    expect(document.content).toContain("Purchase order number: PO-1001");
    expect(document.content).toContain(
      "Vendor aliases: Acme Supply, Industrial Acme",
    );
    expect(document.content.indexOf("Line 1:")).toBeLessThan(
      document.content.indexOf("Line 2:"),
    );
    expect(document.content).not.toContain("12-3456789");
    expect(document.content).not.toContain("ap@acme.example");
    expect(document).toEqual(reordered);
    expect(document.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("purchase order semantic queries", () => {
  it("normalizes optional search filters and applies the default limit", () => {
    expect(
      parsePurchaseOrderSemanticQuery({
        query: "  safety equipment  ",
        currency: "usd",
        orderedFrom: "2026-01-01",
        orderedTo: "2026-12-31",
      }),
    ).toEqual({
      query: "safety equipment",
      currency: "USD",
      limit: 5,
      orderedFrom: "2026-01-01",
      orderedTo: "2026-12-31",
    });
  });

  it("rejects empty queries, invalid limits, and reversed date ranges", () => {
    expect(() => parsePurchaseOrderSemanticQuery({ query: " " })).toThrow();
    expect(() =>
      parsePurchaseOrderSemanticQuery({ query: "paper", limit: 21 }),
    ).toThrow();
    expect(() =>
      parsePurchaseOrderSemanticQuery({
        query: "paper",
        orderedFrom: "2026-12-31",
        orderedTo: "2026-01-01",
      }),
    ).toThrow("orderedFrom must be on or before orderedTo");
  });
});

describe("purchase order embedding configuration", () => {
  it("requires a nonempty OpenAI API key only when embeddings are created", () => {
    expect(() =>
      createPurchaseOrderEmbeddings({ OPENAI_API_KEY: undefined }),
    ).toThrow(
      EmbeddingConfigurationError,
    );
    expect(() => createPurchaseOrderEmbeddings({ OPENAI_API_KEY: "  " })).toThrow(
      "OPENAI_API_KEY is required",
    );
    expect(() =>
      createPurchaseOrderEmbeddings({ OPENAI_API_KEY: "test-key" }),
    ).not.toThrow();
  });
});
