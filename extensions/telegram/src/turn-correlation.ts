import { randomUUID } from "node:crypto";

export type TelegramTurnCorrelation = {
  accountId: string;
  conversationId: string;
  generation: string;
  inboundMessageId: string;
  runId?: string;
  sessionId?: string;
};

export type TelegramTurnCorrelationFence = {
  conversationId: string;
  generation: string;
  observeRun: (params: { runId: string; sessionId?: string }) => void;
  snapshot: () => TelegramTurnCorrelation;
};

export function resolveTelegramConversationId(params: {
  accountId: string;
  chatId: string | number;
  threadId?: number;
}): string {
  return `${params.accountId}:${params.chatId}:${params.threadId ?? "root"}`;
}

export function beginTelegramTurnCorrelation(params: {
  accountId: string;
  chatId: string | number;
  inboundMessageId: string;
  threadId?: number;
}): TelegramTurnCorrelationFence {
  const conversationId = resolveTelegramConversationId(params);
  const correlation: TelegramTurnCorrelation = {
    accountId: params.accountId,
    conversationId,
    generation: randomUUID(),
    inboundMessageId: params.inboundMessageId,
  };
  return {
    conversationId,
    generation: correlation.generation,
    observeRun: ({ runId, sessionId }) => {
      correlation.runId = runId;
      if (sessionId) {
        correlation.sessionId = sessionId;
      }
    },
    snapshot: () => ({ ...correlation }),
  };
}
