// QA Lab Slack tests cover module-specific flow preparation boundaries.
import { describe, expect, it, vi } from "vitest";
import { createSlackQaScenarioEnvironment } from "./scenario-environment.js";

describe("Slack scenario environment", () => {
  it("leaves generic declarative flows on the adapter's baseline config", async () => {
    const gatewayCall = vi.fn();
    const { prepareFlow } = createSlackQaScenarioEnvironment({
      accountId: "sut",
      channelId: "C123",
      driverBotUserId: "U_DRIVER",
      driverClient: {} as never,
      sutAppToken: "xapp-test",
      sutBotToken: "xoxb-test",
      sutIdentity: { userId: "U_SUT" } as never,
      sutReadClient: {} as never,
      sutWriteClient: {} as never,
    });

    await expect(
      prepareFlow({
        config: { replyMarker: "QA-THREAD-FOLLOW-UP-OK" },
        gateway: { call: gatewayCall } as never,
        outputDir: "/tmp/slack-output",
        primaryModel: "mock-openai/gpt-5.6-luna",
        timeoutMs: 60_000,
        waitForConfigRestartSettle: vi.fn(),
      }),
    ).resolves.toBeUndefined();
    expect(gatewayCall).not.toHaveBeenCalled();
  });
});
