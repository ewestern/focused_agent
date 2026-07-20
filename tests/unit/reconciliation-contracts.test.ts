import { describe, expect, it } from "vitest";

import { ReconciliationReviewSubmissionSchema } from "@/lib/reconciliation-contracts";

const reviewId = "00000000-0000-4000-8000-000000000001";

describe("reconciliation review contracts", () => {
  it("requires a reviewer reason when routing an approved invoice to dispute", () => {
    expect(
      ReconciliationReviewSubmissionSchema.safeParse({
        expectedVersion: 2,
        decision: { reviewId, kind: "payment", action: "route_to_dispute" },
      }).success,
    ).toBe(false);
  });

  it("requires the approved draft when sending a dispute email", () => {
    expect(
      ReconciliationReviewSubmissionSchema.safeParse({
        expectedVersion: 2,
        decision: { reviewId, kind: "email", action: "send_email" },
      }).success,
    ).toBe(false);
  });
});
