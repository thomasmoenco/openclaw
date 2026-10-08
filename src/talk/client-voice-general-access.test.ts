import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeObservedClientVoiceConfirmation,
  bindAuthorizedClientVoiceConfirmation,
  consumeClientVoiceToolConfirmationPolicy,
  observeClientVoiceConfirmationRun,
} from "./client-voice-confirmation.js";
import {
  noteClientVoiceConfirmationUtteranceForTest,
  resetClientVoiceConfirmationStateForTest,
} from "./client-voice-confirmation.test-support.js";

afterEach(resetClientVoiceConfirmationStateForTest);
describe("exact native continuation", () => {
  it("retains immutable original arguments and grants one exact retry only", () => {
    const toolParams = {
      command: "unknown-cli --dry-run",
      title: "Private fixture",
      yieldMs: 1000,
    };
    const original = structuredClone(toolParams);
    const scope = { agentId: "main", voiceSessionId: "fixture-voice" };
    const blocked = consumeClientVoiceToolConfirmationPolicy({
      ...scope,
      runId: "first",
      toolCallId: "exact",
      toolName: "exec",
      toolParams,
      now: 100,
    });
    expect(blocked.allowed).toBe(false);
    toolParams.command = "changed";
    noteClientVoiceConfirmationUtteranceForTest({ ...scope, text: "ja", timestamp: 101 });
    const grant = authorizeObservedClientVoiceConfirmation({ ...scope, now: 102 });
    expect(grant?.retryContext).toContain(JSON.stringify(original));
    expect(grant?.retryContext).not.toContain('"command":"changed"');
    expect(bindAuthorizedClientVoiceConfirmation({ grant: grant!, runId: "retry", now: 103 })).toBe(
      true,
    );
    const retry = { ...scope, runId: "retry", toolName: "exec", toolParams: original, now: 104 };
    expect(consumeClientVoiceToolConfirmationPolicy(retry).allowed).toBe(true);
    expect(consumeClientVoiceToolConfirmationPolicy(retry).allowed).toBe(false);
  });
  it("speaks Norwegian for pending and cancelled actions", () => {
    const scope = { agentId: "main", voiceSessionId: "fixture-voice", runId: "first" };
    const observation = observeClientVoiceConfirmationRun(scope);
    consumeClientVoiceToolConfirmationPolicy({
      ...scope,
      toolCallId: "send",
      toolName: "message",
      toolParams: { action: "send" },
      now: Date.now(),
    });
    expect(observation.readReply()).toContain('Si "ja"');
    noteClientVoiceConfirmationUtteranceForTest({
      ...scope,
      text: "nei",
      timestamp: Date.now() + 1,
    });
    expect(observation.readReply()).toContain("ikke lenger er gyldig");
    expect(authorizeObservedClientVoiceConfirmation(scope)).toBeUndefined();
    observation.release();
  });
});
