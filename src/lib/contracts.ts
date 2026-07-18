import { z } from "zod";

export const ChatRequestSchema = z.object({
  threadId: z.string().uuid(),
  message: z.string().trim().min(1).max(20_000),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

const RunStartedEventSchema = z.object({
  type: z.literal("run.started"),
  runId: z.string().uuid(),
  threadId: z.string().uuid(),
});

const MessageDeltaEventSchema = z.object({
  type: z.literal("message.delta"),
  runId: z.string().uuid(),
  messageId: z.string().uuid(),
  delta: z.string(),
});

const RunCompletedEventSchema = z.object({
  type: z.literal("run.completed"),
  runId: z.string().uuid(),
});

const RunFailedEventSchema = z.object({
  type: z.literal("run.failed"),
  runId: z.string().uuid(),
  code: z.string(),
  message: z.string(),
});

export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  RunStartedEventSchema,
  MessageDeltaEventSchema,
  RunCompletedEventSchema,
  RunFailedEventSchema,
]);

export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({
    database: z.boolean(),
    pgvector: z.boolean(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};
