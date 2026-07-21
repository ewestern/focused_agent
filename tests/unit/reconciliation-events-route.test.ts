import { describe, expect, it } from "vitest";

import { encodeSseEvent } from "@/app/api/reconciliations/[id]/events/route";

describe("reconciliation progress SSE", () => {
  it("encodes named SSE events with one JSON data record", () => {
    expect(encodeSseEvent("ready", { reconciliationId: "case-1" })).toBe(
      'event: ready\ndata: {"reconciliationId":"case-1"}\n\n',
    );
  });
});
