import type { Message } from "grammy/types";
import { getTelegramTextParts } from "./bot/helpers.js";
import {
  isTelegramMessageFromCurrentBot,
  type TelegramCachedMessageNode,
} from "./message-cache.js";

export const TELEGRAM_ACKNOWLEDGEMENT_TTL_MS = 30 * 60 * 1000;

const LOW_ENTROPY_ACKNOWLEDGEMENTS = new Set(["ja", "yes", "ok", "okay", "nei", "no"]);

export type TelegramAcknowledgementBinding =
  | { kind: "not-applicable" }
  | { kind: "bound"; target: TelegramCachedMessageNode }
  | { kind: "clarify"; candidateCount: number };

export function isLowEntropyTelegramAcknowledgement(text: string | undefined): boolean {
  const normalized = text
    ?.normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[.!?]+$/u, "")
    .trim();
  return normalized ? LOW_ENTROPY_ACKNOWLEDGEMENTS.has(normalized) : false;
}

function hasExplicitReply(msg: Message): boolean {
  return Boolean(
    msg.reply_to_message ?? (msg as Message & { external_reply?: Message }).external_reply,
  );
}

function isQuestionCandidate(node: TelegramCachedMessageNode): boolean {
  return typeof node.body === "string" && node.body.includes("?");
}

/**
 * Resolves a replyless, low-entropy DM acknowledgement against authenticated
 * outbound Telegram history. The most recent human message is a consumption
 * boundary, so one question cannot be inferred twice.
 */
export function resolveTelegramAcknowledgementBinding(params: {
  conversationId: string;
  msg: Message;
  recentMessages: readonly TelegramCachedMessageNode[];
  botUserId?: number;
  nowMs?: number;
  ttlMs?: number;
}): TelegramAcknowledgementBinding {
  if (
    params.msg.chat.type !== "private" ||
    hasExplicitReply(params.msg) ||
    !isLowEntropyTelegramAcknowledgement(getTelegramTextParts(params.msg).text)
  ) {
    return { kind: "not-applicable" };
  }
  if (params.botUserId === undefined) {
    return { kind: "clarify", candidateCount: 0 };
  }

  const lastHumanIndex = params.recentMessages.findLastIndex(
    (node) => !isTelegramMessageFromCurrentBot(node.sourceMessage, params.botUserId),
  );
  const lastHumanMessageId = params.recentMessages[lastHumanIndex]?.messageId;
  const nowMs = params.nowMs ?? params.msg.date * 1000;
  const ttlMs = params.ttlMs ?? TELEGRAM_ACKNOWLEDGEMENT_TTL_MS;
  const candidates = params.recentMessages.slice(lastHumanIndex + 1).filter((node) => {
    if (!isTelegramMessageFromCurrentBot(node.sourceMessage, params.botUserId)) {
      return false;
    }
    const expected = node.expectedResponseBinding;
    if (
      !expected ||
      (expected.consumedByInboundMessageId !== undefined &&
        expected.consumedByInboundMessageId !== String(params.msg.message_id)) ||
      expected.conversationId !== params.conversationId ||
      expected.inboundMessageId !== lastHumanMessageId ||
      expected.parentOutboundMessageId !== node.messageId ||
      !isQuestionCandidate(node)
    ) {
      return false;
    }
    const ageMs = nowMs - expected.createdAt;
    return ageMs >= 0 && ageMs <= ttlMs;
  });

  return candidates.length === 1
    ? { kind: "bound", target: candidates[0]! }
    : { kind: "clarify", candidateCount: candidates.length };
}
