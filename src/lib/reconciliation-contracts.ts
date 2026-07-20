import { z } from "zod";

import { ReviewDecisionSchema } from "@/server/reconciliation/types";

export const ReconciliationReviewSubmissionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  decision: ReviewDecisionSchema,
});

export type ReconciliationReviewSubmission = z.infer<
  typeof ReconciliationReviewSubmissionSchema
>;

export const ReconciliationIdSchema = z.string().uuid();

