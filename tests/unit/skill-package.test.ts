import { describe, expect, it } from "vitest";
import {
  inspectPackagedSkills,
  REQUIRED_SKILLS,
} from "../../src/skills/skill-manifest.js";

describe("packaged SAP skills", () => {
  it("contains three entry points and the FS assets", async () => {
    const report = await inspectPackagedSkills(
      fileURLToPath(new URL("../../skills/", import.meta.url)),
    );
    expect(report.skillNames).toEqual([...REQUIRED_SKILLS].sort());
    expect(report.missingFiles).toEqual([]);
    expect(report.frontmatterNames).toEqual(
      expect.arrayContaining([...REQUIRED_SKILLS]),
    );
  });
});

import { fileURLToPath } from "node:url";
