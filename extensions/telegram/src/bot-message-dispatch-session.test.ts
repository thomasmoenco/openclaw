import type { SessionTranscriptMessageEntry } from "openclaw/plugin-sdk/session-transcript-runtime";
import { describe, expect, it } from "vitest";
import { isTranscriptAssistantDescendedFromInboundMessage } from "./bot-message-dispatch-session.js";

function entry(params: {
  id: string;
  parentId: string | null;
  role: "user" | "assistant";
  transportMessageId?: string;
}): SessionTranscriptMessageEntry {
  return {
    entryId: params.id,
    parentId: params.parentId,
    seq: 1,
    role: params.role,
    message: {
      role: params.role,
      content: params.role === "assistant" ? "answer" : "question",
      ...(params.transportMessageId
        ? {
            __openclaw: {
              transport: { channel: "telegram", messageId: params.transportMessageId },
            },
          }
        : {}),
    },
  } as SessionTranscriptMessageEntry;
}

describe("Telegram transcript final ancestry", () => {
  it("accepts an assistant descendant of the current Telegram inbound message", () => {
    const entries = [
      entry({ id: "user-current", parentId: null, role: "user", transportMessageId: "16828" }),
      entry({ id: "assistant-current", parentId: "user-current", role: "assistant" }),
    ];
    expect(
      isTranscriptAssistantDescendedFromInboundMessage({
        entries,
        assistantMessageId: "assistant-current",
        inboundMessageId: "16828",
      }),
    ).toBe(true);
  });

  it("rejects a late assistant completion descended from an older Telegram message", () => {
    const entries = [
      entry({ id: "user-old", parentId: null, role: "user", transportMessageId: "16826" }),
      entry({ id: "assistant-late", parentId: "user-old", role: "assistant" }),
      entry({
        id: "user-current",
        parentId: "assistant-late",
        role: "user",
        transportMessageId: "16828",
      }),
    ];
    expect(
      isTranscriptAssistantDescendedFromInboundMessage({
        entries,
        assistantMessageId: "assistant-late",
        inboundMessageId: "16828",
      }),
    ).toBe(false);
  });

  it("rejects a newer turn even when the requested inbound exists higher in its ancestry", () => {
    const entries = [
      entry({ id: "user-requested", parentId: null, role: "user", transportMessageId: "16828" }),
      entry({
        id: "user-newer",
        parentId: "user-requested",
        role: "user",
        transportMessageId: "16830",
      }),
      entry({ id: "assistant-newer", parentId: "user-newer", role: "assistant" }),
    ];
    expect(
      isTranscriptAssistantDescendedFromInboundMessage({
        entries,
        assistantMessageId: "assistant-newer",
        inboundMessageId: "16828",
      }),
    ).toBe(false);
  });

  it("rejects missing candidates and cyclic ancestry", () => {
    const entries = [entry({ id: "assistant", parentId: "assistant", role: "assistant" })];
    expect(
      isTranscriptAssistantDescendedFromInboundMessage({
        entries,
        assistantMessageId: "missing",
        inboundMessageId: "16828",
      }),
    ).toBe(false);
    expect(
      isTranscriptAssistantDescendedFromInboundMessage({
        entries,
        assistantMessageId: "assistant",
        inboundMessageId: "16828",
      }),
    ).toBe(false);
  });
});
