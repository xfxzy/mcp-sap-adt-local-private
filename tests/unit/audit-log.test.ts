import { describe, expect, it } from "vitest";
import { AuditLog } from "../../src/audit/audit-log.js";

describe("AuditLog", () => {
  it("redacts standard and configured sensitive keys recursively", async () => {
    const lines: string[] = [];
    const audit = new AuditLog(
      { append: async (line) => void lines.push(line) },
      ["TaxNumber"],
      () => new Date("2026-08-09T00:00:00Z"),
    );

    await audit.write({
      event: "business-change",
      timestamp: "forged",
      password: "secret",
      nested: { authorization: "Basic abc", TaxNumber: "123" },
      result: "ok",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("secret");
    expect(lines[0]).not.toContain("Basic abc");
    expect(lines[0]).not.toContain('"123"');
    expect(JSON.parse(lines[0])).toMatchObject({
      timestamp: "2026-08-09T00:00:00.000Z",
      event: "business-change",
      password: "[REDACTED]",
      result: "ok",
    });
  });
});
