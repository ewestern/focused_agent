import { z } from "zod";

import { ReviewDecisionSchema } from "@/server/reconciliation/types";

export const ReconciliationReviewSubmissionSchema = z.object({
  checkpointId: z.string().min(1),
  decision: ReviewDecisionSchema,
});

export const ResourceIdSchema = z.string().uuid();
