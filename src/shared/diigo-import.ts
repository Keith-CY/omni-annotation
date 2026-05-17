import { createId } from "./id";
import { domainForUrl, normalizeUrl, pageIdForUrl } from "./page";
import type { AnnotationRecord, AnnotationSource } from "./types";

type ParseResult = {
  records: AnnotationRecord[];
  skipped: number;
};

const ANCHOR_PATTERN = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const ATTR_PATTERN = /([a-z0-9_:-]+)\s*=\s*"([^"]*)"/gi;
const NOTE_PATTERN = /<dd[^>]*>([\s\S]*?)(?=<dt\b|$)/gi;
const WHITESPACE_PATTERN = /\s+/g;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_UTF8_FLAG = 1 << 11;
const MAX_EOCD_SCAN = 0xffff + 22;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const DIIGO_CSV_HEADER = "title,url,tags,description,comments,annotations,created_at";
const CONTEXT_WINDOW = 48;

export async function readDiigoImportText(file: File): Promise<string> {
  if (!isZipFilename(file.name)) {
    return file.text();
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const extracted = await extractDiigoImportTextFromZipBytes(bytes);
  return extracted.text;
}

export async function extractDiigoImportTextFromZipBytes(
  bytes: Uint8Array
): Promise<{ entryName: string; text: string }> {
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocdOffset(dataView);
  const entryCount = dataView.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = dataView.getUint32(eocdOffset + 16, true);
  const centralDirectorySize = dataView.getUint32(eocdOffset + 12, true);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  if (centralDirectoryEnd > bytes.byteLength) {
    throw new Error("Invalid ZIP: central directory exceeds file size.");
  }

  let position = centralDirectoryOffset;
  const htmlEntries: Array<{
    name: string;
    localHeaderOffset: number;
    compressionMethod: number;
    compressedSize: number;
    flags: number;
  }> = [];

  for (let index = 0; index < entryCount && position + 46 <= centralDirectoryEnd; index += 1) {
    if (dataView.getUint32(position, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid ZIP: central directory header signature mismatch.");
    }

    const flags = dataView.getUint16(position + 8, true);
    const compressionMethod = dataView.getUint16(position + 10, true);
    const compressedSize = dataView.getUint32(position + 20, true);
    const filenameLength = dataView.getUint16(position + 28, true);
    const extraLength = dataView.getUint16(position + 30, true);
    const commentLength = dataView.getUint16(position + 32, true);
    const localHeaderOffset = dataView.getUint32(position + 42, true);
    const filenameStart = position + 46;
    const filenameEnd = filenameStart + filenameLength;

    if (filenameEnd > bytes.byteLength) {
      throw new Error("Invalid ZIP: filename out of bounds.");
    }

    const name = decodeFilename(bytes.subarray(filenameStart, filenameEnd), flags);
    if (isSupportedZipImportEntry(name)) {
      htmlEntries.push({
        name,
        localHeaderOffset,
        compressionMethod,
        compressedSize,
        flags
      });
    }

    position = filenameEnd + extraLength + commentLength;
  }

  if (htmlEntries.length === 0) {
    throw new Error("ZIP does not contain a supported Diigo export file (.html/.htm/.csv).");
  }

  const candidate = htmlEntries[0] as (typeof htmlEntries)[number];
  const compressed = readLocalFileCompressedData(dataView, bytes, candidate.localHeaderOffset, candidate.compressedSize);
  let raw: Uint8Array;
  if (candidate.compressionMethod === ZIP_METHOD_STORE) {
    raw = compressed;
  } else if (candidate.compressionMethod === ZIP_METHOD_DEFLATE) {
    raw = await inflateDeflateRaw(compressed);
  } else {
    throw new Error(`Unsupported ZIP compression method: ${candidate.compressionMethod}.`);
  }

  return {
    entryName: candidate.name,
    text: new TextDecoder("utf-8").decode(raw)
  };
}

export function parseDiigoImportText(
  text: string,
  now: () => string = () => new Date().toISOString()
): ParseResult {
  return isDiigoCsvText(text) ? parseDiigoCsvExport(text, now) : parseDiigoChromeExport(text, now);
}

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
    const lastVisit = parseUnixSeconds(attributes.last_visit);
    const createdAt = addDate ? addDate.toISOString() : now();
    const tags = parseTags(attributes.tags);
    const normalizedUrl = normalizeUrl(href);
    const note = noteByUrl.get(normalizedUrl) ?? "";
    const timestamp = now();
    const source = buildDiigoSource(attributes, normalizedUrl, title);

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
      sync: { status: "pending" },
      ...(source ? { source } : {})
    };
    if (lastVisit && (!source || !source.lastVisitAt)) {
      record.source = {
        ...(record.source ?? {
          provider: "diigo",
          externalId: diigoExternalId(normalizedUrl, title, attributes.add_date ?? "0")
        }),
        lastVisitAt: lastVisit.toISOString()
      };
    }
    records.push(record);
    anchorMatch = ANCHOR_PATTERN.exec(html);
  }

  return { records, skipped };
}

