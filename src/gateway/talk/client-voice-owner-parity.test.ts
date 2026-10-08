/** Voice misfire protection must not add a second permission policy for the owner. */
import { afterEach, expect, it, vi } from "vitest";
import { wrapToolWithBeforeToolCallHook } from "../../agents/agent-tools.before-tool-call.js";
import {
  consumeFinalClientVoiceToolConfirmation,
  runBeforeToolCallHook,
} from "../../agents/agent-tools.before-tool-call.policy.js";
import { createExecTool } from "../../agents/bash-tools.exec-run.js";
import { resolveExecDefaults } from "../../agents/exec-defaults.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "../../plugins/hook-runner-global.js";
import { createMockPluginRegistry } from "../../plugins/hooks.test-fixtures.js";
import { resetClientVoiceConfirmationStateForTest } from "../../talk/client-voice-confirmation.test-support.js";
import {
  bindClientVoiceNativeAuthority,
  createOrResumeClientVoiceSession,
  registerClientVoiceConsultRun,
} from "../../talk/client-voice-session.js";
import { withOpenClawTestState } from "../../test-utils/openclaw-test-state.js";
import { invalidateGatewayPolicyClient } from "../server/ws-policy-close.js";
import { sharingPolicyClient } from "../session-sharing.test-utils.js";
import { resolveTalkAgentConsultAuthority } from "./client-gateway-control.js";

afterEach(() => {
  resetGlobalHookRunner();
  resetClientVoiceConfirmationStateForTest();
  vi.restoreAllMocks();
});

function bindOwner(runId: string, scopes = ["operator.admin"]) {
  const target = { agentId: "main", sessionKey: `agent:main:${runId}` };
  const client = { ...sharingPolicyClient({ scopes }), socket: { close: vi.fn() } };
  const authority = resolveTalkAgentConsultAuthority(scopes, client);
  const voiceSessionId = createOrResumeClientVoiceSession({
    ...target,
    origin: "client",
    transcriptCapable: true,
  });
  registerClientVoiceConsultRun({ ...target, voiceSessionId, runId });
  const binding = {
    ...target,
    voiceSessionId,
    runId,
    isOwnerCurrent: () => authority.senderIsOwner && authority.isOwnerCurrent?.() === true,
  };
  bindClientVoiceNativeAuthority(binding);
  return { client, authority, binding, ctx: { ...target, runId } };
}

it("preserves text/voice full, ask, read-only, sandbox and implicit-full host-floor policy", async () => {
  await withOpenClawTestState({ scenario: "minimal" }, async (state) => {
    await state.writeConfig({ plugins: { enabled: false } });
    const cfg: OpenClawConfig = {
      tools: { exec: { host: "gateway", mode: "full" } },
      plugins: { enabled: false },
    };
    const owner = bindOwner("owner-parity");
    const cases = [
      {
        label: "full",
        sessionEntry: { permissionMode: "full" as const },
        expected: { security: "full", ask: "off", effectiveHost: "gateway" },
      },
      {
        label: "ask",
        sessionEntry: { permissionMode: "guarded" as const },
        expected: { security: "allowlist", ask: "on-miss", effectiveHost: "gateway" },
      },
      {
        label: "read-only",
        sessionEntry: { permissionMode: "read-only" as const },
        expected: { security: "deny", effectiveHost: "gateway" },
      },
      {
        label: "sandbox",
        sessionEntry: { permissionMode: "full" as const, sandbox: "required" as const },
        expected: { effectiveHost: "sandbox", canRequestNode: false },
      },
      {
        label: "implicit-full",
        sessionEntry: {},
        expected: { security: "deny", ask: "off", effectiveHost: "gateway" },
      },
    ];
    for (const entry of cases) {
      const policy = resolveExecDefaults({
        cfg,
        agentId: "main",
        sessionEntry: entry.sessionEntry,
        sandboxAvailable: entry.label === "sandbox",
        execApprovals: {
          version: 1,
          defaults: { security: entry.label === "implicit-full" ? "deny" : "full", ask: "off" },
          agents: {},
        },
      });
      expect(policy, entry.label).toMatchObject(entry.expected);
      // Both before-tool hook paths and final consumption use the same owner binding,
      // independently of the native permission policy which still owns exec below.
      const call = {
        toolName: "exec",
        params: { command: "printf parity" },
        toolCallId: entry.label,
      };
      const text = await runBeforeToolCallHook({ ...call, ctx: { config: cfg } });
      const voice = await runBeforeToolCallHook({ ...call, ctx: { ...owner.ctx, config: cfg } });
      expect(voice, entry.label).toEqual(text);
      expect(voice.blocked).toBe(false);
      expect(consumeFinalClientVoiceToolConfirmation({ ...call, ctx: owner.ctx }).allowed).toBe(
        true,
      );
      // Actual native exec rejects deny and unavailable required sandbox identically.
      // Ask is asserted above without starting an external approval request.
      if (entry.label === "ask") {
        continue;
      }
      const outcomes = [];
      for (const ctx of [{ config: cfg }, { ...owner.ctx, config: cfg }]) {
        const tool = wrapToolWithBeforeToolCallHook(
          createExecTool({
            host: policy.effectiveHost,
            security: policy.security,
            ask: policy.ask,
            bypassHostApprovalFloors: entry.sessionEntry.permissionMode === "full",
            cwd: state.workspaceDir,
            allowBackground: false,
          }),
          ctx,
        );
        try {
          const result = await tool.execute(entry.label, call.params);
          outcomes.push({ details: result.details, content: result.content });
        } catch (error) {
          outcomes.push({ error: String(error) });
        }
      }
      if (entry.label === "full") {
        for (const outcome of outcomes) {
          expect(outcome).toMatchObject({ details: { status: "completed", exitCode: 0 } });
        }
      } else {
        expect(outcomes[0]).toEqual(outcomes[1]);
        expect(JSON.stringify(outcomes[0])).toMatch(/denied|sandbox requires a sandbox runtime/i);
      }
    }
  });
});

