import { expectDefined } from "@openclaw/normalization-core";
import { vi } from "vitest";
import type {
  GatewayClient,
  GatewayRequestContext,
  RespondFn,
} from "../../server-methods/types.js";
import { resolveSessionMutationAuthorization } from "../../session-sharing.js";
import { talkHandlers } from "./index.js";

type TalkHandlerCallOptions = {
  params: Record<string, unknown>;
  respond: RespondFn;
  context: unknown;
  client?: unknown;
  id?: string;
};

export async function callTalkHandler(
  method: keyof typeof talkHandlers,
  { params, respond, context, client = { connId: "conn-1" }, id = "1" }: TalkHandlerCallOptions,
) {
  const admission =
    method === "talk.client.create" ||
    method === "talk.session.create" ||
    method === "talk.client.toolCall"
      ? resolveSessionMutationAuthorization({
          client: client as GatewayClient,
          context: context as GatewayRequestContext,
          method,
          requestParams: params,
        })
      : undefined;
  if (admission?.error) {
    respond(false, undefined, admission.error);
    return;
  }
  await expectDefined(
    talkHandlers[method],
    `talkHandlers["${method}"] test invariant`,
  )({
    req: { type: "req", id, method },
    params: params as never,
    client: client as never,
    isWebchatConnect: () => false,
    respond,
    context: context as never,
    // Row creation is mocked here; talk-target.test covers the real post-ensure fence.
    ...(admission?.authorization
      ? {
          sessionMutationAuthorization: {
            ...admission.authorization,
            assertTargetCurrent: vi.fn(),
          },
        }
      : {}),
  });
}
