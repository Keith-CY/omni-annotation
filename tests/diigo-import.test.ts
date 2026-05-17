import { describe, expect, it } from "bun:test";
import {
  extractDiigoImportTextFromZipBytes,
  parseDiigoChromeExport,
  parseDiigoCsvExport,
  parseDiigoImportText,
  readDiigoImportText
} from "../src/shared/diigo-import";

describe("parseDiigoChromeExport", () => {
  it("parses Diigo Chrome format bookmarks into page-note records", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><A HREF="https://example.com/article?id=1#frag" ADD_DATE="1715539200" PRIVATE="1" TAGS="research,ai,ai">Interesting Article</A>
  <DD>Read later with key points.
  <DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1715539300" PRIVATE="0">Hacker News</A>
</DL><p>`;

    const { records, skipped } = parseDiigoChromeExport(html, () => "2026-05-12T00:00:00.000Z");

    expect(skipped).toBe(0);
    expect(records).toHaveLength(2);

    expect(records[0]).toMatchObject({
      kind: "page-note",
      url: "https://example.com/article?id=1",
      title: "Interesting Article",
      tags: ["research", "ai"],
      note: "Read later with key points.",
      source: {
        provider: "diigo",
        visibility: "private",
        rawTags: "research,ai,ai"
      },
      target: { type: "page" },
      sync: { status: "pending" }
    });
    expect(records[0]?.createdAt).toBe("2024-05-12T18:40:00.000Z");
    expect(records[0]?.source?.addedAt).toBe("2024-05-12T18:40:00.000Z");
    expect(records[0]?.source?.lastVisitAt).toBeUndefined();
    expect(records[0]?.source?.externalId).toBe(
      "https://example.com/article?id=1::Interesting Article::1715539200"
    );

    expect(records[1]).toMatchObject({
      kind: "page-note",
      url: "https://news.ycombinator.com/",
      title: "Hacker News",
      tags: [],
      note: "",
      source: {
        provider: "diigo",
        visibility: "public"
      },
      target: { type: "page" }
    });
  });

  it("skips invalid URLs and falls back createdAt when add_date is missing", () => {
    const html = `<DL><p>
      <DT><A HREF="javascript:void(0)">Invalid</A>
      <DT><A HREF="https://valid.example/path">Valid</A>
    </DL>`;
    const fallbackNow = "2026-05-12T01:02:03.000Z";

    const { records, skipped } = parseDiigoChromeExport(html, () => fallbackNow);

    expect(skipped).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0]?.createdAt).toBe(fallbackNow);
    expect(records[0]?.title).toBe("Valid");
    expect(records[0]?.source?.externalId).toBe("https://valid.example/path::Valid::0");
  });

  it("keeps multiple records for same url+title when add_date differs", () => {
    const html = `<DL><p>
      <DT><A HREF="https://typeorm.io/" ADD_DATE="1700000000" PRIVATE="1" TAGS="no_tag">TypeORM</A>
      <DT><A HREF="https://typeorm.io/" ADD_DATE="1700001234" PRIVATE="1" TAGS="no_tag">TypeORM</A>
    </DL>`;

    const { records, skipped } = parseDiigoChromeExport(html, () => "2026-05-12T01:02:03.000Z");

    expect(skipped).toBe(0);
    expect(records).toHaveLength(2);
    expect(records[0]?.source?.externalId).toBe("https://typeorm.io/::TypeORM::1700000000");
    expect(records[1]?.source?.externalId).toBe("https://typeorm.io/::TypeORM::1700001234");
    expect(records[0]?.source?.externalId).not.toBe(records[1]?.source?.externalId);
  });
});

describe("readDiigoImportText", () => {
  it("reads non-zip files as plain text", async () => {
    const file = new File(["<DL><p><DT><A HREF=\"https://example.com/\">Example</A></DL>"], "diigo.html", {
      type: "text/html"
    });
    const text = await readDiigoImportText(file);
    expect(text).toContain("https://example.com/");
  });
});

describe("extractDiigoImportTextFromZipBytes", () => {
  it("extracts html text from a stored zip entry", async () => {
    const html = "<DL><p><DT><A HREF=\"https://example.com/\">Example</A></DL>";
    const zip = makeStoredZip("diigo-export/bookmarks.html", html);

    const extracted = await extractDiigoImportTextFromZipBytes(zip);

    expect(extracted.entryName).toBe("diigo-export/bookmarks.html");
    expect(extracted.text).toBe(html);
  });

  it("extracts csv text from a stored zip entry", async () => {
    const csv = "title,url,tags,description,comments,annotations,created_at\nExample,https://example.com,no_tag,,,Highlight:Quote,2026-05-12 00:00:00\n";
    const zip = makeStoredZip("diigo-export/bookmarks.csv", csv);

    const extracted = await extractDiigoImportTextFromZipBytes(zip);

    expect(extracted.entryName).toBe("diigo-export/bookmarks.csv");
    expect(extracted.text).toBe(csv);
  });

  it("throws when zip does not contain supported import entries", async () => {
    const zip = makeStoredZip("diigo-export/bookmarks.txt", "plain text");

    await expect(extractDiigoImportTextFromZipBytes(zip)).rejects.toThrow(
      "ZIP does not contain a supported Diigo export file (.html/.htm/.csv)."
    );
  });
});

describe("parseDiigoCsvExport", () => {
  it("creates text records from Highlight blocks for fallback quote matching", () => {
    const csv = [
      "title,url,tags,description,comments,annotations,created_at",
      '"Example Article","https://example.com/a","tag-one,tag-two","","","Highlight:Alpha quote\\nHighlight:<p>Beta <strong>quote</strong></p>","2026-05-11 12:30:00"'
    ].join("\n");

    const { records, skipped } = parseDiigoCsvExport(csv, () => "2026-05-12T00:00:00.000Z");

    expect(skipped).toBe(0);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      kind: "text",
      url: "https://example.com/a",
      tags: ["tag-one", "tag-two"],
      target: {
        type: "text",
        quote: "Alpha quote",
        prefix: "",
        suffix: "Beta quote",
        locatorConfidence: "context"
      },
      source: {
        provider: "diigo",
        rawTags: "tag-one,tag-two"
      }
    });
    expect(records[0]?.source?.externalId).toContain("::hl:0");
    if (records[0]?.target.type === "text") {
      expect(records[0].target.suffix.length).toBeGreaterThan(0);
    }
    expect(records[1]?.target.type).toBe("text");
    if (records[1]?.target.type === "text") {
      expect(records[1].target.quote).toBe("Beta quote");
      expect(records[1].target.prefix.length).toBeGreaterThan(0);
    }
  });

  it("creates a page-note fallback record when no highlights exist", () => {
    const csv = [
      "title,url,tags,description,comments,annotations,created_at",
      '"Example Page","https://example.com/page","no_tag","desc","comment","","2026-05-11 12:30:00"'
    ].join("\n");

    const { records, skipped } = parseDiigoCsvExport(csv, () => "2026-05-12T00:00:00.000Z");

    expect(skipped).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "page-note",
      url: "https://example.com/page",
      tags: [],
      note: "desc\ncomment",
      target: { type: "page" }
    });
    expect(records[0]?.source?.externalId).toContain("::page-note");
  });
});

describe("parseDiigoImportText", () => {
  it("auto-detects csv by header", () => {
    const csv = [
      "title,url,tags,description,comments,annotations,created_at",
      '"Example","https://example.com/nohash","no_tag","","","Highlight:sample","2026-05-11 12:30:00"'
    ].join("\n");
    const { records, skipped } = parseDiigoImportText(csv, () => "2026-05-12T00:00:00.000Z");

    expect(skipped).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]?.kind).toBe("text");
  });
});

function makeStoredZip(entryName: string, text: string): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(entryName);
  const dataBytes = encoder.encode(text);

  const localHeader = new Uint8Array(30 + nameBytes.length);
  const localView = new DataView(localHeader.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, 0, true);
  localView.setUint16(8, 0, true);
  localView.setUint16(10, 0, true);
  localView.setUint16(12, 0, true);
  localView.setUint32(14, 0, true);
  localView.setUint32(18, dataBytes.length, true);
  localView.setUint32(22, dataBytes.length, true);
  localView.setUint16(26, nameBytes.length, true);
  localView.setUint16(28, 0, true);
  localHeader.set(nameBytes, 30);

  const localEntry = concatBytes(localHeader, dataBytes);
  const centralDirectoryOffset = localEntry.length;

  const centralHeader = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(centralHeader.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, 0, true);
  centralView.setUint16(10, 0, true);
  centralView.setUint16(12, 0, true);
  centralView.setUint16(14, 0, true);
  centralView.setUint32(16, 0, true);
  centralView.setUint32(20, dataBytes.length, true);
  centralView.setUint32(24, dataBytes.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint16(30, 0, true);
  centralView.setUint16(32, 0, true);
  centralView.setUint16(34, 0, true);
  centralView.setUint16(36, 0, true);
  centralView.setUint32(38, 0, true);
  centralView.setUint32(42, 0, true);
  centralHeader.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, centralHeader.length, true);
  eocdView.setUint32(16, centralDirectoryOffset, true);
  eocdView.setUint16(20, 0, true);

  return concatBytes(localEntry, centralHeader, eocd);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}
