import { describe, expect, it } from "vitest";
import {
  normalizeSapTimestamp,
  parseDumpFeed,
  parseGatewayErrorFeed,
  parseSystemMessageFeed,
  parseTransportList,
} from "../../src/adt/runtime-reader.js";

describe("runtime response parsing", () => {
  it("normalizes ABAP and ISO timestamps", () => {
    expect(normalizeSapTimestamp("20260809203045")).toBe("2026-08-09T20:30:45");
    expect(normalizeSapTimestamp("2026-08-09T20:30:45Z")).toBe(
      "2026-08-09T20:30:45.000Z",
    );
    expect(normalizeSapTimestamp("")).toBe("");
  });

  it("parses runtime dump Atom entries", () => {
    const xml = `
      <atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry>
          <atom:id>DUMP-1</atom:id>
          <atom:title>TIME_OUT</atom:title>
          <atom:updated>20260809203045</atom:updated>
          <atom:link href="adt://S4H/sap/bc/adt/runtime/dump/DUMP-1" />
          <atom:content>Program ZTEST exceeded runtime</atom:content>
          <atom:author><atom:name>DEVELOPER</atom:name></atom:author>
          <atom:category term="ABAP_RUNTIME_ERROR" />
        </atom:entry>
      </atom:feed>`;

    expect(parseDumpFeed(xml)).toEqual([
      {
        id: "DUMP-1",
        title: "TIME_OUT",
        updatedAt: "2026-08-09T20:30:45",
        uri: "adt://S4H/sap/bc/adt/runtime/dump/DUMP-1",
        summary: "Program ZTEST exceeded runtime",
        user: "DEVELOPER",
        category: "ABAP_RUNTIME_ERROR",
      },
    ]);
  });

  it("parses system messages and gateway errors", () => {
    const messages = `
      <atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:sm="urn:sap:sm">
        <atom:entry>
          <atom:id>MSG-1</atom:id><atom:title>Maintenance</atom:title>
          <atom:content>System restarts tonight</atom:content>
          <sm:severity>WARNING</sm:severity>
          <sm:validFrom>20260809210000</sm:validFrom>
          <sm:validTo>20260809230000</sm:validTo>
          <atom:author><atom:name>BASIS</atom:name></atom:author>
        </atom:entry>
      </atom:feed>`;
    expect(parseSystemMessageFeed(messages)).toEqual([
      {
        id: "MSG-1",
        title: "Maintenance",
        text: "System restarts tonight",
        severity: "WARNING",
        validFrom: "2026-08-09T21:00:00",
        validTo: "2026-08-09T23:00:00",
        createdBy: "BASIS",
      },
    ]);

    const gateway = `
      <atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:gw="urn:sap:gw">
        <atom:entry>
          <atom:id>ABC123</atom:id><atom:title>HTTP 500</atom:title>
          <atom:updated>20260809203045</atom:updated>
          <atom:category term="Backend Error" />
          <gw:package>ZGW</gw:package><gw:applicationComponent>BC-ESI-ESF-GW</gw:applicationComponent>
          <gw:client>400</gw:client><gw:requestKind>OData</gw:requestKind>
          <atom:author><atom:name>DEVELOPER</atom:name></atom:author>
        </atom:entry>
      </atom:feed>`;
    expect(parseGatewayErrorFeed(gateway)).toEqual([
      {
        type: "Backend Error",
        shortText: "HTTP 500",
        transactionId: "ABC123",
        packageName: "ZGW",
        applicationComponent: "BC-ESI-ESF-GW",
        occurredAt: "2026-08-09T20:30:45",
        username: "DEVELOPER",
        client: "400",
        requestKind: "OData",
      },
    ]);
  });

  it("parses CTS transport requests", () => {
    const xml = `
      <cts:transportRequests xmlns:cts="urn:sap:cts">
        <cts:transportRequest cts:number="SAHK900001" cts:description="Fixture request" cts:owner="DEVELOPER" cts:status="D" cts:targetSystem="QAS" cts:type="K" cts:changedAt="20260809203045" />
      </cts:transportRequests>`;

    expect(parseTransportList(xml)).toEqual([
      {
        number: "SAHK900001",
        description: "Fixture request",
        owner: "DEVELOPER",
        status: "D",
        targetSystem: "QAS",
        type: "K",
        changedAt: "2026-08-09T20:30:45",
      },
    ]);
  });

  it("returns empty arrays for empty feeds", () => {
    expect(parseDumpFeed("<feed />")).toEqual([]);
    expect(parseSystemMessageFeed("<feed />")).toEqual([]);
    expect(parseGatewayErrorFeed("<feed />")).toEqual([]);
    expect(parseTransportList("<transportRequests />")).toEqual([]);
  });
});