export function parseDiigoCsvExport(
  csv: string,
  now: () => string = () => new Date().toISOString()
): ParseResult {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) {
    return { records: [], skipped: 0 };
  }

  const header = rows[0]?.map((field) => field.trim().toLowerCase()) ?? [];
  const headerIndex = createHeaderIndex(header);
  const required = ["title", "url", "tags", "description", "comments", "annotations", "created_at"];
  const hasRequired = required.every((column) => headerIndex.has(column));
  if (!hasRequired) {
    throw new Error("Invalid Diigo CSV format: missing required columns.");
  }

  const records: AnnotationRecord[] = [];
  let skipped = 0;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const urlRaw = csvField(row, headerIndex, "url");
    const href = decodeHtmlEntities(urlRaw.trim());
    if (!isValidUrl(href)) {
      skipped += 1;
      continue;
    }

    const normalizedUrl = normalizeUrl(href);
    const titleRaw = csvField(row, headerIndex, "title");
    const title = normalizeText(titleRaw) || normalizedUrl;
    const tagsRaw = csvField(row, headerIndex, "tags");
    const tags = parseCsvTags(tagsRaw);
    const createdRaw = csvField(row, headerIndex, "created_at");
    const createdAt = parseDiigoCsvDate(createdRaw) ?? now();
    const sourceBase = buildDiigoCsvSourceBase(normalizedUrl, title, tagsRaw, createdRaw);
    const rowNote = composeCsvRowNote(
      csvField(row, headerIndex, "description"),
      csvField(row, headerIndex, "comments"),
      extractAnnotationStickyNotes(csvField(row, headerIndex, "annotations"))
    );

    const highlights = extractAnnotationHighlights(csvField(row, headerIndex, "annotations"));
    const highlightTargets = withFallbackContexts(highlights);
    if (highlightTargets.length === 0) {
      const timestamp = now();
      records.push({
        id: createId("rec"),
        kind: "page-note",
        pageId: pageIdForUrl(href),
        url: normalizedUrl,
        title,
        domain: domainForUrl(href),
        createdAt,
        updatedAt: timestamp,
        note: rowNote,
        tags,
        collectionIds: [],
        review: { enabled: false },
        target: { type: "page" },
        sync: { status: "pending" },
        source: {
          ...sourceBase,
          externalId: `${sourceBase.externalId}::page-note`
        }
      });
      continue;
    }

    for (let highlightIndex = 0; highlightIndex < highlightTargets.length; highlightIndex += 1) {
      const highlight = highlightTargets[highlightIndex];
      const quote = highlight?.quote ?? "";
      if (!quote) {
        continue;
      }

      const timestamp = now();
      records.push({
        id: createId("rec"),
        kind: "text",
        pageId: pageIdForUrl(href),
        url: normalizedUrl,
        title,
        domain: domainForUrl(href),
        createdAt,
        updatedAt: timestamp,
        color: "yellow",
        note: rowNote,
        tags,
        collectionIds: [],
        review: { enabled: false },
        target: {
          type: "text",
          quote,
          prefix: highlight?.prefix ?? "",
          suffix: highlight?.suffix ?? "",
          locatorConfidence: "context"
        },
        sync: { status: "pending" },
        source: {
          ...sourceBase,
          externalId: `${sourceBase.externalId}::hl:${highlightIndex}`
        }
      });
    }
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

