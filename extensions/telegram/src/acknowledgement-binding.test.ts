import type { Message } from "grammy/types";
import { describe, expect, it } from "vitest";
import {
  isLowEntropyTelegramAcknowledgement,
  resolveTelegramAcknowledgementBinding,
} from "./acknowledgement-binding.js";
import type { TelegramCachedMessageNode } from "./message-cache.js";

const BOT_ID = 99;
const CHAT_ID = 42;
const CONVERSATION_ID = `default:${CHAT_ID}:root`;

function message(params: {
  id: number;
  text: string;
  fromId: number;
  isBot?: boolean;
  date?: number;
  replyTo?: Message;
}): Message {
  return {
    message_id: params.id,
    date: params.date ?? params.id,
    chat: { id: CHAT_ID, type: "private", first_name: "Thomas" },
    from: {
      id: params.fromId,
      is_bot: params.isBot ?? false,
      first_name: params.isBot ? "Hugin" : "Thomas",
    },
    text: params.text,
    ...(params.replyTo ? { reply_to_message: params.replyTo } : {}),
  } as Message;
}

function node(msg: Message, inboundMessageId?: string): TelegramCachedMessageNode {
  const body = "text" in msg ? msg.text : undefined;
  return {
    messageId: String(msg.message_id),
    sourceMessage: msg,
    sender: msg.from?.first_name ?? "unknown",
    senderId: msg.from ? String(msg.from.id) : undefined,
    timestamp: msg.date * 1000,
    body,
    ...(msg.from?.id === BOT_ID && body?.includes("?")
      ? {
          expectedResponseBinding: {
            accountId: "default",
            conversationId: CONVERSATION_ID,
            createdAt: msg.date * 1000,
            generation: "generation-1",
            inboundMessageId: inboundMessageId ?? String(msg.message_id - 1),
            parentOutboundMessageId: String(msg.message_id),
            runId: "run-1",
            sessionId: "session-1",
          },
        }
      : {}),
  };
}

describe("Telegram acknowledgement binding", () => {
  it("recognizes only exact low-entropy acknowledgements", () => {
    expect(isLowEntropyTelegramAcknowledgement("Yes")).toBe(true);
    expect(isLowEntropyTelegramAcknowledgement("  Ja! ")).toBe(true);
    expect(isLowEntropyTelegramAcknowledgement("yes, check it")).toBe(false);
  });

  it("binds a replyless acknowledgement to exactly one fresh bot question", () => {
    const priorUser = message({ id: 10, text: "Anja wrote", fromId: 7 });
    const question = message({
      id: 11,
      text: "Should I check the calendar?",
      fromId: BOT_ID,
      isBot: true,
    });
    const ack = message({ id: 12, text: "Yes", fromId: 7 });

    expect(
      resolveTelegramAcknowledgementBinding({
        conversationId: CONVERSATION_ID,
        msg: ack,
        recentMessages: [node(priorUser), node(question)],
        botUserId: BOT_ID,
      }),
    ).toEqual({ kind: "bound", target: node(question) });
  });

  it("requires clarification when zero or multiple questions are eligible", () => {
    const priorUser = message({ id: 19, text: "Choose", fromId: 7 });
    const first = message({ id: 20, text: "First?", fromId: BOT_ID, isBot: true });
    const second = message({ id: 21, text: "Second?", fromId: BOT_ID, isBot: true });
    const ack = message({ id: 22, text: "OK", fromId: 7 });

    expect(
      resolveTelegramAcknowledgementBinding({
        conversationId: CONVERSATION_ID,
        msg: ack,
        recentMessages: [],
        botUserId: BOT_ID,
      }),
    ).toEqual({ kind: "clarify", candidateCount: 0 });
    expect(
      resolveTelegramAcknowledgementBinding({
        conversationId: CONVERSATION_ID,
        msg: ack,
        recentMessages: [node(priorUser), node(first, "19"), node(second, "19")],
        botUserId: BOT_ID,
      }),
    ).toEqual({ kind: "clarify", candidateCount: 2 });
  });

  it("rejects a delayed question from an older human turn", () => {
    const oldUser = message({ id: 40, text: "Old request", fromId: 7 });
    const newerUser = message({ id: 41, text: "New request", fromId: 7 });
    const delayedQuestion = message({
      id: 42,
      text: "Proceed with the old request?",
      fromId: BOT_ID,
      isBot: true,
    });
    const ack = message({ id: 43, text: "Yes", fromId: 7 });

    expect(
      resolveTelegramAcknowledgementBinding({
        conversationId: CONVERSATION_ID,
        msg: ack,
        recentMessages: [oldUser, newerUser, delayedQuestion].map((entry) =>
          entry === delayedQuestion ? node(entry, "40") : node(entry),
        ),
        botUserId: BOT_ID,
      }),
    ).toEqual({ kind: "clarify", candidateCount: 0 });
  });

  it("does not infer explicit replies, expired questions, or consumed questions", () => {
    const question = message({ id: 30, text: "Proceed?", fromId: BOT_ID, isBot: true });
    const explicitAck = message({ id: 31, text: "Yes", fromId: 7, replyTo: question });
    expect(
      resolveTelegramAcknowledgementBinding({
        conversationId: CONVERSATION_ID,
        msg: explicitAck,
        recentMessages: [node(question)],
        botUserId: BOT_ID,
      }),
    ).toEqual({ kind: "not-applicable" });

    const lateAck = message({ id: 32, text: "Yes", fromId: 7, date: 4_000 });
    expect(
      resolveTelegramAcknowledgementBinding({
        conversationId: CONVERSATION_ID,
        msg: lateAck,
        recentMessages: [node(question)],
        botUserId: BOT_ID,
        ttlMs: 1_000,
      }),
    ).toEqual({ kind: "clarify", candidateCount: 0 });

    const firstAck = message({ id: 33, text: "Yes", fromId: 7 });
    const repeatedAck = message({ id: 34, text: "Yes", fromId: 7 });
    expect(
      resolveTelegramAcknowledgementBinding({
        conversationId: CONVERSATION_ID,
        msg: repeatedAck,
        recentMessages: [node(question), node(firstAck)],
        botUserId: BOT_ID,
      }),
    ).toEqual({ kind: "clarify", candidateCount: 0 });

    const consumedQuestion = node(question);
    consumedQuestion.expectedResponseBinding = {
      ...consumedQuestion.expectedResponseBinding!,
      consumedByInboundMessageId: "33",
    };
    expect(
      resolveTelegramAcknowledgementBinding({
        conversationId: CONVERSATION_ID,
        msg: repeatedAck,
        recentMessages: [consumedQuestion],
        botUserId: BOT_ID,
      }),
    ).toEqual({ kind: "clarify", candidateCount: 0 });

    consumedQuestion.expectedResponseBinding = {
      ...consumedQuestion.expectedResponseBinding!,
      consumedByInboundMessageId: String(repeatedAck.message_id),
    };
    const priorUser = message({ id: 29, text: "Proceed request", fromId: 7 });
    expect(
      resolveTelegramAcknowledgementBinding({
        conversationId: CONVERSATION_ID,
        msg: repeatedAck,
        recentMessages: [node(priorUser), consumedQuestion],
        botUserId: BOT_ID,
      }),
    ).toEqual({ kind: "bound", target: consumedQuestion });
  });
});
