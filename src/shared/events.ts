import type { AnnotationRecord } from "./types";

export type RecordUpdatePatch = Partial<
  Pick<AnnotationRecord, "color" | "note" | "tags" | "collectionIds" | "review" | "sync">
>;

export type RecordEvent =
  | { type: "record.created"; record: AnnotationRecord }
  | {
      type: "record.updated";
      id: string;
      updatedAt: string;
      patch: RecordUpdatePatch;
    }
  | { type: "record.deleted"; id: string; updatedAt: string };

export function applyRecordEvent(
  records: Map<string, AnnotationRecord>,
  event: RecordEvent
): Map<string, AnnotationRecord> {
  const next = new Map(records);

  switch (event.type) {
    case "record.created":
      next.set(event.record.id, event.record);
      return next;
    case "record.updated": {
      const current = next.get(event.id);
      if (!current) {
        return next;
      }

      next.set(event.id, { ...current, ...event.patch, updatedAt: event.updatedAt });
      return next;
    }
    case "record.deleted":
      next.delete(event.id);
      return next;
  }
}

export function serializeEvent(event: RecordEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseEventLine(line: string): RecordEvent {
  const parsed = JSON.parse(line) as unknown;

  if (!isObject(parsed) || typeof parsed.type !== "string") {
    throw new Error("Invalid event line: missing type");
  }

  switch (parsed.type) {
    case "record.created":
      if (!isObject(parsed.record) || typeof parsed.record.id !== "string") {
        throw new Error("Invalid event line: invalid event");
      }
      return parsed as RecordEvent;
    case "record.updated":
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.updatedAt !== "string" ||
        !isObject(parsed.patch)
      ) {
        throw new Error("Invalid event line: invalid event");
      }
      return parsed as RecordEvent;
    case "record.deleted":
      if (typeof parsed.id !== "string" || typeof parsed.updatedAt !== "string") {
        throw new Error("Invalid event line: invalid event");
      }
      return parsed as RecordEvent;
    default:
      throw new Error(`Invalid event line: unknown event type ${parsed.type}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