function parseCsvTags(rawTags: string | undefined): string[] {
  const normalized = normalizeText(rawTags ?? "");
  if (!normalized || normalized.toLowerCase() === "no_tag") {
    return [];
  }
  return parseTags(normalized);
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

function parseDiigoCsvDate(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function buildDiigoSource(
  attributes: Record<string, string>,
  normalizedUrl: string,
  title: string
): AnnotationSource | undefined {
  const addDate = parseUnixSeconds(attributes.add_date);
  const lastVisit = parseUnixSeconds(attributes.last_visit);
  const visibility =
    attributes.private === "1" ? "private" : attributes.private === "0" ? "public" : undefined;
  const rawTags = attributes.tags && attributes.tags !== "no_tag" ? attributes.tags : undefined;
  const externalId = diigoExternalId(normalizedUrl, title, attributes.add_date ?? "0");

  if (!addDate && !lastVisit && !visibility && !rawTags && !externalId) {
    return undefined;
  }

  return {
    provider: "diigo",
    externalId,
    ...(visibility ? { visibility } : {}),
    ...(addDate ? { addedAt: addDate.toISOString() } : {}),
    ...(lastVisit ? { lastVisitAt: lastVisit.toISOString() } : {}),
    ...(rawTags ? { rawTags } : {})
  };
}

function buildDiigoCsvSourceBase(
  normalizedUrl: string,
  title: string,
  rawTags: string,
  createdRaw: string
): AnnotationSource {
  const addedAt = parseDiigoCsvDate(createdRaw);
  return {
    provider: "diigo",
    externalId: `${normalizedUrl}::${title}::csv:${createdRaw || "0"}`,
    ...(addedAt ? { addedAt } : {}),
    ...(rawTags && rawTags.trim() && rawTags.trim().toLowerCase() !== "no_tag"
      ? { rawTags: rawTags.trim() }
      : {})
  };
}

function diigoExternalId(normalizedUrl: string, title: string, addDateRaw: string): string {
  return `${normalizedUrl}::${title}::${addDateRaw || "0"}`;
}

function composeCsvRowNote(description: string, comments: string, stickyNotes: string[]): string {
  const parts = [normalizeText(stripHtml(description)), normalizeText(stripHtml(comments)), ...stickyNotes]
    .map((part) => normalizeText(part))
    .filter(Boolean);

  return parts.join("\n");
}

function extractAnnotationHighlights(rawAnnotations: string): string[] {
  const sections = splitAnnotationSections(rawAnnotations);
  const highlights: string[] = [];

  for (const section of sections) {
    if (section.kind !== "highlight") {
      continue;
    }
    const quote = normalizeText(stripHtml(section.value.replace(/\\n/g, "\n")));
    if (quote) {
      highlights.push(quote);
    }
  }

  return highlights;
}

function withFallbackContexts(
  highlights: string[]
): Array<{ quote: string; prefix: string; suffix: string }> {
  if (highlights.length === 0) {
    return [];
  }

  return highlights.map((quote, index) => {
    const previous = normalizeText(highlights.slice(Math.max(0, index - 2), index).join(" "));
    const next = normalizeText(highlights.slice(index + 1, Math.min(highlights.length, index + 3)).join(" "));
    return {
      quote,
      prefix: previous ? previous.slice(Math.max(0, previous.length - CONTEXT_WINDOW)) : "",
      suffix: next ? next.slice(0, CONTEXT_WINDOW) : ""
    };
  });
}

function extractAnnotationStickyNotes(rawAnnotations: string): string[] {
  const sections = splitAnnotationSections(rawAnnotations);
  const notes: string[] = [];

  for (const section of sections) {
    if (section.kind !== "sticky") {
      continue;
    }
    const note = normalizeText(stripHtml(section.value));
    if (note) {
      notes.push(note);
    }
  }

  return notes;
}

function splitAnnotationSections(rawAnnotations: string): Array<{ kind: "highlight" | "sticky"; value: string }> {
  if (!rawAnnotations.trim()) {
    return [];
  }

  const tokenPattern = /(Highlight:|Sticky notes?:)/gi;
  const markers: Array<{ kind: "highlight" | "sticky"; start: number; contentStart: number }> = [];
  let match = tokenPattern.exec(rawAnnotations);

  while (match) {
    const token = (match[1] ?? "").toLowerCase();
    const kind: "highlight" | "sticky" = token.startsWith("sticky") ? "sticky" : "highlight";
    markers.push({
      kind,
      start: match.index,
      contentStart: tokenPattern.lastIndex
    });
    match = tokenPattern.exec(rawAnnotations);
  }

  if (markers.length === 0) {
    return [];
  }

  const sections: Array<{ kind: "highlight" | "sticky"; value: string }> = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    if (!marker) {
      continue;
    }
    const nextStart = markers[index + 1]?.start ?? rawAnnotations.length;
    const value = rawAnnotations.slice(marker.contentStart, nextStart).trim();
    if (!value) {
      continue;
    }
    sections.push({ kind: marker.kind, value });
  }

  return sections;
}

function isDiigoCsvText(text: string): boolean {
  const firstLine = text.replace(/^\ufeff/, "").split(/\r?\n/, 1)[0] ?? "";
  return firstLine.trim().toLowerCase() === DIIGO_CSV_HEADER;
}

function createHeaderIndex(header: string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((column, offset) => {
    if (column) {
      index.set(column, offset);
    }
  });
  return index;
}

function csvField(row: string[], headerIndex: Map<string, number>, column: string): string {
  const offset = headerIndex.get(column);
  return offset === undefined ? "" : row[offset] ?? "";
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.length > 1 || row[0]?.trim()) {
    rows.push(row);
  }

  return rows;
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

function isZipFilename(name: string): boolean {
  return name.toLowerCase().endsWith(".zip");
}

function isSupportedZipImportEntry(path: string): boolean {
  if (!path || path.endsWith("/")) {
    return false;
  }
  if (path.startsWith("__MACOSX/")) {
    return false;
  }
  const lower = path.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".csv");
}

