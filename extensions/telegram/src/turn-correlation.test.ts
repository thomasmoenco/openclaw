import { describe, expect, it } from "vitest";
import { beginTelegramTurnCorrelation, resolveTelegramConversationId } from "./turn-correlation.js";

describe("Telegram turn correlation", () => {
  it("captures one immutable turn generation and later run identity", () => {
    const turn = beginTelegramTurnCorrelation({
      accountId: "default",
      chatId: 42,
      inboundMessageId: "100",
    });
    turn.observeRun({ runId: "run-1", sessionId: "session-1" });
    expect(turn.snapshot()).toMatchObject({
      conversationId: "default:42:root",
      generation: turn.generation,
      inboundMessageId: "100",
      runId: "run-1",
      sessionId: "session-1",
    });
  });

  it("scopes independent topics to independent conversations", () => {
    expect(resolveTelegramConversationId({ accountId: "a", chatId: -1, threadId: 10 })).not.toBe(
      resolveTelegramConversationId({ accountId: "a", chatId: -1, threadId: 11 }),
    );
  });
});