it.each([true, false])(
  "rechecks actual source invalidation at consumption with scopes unchanged (revoke=%s)",
  async (revokeSource) => {
    await withOpenClawTestState({ scenario: "minimal" }, async () => {
      const owner = bindOwner(`source-${revokeSource}`);
      const args = { toolName: "exec", params: { command: "printf parity" }, ctx: owner.ctx };
      expect((await runBeforeToolCallHook(args)).blocked).toBe(false);
      invalidateGatewayPolicyClient(owner.client, {
        reason: "fixture",
        code: 1008,
        message: "fixture",
        revokeSource,
      });
      expect(owner.client.connect.scopes).toEqual(["operator.admin"]);
      expect(consumeFinalClientVoiceToolConfirmation(args).allowed).toBe(!revokeSource);
      expect((await runBeforeToolCallHook(args)).blocked).toBe(revokeSource);
    });
  },
);

it("keeps admin scope live, exact run binding, unknown/non-owner challenge and tool limits", async () => {
  await withOpenClawTestState({ scenario: "minimal" }, async () => {
    const owner = bindOwner("scope");
    expect(() =>
      bindClientVoiceNativeAuthority({ ...owner.binding, voiceSessionId: "foreign" }),
    ).toThrow(/exact registered run/);
    const args = { toolName: "exec", params: { command: "printf parity" }, ctx: owner.ctx };
    owner.client.connect.scopes = ["operator.write"];
    expect(consumeFinalClientVoiceToolConfirmation(args).allowed).toBe(false);
    for (const scopes of [[], ["operator.read"], ["operator.write"]]) {
      const other = bindOwner(`non-owner-${scopes.join(",")}`, scopes);
      expect((await runBeforeToolCallHook({ ...args, ctx: other.ctx })).blocked).toBe(true);
      if (!scopes.includes("operator.write")) {
        expect(other.authority.toolsAllow).toBeDefined();
      }
    }
  });
});

it("keeps trusted policy veto and normal hooks in both text and owner voice", async () => {
  await withOpenClawTestState({ scenario: "minimal" }, async () => {
    const owner = bindOwner("trusted-veto");
    for (const trusted of [true, false]) {
      const veto = vi.fn(() => ({ block: true, blockReason: "protected fixture effect" }));
      const registry = createMockPluginRegistry(
        trusted ? [] : [{ hookName: "before_tool_call", handler: veto }],
      );
      if (trusted) {
        registry.trustedToolPolicies = [
          {
            pluginId: "fixture",
            source: "test",
            policy: { id: "protected-effect", description: "Fixture", evaluate: veto },
          },
        ];
      }
      initializeGlobalHookRunner(registry);
      for (const ctx of [{}, owner.ctx]) {
        const outcome = await runBeforeToolCallHook({
          toolName: "message",
          params: { action: "send", target: "fixture", message: "fixture" },
          ctx,
        });
        expect(outcome).toMatchObject({
          blocked: true,
          deniedReason: "plugin-before-tool-call",
          reason: "protected fixture effect",
        });
      }
      expect(veto).toHaveBeenCalledTimes(2);
      resetGlobalHookRunner();
    }
  });
});
