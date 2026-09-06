import fs from "node:fs/promises";
import { parseSkillFrontmatter } from "../loading/frontmatter.js";

export const WORKSHOP_PROTECTION_KEY = "openclaw-workshop-protection";
export const WORKSHOP_PROTECTION_THOMAS_GO = "thomas-go-required";

/** Reads protection only from the current active skill, never from proposal-controlled content. */
export async function isActiveSkillWorkshopProtected(skillFile: string): Promise<boolean> {
  const content = await fs.readFile(skillFile, "utf8");
  const frontmatter = parseSkillFrontmatter(content);
  const marker = frontmatter[WORKSHOP_PROTECTION_KEY]?.trim();
  if (marker === undefined) {
    return false;
  }
  if (marker !== WORKSHOP_PROTECTION_THOMAS_GO) {
    throw new Error(`Invalid ${WORKSHOP_PROTECTION_KEY} marker in active skill.`);
  }
  return true;
}
