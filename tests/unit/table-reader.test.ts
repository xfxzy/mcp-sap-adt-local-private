import { describe, expect, it } from "vitest";
import {
  parseDataPreview,
  parseTableStructure,
  toDataPreviewSql,
} from "../../src/adt/table-reader.js";

describe("ADT table response parsing", () => {
  it("preserves DDIC field order and identifier strings", () => {
    const xml = `
      <ddic:table xmlns:ddic="urn:sap">
        <ddic:fields>
          <ddic:field ddic:name="BUKRS" ddic:dataType="CHAR" ddic:length="4" ddic:key="true" />
          <ddic:field ddic:name="BUTXT" ddic:dataType="CHAR" ddic:length="25" ddic:key="false" />
        </ddic:fields>
      </ddic:table>`;

    expect(parseTableStructure(xml, "t001")).toEqual({
      tableName: "T001",
      columns: [
        { name: "BUKRS", dataType: "CHAR", length: 4, key: true },
        { name: "BUTXT", dataType: "CHAR", length: 25, key: false },
      ],
    });
  });

  it("maps preview cells to columns without numeric coercion", () => {
    const xml = `
      <dataPreview:result xmlns:dataPreview="urn:sap">
        <dataPreview:columns>
          <dataPreview:column dataPreview:name="BUKRS" />
          <dataPreview:column dataPreview:name="ACCOUNT" />
        </dataPreview:columns>
        <dataPreview:rows>
          <dataPreview:row>
            <dataPreview:value>1000</dataPreview:value>
            <dataPreview:value>00123000</dataPreview:value>
          </dataPreview:row>
        </dataPreview:rows>
      </dataPreview:result>`;

    expect(parseDataPreview(xml)).toEqual({
      columns: ["BUKRS", "ACCOUNT"],
      rows: [{ BUKRS: "1000", ACCOUNT: "00123000" }],
    });
  });

  it("parses the DDIC Data Preview metadata shape returned by on-premise SAP", () => {
    const xml = `
      <dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">
        <dataPreview:name>T001</dataPreview:name>
        <dataPreview:columns>
          <dataPreview:metadata dataPreview:name="BUKRS" dataPreview:type="C" dataPreview:description="Company Code" dataPreview:keyAttribute="true" dataPreview:length="4" />
          <dataPreview:dataSet />
        </dataPreview:columns>
        <dataPreview:columns>
          <dataPreview:metadata dataPreview:name="BUTXT" dataPreview:type="C" dataPreview:description="Company Name" dataPreview:keyAttribute="false" dataPreview:length="25" />
          <dataPreview:dataSet />
        </dataPreview:columns>
      </dataPreview:tableData>`;

    expect(parseTableStructure(xml, "T001")).toEqual({
      tableName: "T001",
      columns: [
        {
          name: "BUKRS",
          dataType: "C",
          length: 4,
          key: true,
          description: "Company Code",
        },
        {
          name: "BUTXT",
          dataType: "C",
          length: 25,
          key: false,
          description: "Company Name",
        },
      ],
    });
  });

  it("uses rowNumber for the cap and removes the validator-only UP TO suffix", () => {
    expect(
      toDataPreviewSql(
        "SELECT bukrs FROM t001 WHERE bukrs = '1000' UP TO 10 ROWS",
      ),
    ).toBe("SELECT bukrs FROM t001 WHERE bukrs = '1000'");
  });

  it("transposes on-premise Data Preview columns into rows", () => {
    const xml = `
      <dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">
        <dataPreview:columns>
          <dataPreview:metadata dataPreview:name="BUKRS" dataPreview:type="C" />
          <dataPreview:dataSet><dataPreview:data>1000</dataPreview:data><dataPreview:data>D002</dataPreview:data></dataPreview:dataSet>
        </dataPreview:columns>
        <dataPreview:columns>
          <dataPreview:metadata dataPreview:name="BUTXT" dataPreview:type="C" />
          <dataPreview:dataSet><dataPreview:data>Company One</dataPreview:data><dataPreview:data>Company Two</dataPreview:data></dataPreview:dataSet>
        </dataPreview:columns>
      </dataPreview:tableData>`;

    expect(parseDataPreview(xml)).toEqual({
      columns: ["BUKRS", "BUTXT"],
      rows: [
        { BUKRS: "1000", BUTXT: "Company One" },
        { BUKRS: "D002", BUTXT: "Company Two" },
      ],
    });
  });
});
