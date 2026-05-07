import { describe, expect, it } from "bun:test";
import { searchRecords } from "../src/shared/search";
import type { AnnotationRecord } from "../src/shared/types";

const textRecord = {
  id: "rec_1",
  kind: "text",
  pageId: "page_1",
  url: "https://example.com/research",
  title: "Local research",
  domain: "example.com",
  createdAt: "2026-05-07T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z",
  color: "cyan",
  note: "browser library",
  tags: ["annotation", "review"],
  collectionIds: [],
  review: { enabled: false },
  target: {
    type: "text",
    quote: "iCloud sync",
    prefix: "",
    suffix: "",
    locatorConfidence: "exact"
  },
  sync: { status: "pending" }
} satisfies AnnotationRecord;

const imageRecord = {
  ...textRecord,
  id: "rec_2",
  kind: "image",
  title: "Architecture diagram",
  target: {
    type: "image",
    sourceUrl: "https://cdn.example.com/images/storage-flow.png",
    assetPath: "assets/images/storage-flow.png",
    altText: "IndexedDB adapter flow"
  },
  sync: { status: "local" }
} satisfies AnnotationRecord;

const screenshotRecord = {
  ...textRecord,
  id: "rec_3",
  kind: "screenshot",
  title: "Screenshot clip",
  target: {
    type: "screenshot",
    assetPath: "assets/screenshots/page-capture.png",
    viewportRect: { x: 0, y: 0, width: 640, height: 480 },
    devicePixelRatio: 2
  },
  sync: { status: "flushed", filePath: "data/events.jsonl" }
} satisfies AnnotationRecord;

describe("searchRecords", () => {
  it("matches title, note, quote, domain, and tags", () => {
    expect(searchRecords([textRecord], "local")).toEqual([textRecord]);
    expect(searchRecords([textRecord], "browser")).toEqual([textRecord]);
    expect(searchRecords([textRecord], "icloud")).toEqual([textRecord]);
    expect(searchRecords([textRecord], "example")).toEqual([textRecord]);
    expect(searchRecords([textRecord], "annotation")).toEqual([textRecord]);
    expect(searchRecords([textRecord], "missing")).toHaveLength(0);
  });

  it("matches image alt text, source URL, and asset path", () => {
    expect(searchRecords([imageRecord], "indexeddb")).toEqual([imageRecord]);
    expect(searchRecords([imageRecord], "storage-flow")).toEqual([imageRecord]);
    expect(searchRecords([imageRecord], "assets images")).toEqual([imageRecord]);
  });

  it("matches screenshot asset paths", () => {
    expect(searchRecords([screenshotRecord], "screenshots page-capture")).toEqual([screenshotRecord]);
  });
});
