import { describe, expect, it } from "vitest";
import { buildCli } from "../../src/cli/commands.js";

describe("CLI", () => {
  it("does not expose activation or licensing commands", () => {
    const names = buildCli().commands.map((command) => command.name());
    expect(names).toEqual([
      "serve",
      "login",
      "logout",
      "list-systems",
      "doctor",
      "trust-certificate",
      "install-skills",
    ]);
  });
});
