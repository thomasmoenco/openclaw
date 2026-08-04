import { expectDefined } from "@openclaw/normalization-core";
import type { SessionTranscriptMessageEntry } from "openclaw/plugin-sdk/session-transcript-runtime";

type LatestAssistantTranscriptText = {
  id?: string;
  text: string;
  timestamp?: number;
};

export function requireInvocationOrder(
  mock: { mock: { invocationCallOrder: number[] } },
  index: number,
  context: string,
): number {
  return expectDefined(mock.mock.invocationCallOrder[index], context);
}

export function createTelegramTranscriptSnapshotMock(params: {
  inboundMessageId: string;
  latest?: LatestAssistantTranscriptText;
}) {
  if (!params.latest?.id) {
    return { entries: [] };
  }
  const entries = [
    {
      entryId: "telegram-current-user",
      parentId: null,
      seq: 1,
      role: "user",
      message: {
        role: "user",
        content: "inbound",
        __openclaw: {
          transport: { channel: "telegram", messageId: params.inboundMessageId },
        },
      },
    },
    {
      entryId: params.latest.id,
      parentId: "telegram-current-user",
      seq: 2,
      role: "assistant",
      message: { role: "assistant", content: params.latest.text },
    },
  ] as SessionTranscriptMessageEntry[];
  return { entries, latestAssistantText: params.latest };
}
