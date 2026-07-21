import { describe, expect, it } from "vitest";

import { invoiceReconciliationGraph } from "@/server/agent/graph";

describe("invoice reconciliation graph", () => {
  it("exports a directly inspectable graph with the reconciliation stages", async () => {
    const graph = await invoiceReconciliationGraph.getGraphAsync();
    const mermaid = graph.drawMermaid();

    expect(mermaid).toContain("extract_invoice");
    expect(mermaid).toContain("lookup_purchase_order");
    expect(mermaid).toContain("match_vendor");
    expect(mermaid).toContain("evaluate_policy");
    expect(mermaid).toContain("payment_review");
    expect(mermaid).toContain("email_review");

    const llmUsage = Object.fromEntries(
      Object.entries(graph.nodes)
        .filter(([name]) => name !== "__start__" && name !== "__end__")
        .map(([name, node]) => [name, node.metadata?.llmUsage]),
    );
    expect(llmUsage).toMatchObject({
      extract_invoice: "always",
      match_lines: "conditional",
      compose_vendor_email: "always",
    });
    expect(
      Object.entries(llmUsage)
        .filter(([, usage]) => usage !== "never")
        .map(([name]) => name)
        .sort(),
    ).toEqual(
      ["compose_vendor_email", "extract_invoice", "match_lines"].sort(),
    );
  });
});
