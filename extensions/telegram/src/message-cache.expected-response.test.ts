import type { Message } from "grammy/types";
import { describe, expect, it } from "vitest";
import {
  createTelegramMessageCache,
  type PersistedTelegramMessageCacheValue,
} from "./message-cache.js";

function createPersistentStore() {
  const values = new Map<string, PersistedTelegramMessageCacheValue>();
  let failWrites = false;
  return {
    entries: async () => Array.from(values, ([key, value]) => ({ key, value })),
    register: async (key: string, value: PersistedTelegramMessageCacheValue) => {
      if (failWrites) {
        throw new Error("persistent store unavailable");
      }
      values.set(key, value);
    },
    setFailWrites: (value: boolean) => {
      failWrites = value;
    },
  };
}

describe("Telegram expected response cache", () => {
  it("persists and atomically consumes an expected response once", async () => {
    const persistentStore = createPersistentStore();
    const message = {
      message_id: 20,
      date: 100,
      chat: { id: 42, type: "private", first_name: "Thomas" },
      from: { id: 99, is_bot: true, first_name: "Hugin" },
      text: "Should I check the calendar?",
    } as Message;
    const correlation = {
      accountId: "default",
      conversationId: "default:42:root",
      generation: "generation-1",
      inboundMessageId: "19",
      runId: "run-1",
      sessionId: "session-1",
    };
    const writer = createTelegramMessageCache({
      bucketKey: "expected-response-writer",
      persistentStore,
      scope: "expected-response",
    });
    await writer.record({
      accountId: "default",
      botUserId: 99,
      chatId: 42,
      expectedResponseCorrelation: correlation,
      msg: message,
    });

    const reader = createTelegramMessageCache({
      bucketKey: "expected-response-reader",
      persistentStore,
      scope: "expected-response",
    });
    const consumed = await reader.consumeExpectedResponse({
      accountId: "default",
      botUserId: 99,
      chatId: 42,
      inboundMessageId: "21",
      messageId: "20",
    });
    expect(consumed?.expectedResponseBinding).toMatchObject({
      ...correlation,
      consumedByInboundMessageId: "21",
      parentOutboundMessageId: "20",
    });
    await expect(
      reader.consumeExpectedResponse({
        accountId: "default",
        botUserId: 99,
        chatId: 42,
        inboundMessageId: "21",
        messageId: "20",
      }),
    ).resolves.toMatchObject({
      expectedResponseBinding: { consumedByInboundMessageId: "21" },
    });
    await expect(
      reader.consumeExpectedResponse({
        accountId: "default",
        botUserId: 99,
        chatId: 42,
        inboundMessageId: "22",
        messageId: "20",
      }),
    ).resolves.toBeNull();

    const reloaded = createTelegramMessageCache({
      bucketKey: "expected-response-reloaded",
      persistentStore,
      scope: "expected-response",
    });
    await expect(
      reloaded.consumeExpectedResponse({
        accountId: "default",
        botUserId: 99,
        chatId: 42,
        inboundMessageId: "23",
        messageId: "20",
      }),
    ).resolves.toBeNull();
  });

  it("does not release a response claim when durable consumption fails", async () => {
    const persistentStore = createPersistentStore();
    const cache = createTelegramMessageCache({
      bucketKey: "expected-response-failure",
      persistentStore,
      scope: "expected-response-failure",
    });
    await cache.record({
      accountId: "default",
      botUserId: 99,
      chatId: 42,
      expectedResponseCorrelation: {
        accountId: "default",
        conversationId: "default:42:root",
        generation: "generation-1",
        inboundMessageId: "19",
        runId: "run-1",
        sessionId: "session-1",
      },
      msg: {
        message_id: 20,
        date: 100,
        chat: { id: 42, type: "private", first_name: "Thomas" },
        from: { id: 99, is_bot: true, first_name: "Hugin" },
        text: "Proceed?",
      } as Message,
    });
    persistentStore.setFailWrites(true);
    await expect(
      cache.consumeExpectedResponse({
        accountId: "default",
        botUserId: 99,
        chatId: 42,
        inboundMessageId: "21",
        messageId: "20",
      }),
    ).rejects.toThrow("persistent store unavailable");
    persistentStore.setFailWrites(false);
    await expect(
      cache.consumeExpectedResponse({
        accountId: "default",
        botUserId: 99,
        chatId: 42,
        inboundMessageId: "21",
        messageId: "20",
      }),
    ).resolves.toMatchObject({
      expectedResponseBinding: { consumedByInboundMessageId: "21" },
    });
  });
});
