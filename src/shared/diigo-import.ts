import { createId } from "./id";
import { domainForUrl, normalizeUrl, pageIdForUrl } from "./page";
import type { AnnotationRecord } from "./types";

type ParsedBookmark = {
  url: string;
  title: string;
  tags: string[];
  note: string;
  createdAt: string;
};

type ParseResult = {
  records: AnnotationRecord[];
  skipped: number;
};

const ANCHOR_PATTERN = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const ATTR_PATTERN = /([a-z0-9_:-]+)\s*=\s*"([^"]*)"/gi;
const NOTE_PATTERN = /<dd[^>]*>([\s\S]*?)(?=<dt\b|$)/gi;
const WHITESPACE_PATTERN = /\s+/g;

export function parseDiigoChromeExport(
  html: string,
  now: () => string = () => new Date().toISOString()
): ParseResult {
  const noteByUrl = collectNotesByUrl(html);
  const records: AnnotationRecord[] = [];
  let skipped = 0;

  let anchorMatch = ANCHOR_PATTERN.exec(html);
  while (anchorMatch) {
    const attributes = parseAttributes(anchorMatch[1] ?? "");
    const href = attributes.href ? decodeHtmlEntities(attributes.href.trim()) : "";
    if (!isValidUrl(href)) {
      skipped += 1;
      anchorMatch = ANCHOR_PATTERN.exec(html);
      continue;
    }

    const titleText = normalizeText(stripHtml(anchorMatch[2] ?? ""));
    const title = titleText || href;
    const addDate = parseUnixSeconds(attributes.add_date);
    const createdAt = addDate ? addDate.toISOString() : now();
    const tags = parseTags(attributes.tags);
    const normalizedUrl = normalizeUrl(href);
    const note = noteByUrl.get(normalizedUrl) ?? "";
    const timestamp = now();

    const record: AnnotationRecord = {
      id: createId("rec"),
      kind: "page-note",
      pageId: pageIdForUrl(href),
      url: normalizedUrl,
      title,
      domain: domainForUrl(href),
      createdAt,
      updatedAt: timestamp,
      note,
      tags,
      collectionIds: [],
      review: { enabled: false },
      target: { type: "page" },
      sync: { status: "pending" }
    };
    records.push(record);
    anchorMatch = ANCHOR_PATTERN.exec(html);
  }

  return { records, skipped };
}

function collectNotesByUrl(html: string): Map<string, string> {
  const notes = new Map<string, string>();
  const lines = html.split(/\r?\n/);
  let currentUrl: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const anchorMatch = /<a\b([^>]*)>/i.exec(line);
    if (anchorMatch) {
      const attrs = parseAttributes(anchorMatch[1] ?? "");
      const href = attrs.href ? decodeHtmlEntities(attrs.href.trim()) : "";
      currentUrl = isValidUrl(href) ? normalizeUrl(href) : undefined;
      continue;
    }

    if (!currentUrl) {
      continue;
    }

    const noteMatch = /<dd[^>]*>([\s\S]*)/i.exec(line);
    if (!noteMatch) {
      continue;
    }

    let fragment = noteMatch[1] ?? "";
    while (index + 1 < lines.length && !/<dt\b/i.test(lines[index + 1] ?? "")) {
      index += 1;
      fragment += `\n${lines[index] ?? ""}`;
    }
    const note = normalizeText(stripHtml(fragment));
    if (note) {
      notes.set(currentUrl, note);
    }
  }

  if (notes.size > 0) {
    return notes;
  }

  // Fallback for compact exports where line-based parsing misses nested structures.
  const fallback = new Map<string, string>();
  let noteMatch = NOTE_PATTERN.exec(html);
  while (noteMatch) {
    const before = html.slice(0, noteMatch.index);
    const previousAnchor = before.match(/<a\b([^>]*)>([\s\S]*?)<\/a>\s*$/i);
    if (previousAnchor) {
      const attrs = parseAttributes(previousAnchor[1] ?? "");
      const href = attrs.href ? decodeHtmlEntities(attrs.href.trim()) : "";
      if (isValidUrl(href)) {
        const note = normalizeText(stripHtml(noteMatch[1] ?? ""));
        if (note) {
          fallback.set(normalizeUrl(href), note);
        }
      }
    }
    noteMatch = NOTE_PATTERN.exec(html);
  }
  return fallback;
}

function parseAttributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  let match = ATTR_PATTERN.exec(raw);
  while (match) {
    const key = (match[1] ?? "").toLowerCase();
    const value = decodeHtmlEntities(match[2] ?? "");
    if (key) {
      result[key] = value;
    }
    match = ATTR_PATTERN.exec(raw);
  }
  ATTR_PATTERN.lastIndex = 0;
  return result;
}

function parseTags(rawTags: string | undefined): string[] {
  if (!rawTags) {
    return [];
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of rawTags.split(",")) {
    const tag = normalizeText(part);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function parseUnixSeconds(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return new Date(seconds * 1000);
}

function normalizeText(text: string): string {
  return decodeHtmlEntities(text).replace(WHITESPACE_PATTERN, " ").trim();
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, " ");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
