import { z } from "zod";

import { ReviewDecisionSchema } from "@/server/reconciliation/types";

export const ReconciliationReviewSubmissionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  decision: ReviewDecisionSchema,
});

export const ResourceIdSchema = z.string().uuid();
