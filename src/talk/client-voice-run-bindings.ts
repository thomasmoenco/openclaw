import type {
  ClientVoiceRunBinding,
  ClientVoiceSessionRecord,
} from "./client-voice-session-store.js";

export const voiceSessionByRunId = new Map<string, ClientVoiceRunBinding>();

/** Attach only to an already validated run/scope; reassignments discard this authority. */
export function bindClientVoiceNativeAuthority(params: {
  agentId: string;
  sessionKey: string;
  voiceSessionId: string;
  runId: string;
  isOwnerCurrent: () => boolean;
}): void {
  const binding = voiceSessionByRunId.get(params.runId);
  if (
    !binding ||
    binding.agentId !== params.agentId ||
    binding.sessionKey !== params.sessionKey ||
    binding.voiceSessionId !== params.voiceSessionId
  ) {
    throw new Error("Native voice authority requires the exact registered run binding");
  }
  voiceSessionByRunId.set(
    params.runId,
    Object.freeze({
      ...binding,
      isOwnerCurrent: params.isOwnerCurrent,
    }),
  );
}

/** Return the open voice-call binding for one executing run. */
export function resolveClientVoiceRunBinding(runId?: string): ClientVoiceRunBinding | undefined {
  return runId ? voiceSessionByRunId.get(runId) : undefined;
}

export function hasLiveConsultRun(record: ClientVoiceSessionRecord): boolean {
  return record.consultRunIds.some((runId) => {
    const binding = voiceSessionByRunId.get(runId);
    return (
      binding?.agentId === record.agentId &&
      binding.voiceSessionId === record.voiceSessionId &&
      binding.sessionKey === record.sessionKey
    );
  });
}
