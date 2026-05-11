import { describe, expect, it } from "bun:test";
import { parseDiigoChromeExport } from "../src/shared/diigo-import";

describe("parseDiigoChromeExport", () => {
  it("parses Diigo Chrome format bookmarks into page-note records", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><A HREF="https://example.com/article?id=1#frag" ADD_DATE="1715539200" TAGS="research,ai,ai">Interesting Article</A>
  <DD>Read later with key points.
  <DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1715539300">Hacker News</A>
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
      target: { type: "page" },
      sync: { status: "pending" }
    });
    expect(records[0]?.createdAt).toBe("2024-05-12T18:40:00.000Z");

    expect(records[1]).toMatchObject({
      kind: "page-note",
      url: "https://news.ycombinator.com/",
      title: "Hacker News",
      tags: [],
      note: "",
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
  });
});