function findEocdOffset(dataView: DataView): number {
  const minimumEocdSize = 22;
  if (dataView.byteLength < minimumEocdSize) {
    throw new Error("Invalid ZIP: file is too small.");
  }

  const start = Math.max(0, dataView.byteLength - MAX_EOCD_SCAN);
  for (let offset = dataView.byteLength - minimumEocdSize; offset >= start; offset -= 1) {
    if (dataView.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("Invalid ZIP: end of central directory not found.");
}

function decodeFilename(bytes: Uint8Array, flags: number): string {
  const utf8 = (flags & ZIP_UTF8_FLAG) !== 0;
  const decoder = new TextDecoder(utf8 ? "utf-8" : "utf-8", { fatal: false });
  return decoder.decode(bytes);
}

function readLocalFileCompressedData(
  dataView: DataView,
  bytes: Uint8Array,
  localHeaderOffset: number,
  compressedSize: number
): Uint8Array {
  if (localHeaderOffset + 30 > dataView.byteLength) {
    throw new Error("Invalid ZIP: local file header out of bounds.");
  }
  if (dataView.getUint32(localHeaderOffset, true) !== LOCAL_FILE_SIGNATURE) {
    throw new Error("Invalid ZIP: local file header signature mismatch.");
  }

  const filenameLength = dataView.getUint16(localHeaderOffset + 26, true);
  const extraLength = dataView.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + filenameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > bytes.byteLength) {
    throw new Error("Invalid ZIP: compressed entry exceeds file size.");
  }
  return bytes.subarray(dataStart, dataEnd);
}

async function inflateDeflateRaw(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser does not support ZIP deflate decompression.");
  }
  const blobInput = new Uint8Array(input);
  const stream = new Blob([blobInput]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}
