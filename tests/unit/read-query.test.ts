import { describe, expect, it } from "vitest";
import { validateReadQuery } from "../../src/sql/validate-read-query.js";

const allowed = [
  "SELECT matnr, mtart FROM mara WHERE matnr = '1'",
  "SELECT a~matnr, b~bwkey FROM mara AS a INNER JOIN mbew AS b ON a~matnr = b~matnr WHERE b~bwkey = '1000'",
  "SELECT COUNT(*) AS cnt FROM mara WHERE mtart = 'FERT'",
];

const blocked = [
  "UPDATE mara SET mtart = 'X'",
  "SELECT matnr FROM mara; DELETE FROM mara",
  "SELECT * FROM mara WHERE matnr = '1'",
  "SELECT matnr FROM mara -- bypass",
  "SELECT matnr FROM mara /* bypass */",
  "SELECT matnr FROM mara WHERE matnr IN (SELECT matnr FROM marc)",
];

describe("validateReadQuery", () => {
  for (const sql of allowed) {
    it(`allows ${sql}`, () => {
      const result = validateReadQuery(sql, 500);
      expect(result.kind).toBe("select");
      expect(result.rowLimit).toBe(500);
      expect(result.sql).toMatch(/UP TO 500 ROWS$/i);
    });
  }

  for (const sql of blocked) {
    it(`blocks ${sql}`, () => {
      expect(() => validateReadQuery(sql, 500)).toThrow();
    });
  }

  it("keeps a lower explicit row limit and lowers an excessive one", () => {
    expect(
      validateReadQuery(
        "SELECT bukrs FROM t001 WHERE bukrs = '1000' UP TO 20 ROWS",
        500,
      ).rowLimit,
    ).toBe(20);
    expect(
      validateReadQuery(
        "SELECT bukrs FROM t001 WHERE bukrs = '1000' UP TO 900 ROWS",
        500,
      ).sql,
    ).toMatch(/UP TO 500 ROWS$/i);
  });

  it("requires a selective WHERE for configured large tables", () => {
    expect(() =>
      validateReadQuery("SELECT matnr FROM mara", 500, {
        largeTables: ["MARA"],
      }),
    ).toThrow(/where/i);
  });
});
