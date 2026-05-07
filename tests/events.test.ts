import { describe, expect, it } from "bun:test";
import { applyRecordEvent, parseEventLine, serializeEvent, type RecordEvent } from "../src/shared/events";
import { domainForUrl, normalizeUrl, pageIdForUrl } from "../src/shared/page";
import type { AnnotationRecord } from "../src/shared/types";

const baseRecord: AnnotationRecord = {
  id: "rec_1",
  kind: "text",
  pageId: "page_1",
  url: "https://example.com/a",
  title: "Example",
  domain: "example.com",
  createdAt: "2026-05-07T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z",
  color: "yellow",
  note: "",
  tags: [],
  collectionIds: [],
  review: { enabled: false },
  target: {
    type: "text",
    quote: "hello world",
    prefix: "",
    suffix: "",
    locatorConfidence: "exact"
  },
  sync: { status: "pending" }
};

describe("applyRecordEvent", () => {
  it("creates and updates records by id without mutating the previous map", () => {
    const initial = new Map<string, AnnotationRecord>();
    const created = applyRecordEvent(initial, {
      type: "record.created",
      record: baseRecord
    });

    const updated = applyRecordEvent(created, {
      type: "record.updated",
      id: "rec_1",
      updatedAt: "2026-05-07T00:01:00.000Z",
      patch: { note: "important", tags: ["research"] }
    });

    expect(initial.size).toBe(0);
    expect(created.get("rec_1")?.note).toBe("");
    expect(updated.get("rec_1")?.note).toBe("important");
    expect(updated.get("rec_1")?.tags).toEqual(["research"]);
    expect(updated.get("rec_1")?.updatedAt).toBe("2026-05-07T00:01:00.000Z");
  });

  it("ignores updates for missing records", () => {
    const records = new Map<string, AnnotationRecord>();
    const updated = applyRecordEvent(records, {
      type: "record.updated",
      id: "missing",
      updatedAt: "2026-05-07T00:01:00.000Z",
      patch: { note: "ignored" }
    });

    expect(updated).not.toBe(records);
    expect(updated.size).toBe(0);
  });

  it("deletes records by id", () => {
    const records = new Map([["rec_1", baseRecord]]);
    const deleted = applyRecordEvent(records, {
      type: "record.deleted",
      id: "rec_1",
      updatedAt: "2026-05-07T00:02:00.000Z"
    });

    expect(records.has("rec_1")).toBe(true);
    expect(deleted.has("rec_1")).toBe(false);
  });
});

describe("event serialization", () => {
  it("serializes with a trailing newline and parses events with a type", () => {
    const event: RecordEvent = {
      type: "record.created",
      record: baseRecord
    };

    const serialized = serializeEvent(event);

    expect(serialized.endsWith("\n")).toBe(true);
    expect(parseEventLine(serialized)).toEqual(event);
  });

  it("throws when the parsed line has no type", () => {
    expect(() => parseEventLine(JSON.stringify({ id: "rec_1" }))).toThrow("missing type");
  });

  it("throws on unknown event types", () => {
    expect(() => parseEventLine(JSON.stringify({ type: "record.archived", id: "rec_1" }))).toThrow(
      "unknown event type"
    );
  });

  it("throws when record.created is missing a record with an id", () => {
    expect(() => parseEventLine(JSON.stringify({ type: "record.created" }))).toThrow("invalid event");
    expect(() => parseEventLine(JSON.stringify({ type: "record.created", record: {} }))).toThrow(
      "invalid event"
    );
  });

  it("throws when record.updated is missing required fields", () => {
    expect(() =>
      parseEventLine(
        JSON.stringify({
          type: "record.updated",
          updatedAt: "2026-05-07T00:01:00.000Z",
          patch: {}
        })
      )
    ).toThrow("invalid event");
    expect(() =>
      parseEventLine(JSON.stringify({ type: "record.updated", id: "rec_1", patch: {} }))
    ).toThrow("invalid event");
    expect(() =>
      parseEventLine(
        JSON.stringify({
          type: "record.updated",
          id: "rec_1",
          updatedAt: "2026-05-07T00:01:00.000Z"
        })
      )
    ).toThrow("invalid event");
  });

  it("throws when record.deleted is missing required fields", () => {
    expect(() =>
      parseEventLine(JSON.stringify({ type: "record.deleted", updatedAt: "2026-05-07T00:02:00.000Z" }))
    ).toThrow("invalid event");
    expect(() => parseEventLine(JSON.stringify({ type: "record.deleted", id: "rec_1" }))).toThrow(
      "invalid event"
    );
  });
});

describe("page helpers", () => {
  it("normalizes URLs by removing hash fragments", () => {
    expect(normalizeUrl("https://example.com/path?q=1#section")).toBe("https://example.com/path?q=1");
  });

  it("extracts domains and creates stable page ids from normalized URLs", () => {
    expect(domainForUrl("https://docs.example.com/path#intro")).toBe("docs.example.com");
    expect(pageIdForUrl("https://docs.example.com/path#intro")).toBe(
      pageIdForUrl("https://docs.example.com/path")
    );
    expect(pageIdForUrl("https://docs.example.com/path")).toStartWith("page_docs.example.com_");
  });
});
