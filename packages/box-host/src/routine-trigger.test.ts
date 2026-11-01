import { describe, expect, test } from "bun:test";
import { gmailEventQuery, normalizeConnectorEventTrigger } from "./routine-trigger.ts";

describe("connector event triggers", () => {
  test("accepts gmail and calendar filters", () => {
    expect(
      normalizeConnectorEventTrigger({
        service: "gmail",
        sender: "ada@example.com",
        subject: "Invoice",
      }),
    ).toEqual({
      type: "connector_event",
      service: "gmail",
      sender: "ada@example.com",
      subject: "Invoice",
    });
    expect(
      normalizeConnectorEventTrigger({ service: "google-calendar", calendarId: "primary" }),
    ).toEqual({
      type: "connector_event",
      service: "google-calendar",
      calendarId: "primary",
    });
  });

  test("rejects unknown services, newlines, and unsafe calendar ids", () => {
    expect(normalizeConnectorEventTrigger({ service: "drive" })).toBeNull();
    expect(normalizeConnectorEventTrigger({ service: "gmail", query: "a\nb" })).toBeNull();
    expect(
      normalizeConnectorEventTrigger({ service: "google-calendar", calendarId: "../x" }),
    ).toBeNull();
  });

  test("builds a bounded Gmail query", () => {
    expect(gmailEventQuery({ sender: "Ada Lovelace", subject: "Status" })).toBe(
      'in:inbox newer_than:2d from:"Ada Lovelace" subject:Status',
    );
  });
});
