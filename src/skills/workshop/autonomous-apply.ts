import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { isWorkshopOwnedSkillDir } from "./ownership.js";
import { isActiveSkillWorkshopProtected } from "./protection.js";
import { applySkillProposal } from "./service.js";
import { readSkillProposalRecord, updateSkillProposalRecord } from "./store.js";
import { withSkillProposalCommitLock } from "./target-lock.js";
import type { SkillProposalReadResult, SkillProposalRecord, SkillProposalStatus } from "./types.js";

const USER_AUTHORED_PENDING_REASON = "user-authored skill; awaiting operator review";
const CREATE_PENDING_REASON = "new skill; awaiting operator review";
const PROTECTED_PENDING_REASON = "protected skill; awaiting Thomas GO";

type AutonomousSkillProposal = Pick<SkillProposalReadResult, "record" | "revisionHash">;

type AutonomousSkillProposalResult =
  | { status: Exclude<SkillProposalStatus, "applied">; record: SkillProposalRecord }
  | { status: "applied"; record: SkillProposalRecord; targetSkillFile: string };

export async function applyAutonomousSkillProposal(params: {
  workspaceDir: string;
  agentId?: string;
  config?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  eventActor?: Parameters<typeof applySkillProposal>[0]["eventActor"];
  proposal: AutonomousSkillProposal;
  reason: string;
}): Promise<AutonomousSkillProposalResult> {
  const store = params.env ? { env: params.env } : {};
  // Decides pending-vs-apply only; the apply transition rechecks ownership under its commit lock.
  const protectedTarget =
    params.proposal.record.kind === "update"
      ? await isActiveSkillWorkshopProtected(params.proposal.record.target.skillFile)
      : false;
  const pendingReason =
    params.proposal.record.kind === "create"
      ? CREATE_PENDING_REASON
      : protectedTarget
        ? PROTECTED_PENDING_REASON
        : !isWorkshopOwnedSkillDir(
              params.workspaceDir,
              params.proposal.record.target.skillDir,
              store,
            )
          ? USER_AUTHORED_PENDING_REASON
          : undefined;
  if (pendingReason) {
    // Same commit lock as apply: an operator may apply this proposal between the ownership
    // check and this write, and the pending reason must not overwrite that outcome.
    const record = await withSkillProposalCommitLock(
      params.workspaceDir,
      params.proposal.record,
      async () => {
        const current = await readSkillProposalRecord(params.proposal.record.id, store);
        if (!current) {
          throw new Error(`Skill proposal not found: ${params.proposal.record.id}`);
        }
        if (current.status !== "pending") {
          return current;
        }
        const pending = {
          ...current,
          updatedAt: new Date().toISOString(),
          statusReason: pendingReason,
        };
        await updateSkillProposalRecord({ record: pending, store });
        return pending;
      },
      store,
    );
    return record.status === "applied"
      ? { status: "applied", record, targetSkillFile: record.target.skillFile }
      : { status: record.status, record };
  }
  const applied = await applySkillProposal({
    workspaceDir: params.workspaceDir,
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.config ? { config: params.config } : {}),
    ...(params.env ? { env: params.env } : {}),
    ...(params.eventActor ? { eventActor: params.eventActor } : {}),
    proposalId: params.proposal.record.id,
    expectedRevisionHash: params.proposal.revisionHash,
    reason: params.reason,
  });
  return { status: "applied", ...applied };
}
