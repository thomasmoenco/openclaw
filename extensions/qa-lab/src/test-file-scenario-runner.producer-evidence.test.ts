import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { QaEvidenceSummaryJson } from "./evidence-summary.js";
import { createTempDirHarness } from "./temp-dir.test-helper.js";
import { runQaTestFileScenarios, type QaTestFileScenario } from "./test-file-scenario-runner.js";

const { cleanup, makeTempDir } = createTempDirHarness();

function makeScriptScenario(): QaTestFileScenario {
  return {
    id: "producer-freshness",
    title: "Producer freshness",
    surface: "qa-lab",
    category: "qa-lab.coverage",
    coverage: { primary: ["qa.coverage"], secondary: ["qa.reporting"] },
    objective: "Require evidence from this script invocation.",
    successCriteria: ["The script writes a fresh evidence bundle."],
    docsRefs: ["docs/concepts/qa-e2e-automation.md"],
    codeRefs: ["scripts/evidence-producer.ts"],
    sourcePath: "qa/scenarios/qa-lab/producer-freshness.yaml",
    execution: {
      kind: "script",
      path: "scripts/evidence-producer.ts",
      args: ["--artifact-base", "${outputDir}"],
    },
  };
}

function makeEvidence(entries: QaEvidenceSummaryJson["entries"]): QaEvidenceSummaryJson {
  return {
    kind: "openclaw.qa.evidence-summary",
    schemaVersion: 2,
    generatedAt: "2026-07-29T00:00:00.000Z",
    evidenceMode: "full",
    entries,
  };
}

function makePassingEntry(id: string): QaEvidenceSummaryJson["entries"][number] {
  return {
    test: {
      kind: "script-producer-check",
      id,
      title: `Producer check: ${id}`,
      source: { path: "scripts/evidence-producer.ts" },
    },
    coverage: [],
    result: { status: "pass" },
  };
}

