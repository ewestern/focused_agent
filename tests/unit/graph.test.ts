import { describe, expect, it } from "vitest";

import { invoiceReconciliationGraph } from "@/server/agent/graph";

describe("invoice reconciliation graph", () => {
  it("exports a directly inspectable graph with the reconciliation stages", async () => {
    const mermaid = (await invoiceReconciliationGraph.getGraphAsync()).drawMermaid();

    expect(mermaid).toContain("extract_invoice");
    expect(mermaid).toContain("lookup_purchase_order");
    expect(mermaid).toContain("match_vendor");
    expect(mermaid).toContain("evaluate_policy");
    expect(mermaid).toContain("payment_review");
    expect(mermaid).toContain("email_review");
  });
});
