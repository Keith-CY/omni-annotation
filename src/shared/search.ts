import type { AnnotationRecord } from "./types";

export function searchRecords(records: AnnotationRecord[], query: string): AnnotationRecord[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return records;
  }

  return records.filter((record) => {
    const haystack = tokenize(recordToSearchText(record));
    return tokens.every((token) => haystack.some((candidate) => candidate.includes(token)));
  });
}

function recordToSearchText(record: AnnotationRecord): string {
  return [
    record.title,
    record.url,
    record.domain,
    record.note,
    record.tags.join(" "),
    targetSearchText(record)
  ].join(" ");
}

function targetSearchText(record: AnnotationRecord): string {
  switch (record.target.type) {
    case "text":
      return record.target.quote;
    case "image":
      return [record.target.sourceUrl, record.target.altText ?? "", record.target.assetPath ?? ""].join(" ");
    case "screenshot":
      return record.target.assetPath;
    case "page":
      return "";
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}