async function writeProducerBundle(params: {
  entries: QaEvidenceSummaryJson["entries"];
  scenarioOutputDir: string;
}) {
  await fs.mkdir(params.scenarioOutputDir, { recursive: true });
  await fs.writeFile(
    path.join(params.scenarioOutputDir, "qa-evidence.json"),
    `${JSON.stringify(makeEvidence(params.entries), null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(params.scenarioOutputDir, "latest-run.json"),
    `${JSON.stringify({ qaEvidence: "qa-evidence.json" }, null, 2)}\n`,
    "utf8",
  );
}

async function runScriptScenario(params: {
  repoRoot: string;
  runCommand: () => Promise<{ exitCode: number; stderr: string; stdout: string }>;
}) {
  return await runQaTestFileScenarios({
    repoRoot: params.repoRoot,
    outputDir: path.join(params.repoRoot, "out"),
    providerMode: "mock-openai",
    primaryModel: "mock-openai/gpt-5.6-luna",
    scenarios: [makeScriptScenario()],
    runCommand: params.runCommand,
  });
}

afterEach(async () => {
  await cleanup();
});

describe("QA script producer evidence freshness", () => {
  it("fails when a successful script produces no evidence", async () => {
    const repoRoot = await makeTempDir("qa-script-no-evidence-");
    const result = await runScriptScenario({
      repoRoot,
      runCommand: async () => ({ exitCode: 0, stdout: "done\n", stderr: "" }),
    });

    expect(result.results[0]).toMatchObject({
      status: "fail",
      failureMessage: "missing fresh producer evidence bundle",
    });
    expect(result.evidence.entries[0]?.result).toMatchObject({
      status: "fail",
      failure: { reason: "missing fresh producer evidence bundle" },
    });
  });

  it("invalidates stale producer indexes before launching the script", async () => {
    const repoRoot = await makeTempDir("qa-script-stale-evidence-");
    const scenarioOutputDir = path.join(repoRoot, "out", "producer-freshness");
    const evidencePath = path.join(scenarioOutputDir, "qa-evidence.json");
    const latestRunPath = path.join(scenarioOutputDir, "latest-run.json");
    await writeProducerBundle({
      entries: [makePassingEntry("stale-pass")],
      scenarioOutputDir,
    });

    const result = await runScriptScenario({
      repoRoot,
      runCommand: async () => {
        await expect(fs.access(evidencePath)).rejects.toThrow();
        await expect(fs.access(latestRunPath)).rejects.toThrow();
        return { exitCode: 0, stdout: "done\n", stderr: "" };
      },
    });

    expect(result.results[0]).toMatchObject({
      status: "fail",
      failureMessage: "missing fresh producer evidence bundle",
    });
    expect(result.evidence.entries.map((entry) => entry.test.id)).toEqual(["producer-freshness"]);
  });

  it("rejects an empty producer evidence bundle", async () => {
    const repoRoot = await makeTempDir("qa-script-empty-evidence-");
    const result = await runScriptScenario({
      repoRoot,
      runCommand: async () => {
        await writeProducerBundle({
          entries: [],
          scenarioOutputDir: path.join(repoRoot, "out", "producer-freshness"),
        });
        return { exitCode: 0, stdout: "done\n", stderr: "" };
      },
    });

    expect(result.results[0]).toMatchObject({
      status: "fail",
      failureMessage: "producer evidence contains no entries",
      producerEvidence: { entries: [] },
    });
    expect(result.evidence.entries[0]?.result.status).toBe("fail");
  });

  it("rejects malformed producer evidence", async () => {
    const repoRoot = await makeTempDir("qa-script-malformed-evidence-");
    const result = await runScriptScenario({
      repoRoot,
      runCommand: async () => {
        const scenarioOutputDir = path.join(repoRoot, "out", "producer-freshness");
        await fs.mkdir(scenarioOutputDir, { recursive: true });
        await fs.writeFile(path.join(scenarioOutputDir, "qa-evidence.json"), "{", "utf8");
        await fs.writeFile(
          path.join(scenarioOutputDir, "latest-run.json"),
          '{"qaEvidence":"qa-evidence.json"}\n',
          "utf8",
        );
        return { exitCode: 0, stdout: "done\n", stderr: "" };
      },
    });

    expect(result.results[0]).toMatchObject({ status: "fail" });
    expect(result.results[0]?.failureMessage).toContain("invalid producer evidence: invalid JSON");
    expect(result.evidence.entries[0]?.result.status).toBe("fail");
  });

  it("rejects a fresh pointer to a stale non-canonical evidence path", async () => {
    const repoRoot = await makeTempDir("qa-script-stale-alternate-evidence-");
    const scenarioOutputDir = path.join(repoRoot, "out", "producer-freshness");
    const staleEvidencePath = path.join(scenarioOutputDir, "prior-evidence.json");
    await fs.mkdir(scenarioOutputDir, { recursive: true });
    await fs.writeFile(
      staleEvidencePath,
      `${JSON.stringify(makeEvidence([makePassingEntry("stale-pass")]), null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(scenarioOutputDir, "latest-run.json"),
      '{"qaEvidence":"prior-evidence.json"}\n',
      "utf8",
    );

    const result = await runScriptScenario({
      repoRoot,
      runCommand: async () => {
        await expect(fs.access(staleEvidencePath)).resolves.toBeUndefined();
        await fs.writeFile(
          path.join(scenarioOutputDir, "latest-run.json"),
          '{"qaEvidence":"prior-evidence.json"}\n',
          "utf8",
        );
        return { exitCode: 0, stdout: "done\n", stderr: "" };
      },
    });

    expect(result.results[0]).toMatchObject({ status: "fail" });
    expect(result.results[0]?.failureMessage).toContain(
      "latest-run.json must reference qa-evidence.json",
    );
    expect(result.evidence.entries.map((entry) => entry.test.id)).toEqual(["producer-freshness"]);
  });

  it("imports fresh evidence written after stale indexes are invalidated", async () => {
    const repoRoot = await makeTempDir("qa-script-fresh-evidence-");
    const scenarioOutputDir = path.join(repoRoot, "out", "producer-freshness");
    await writeProducerBundle({
      entries: [makePassingEntry("stale-pass")],
      scenarioOutputDir,
    });

    const result = await runScriptScenario({
      repoRoot,
      runCommand: async () => {
        await writeProducerBundle({
          entries: [makePassingEntry("fresh-pass")],
          scenarioOutputDir,
        });
        return { exitCode: 0, stdout: "done\n", stderr: "" };
      },
    });

    expect(result.results[0]).toMatchObject({ status: "pass" });
    expect(result.evidence.entries.map((entry) => entry.test.id)).toEqual(["fresh-pass"]);
  });
});
