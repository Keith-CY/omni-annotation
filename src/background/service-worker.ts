import {
  EVENTS_FILE_PATH,
  flushAsset,
  flushEvent,
  flushPendingSync,
  flushPendingSyncFromStoredRoot
} from "./sync-engine";
import { createId } from "../shared/id";
import { createRecordStore, type StoredAsset } from "../shared/idb";
import { domainForUrl, normalizeUrl, pageIdForUrl } from "../shared/page";
import { nowIso } from "../shared/time";
import type {
  AnnotationColor,
  AnnotationRecord,
  ImageTarget,
  ScreenshotTarget,
  TextTarget
} from "../shared/types";

const COLORS: readonly AnnotationColor[] = ["yellow", "green", "pink", "purple", "cyan"];
const MAX_SCREENSHOT_DATA_URL_LENGTH = 20 * 1024 * 1024;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

type PagePayload = {
  url: string;
  canonicalUrl?: string;
  title: string;
};

type ScreenshotRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CreateFromSelectionMessage = {
  type: "record.create-from-selection";
  color: AnnotationColor;
  target: TextTarget;
  page: PagePayload;
};

type CreateFromImageMessage = {
  type: "record.create-from-image";
  sourceUrl: string;
  altText?: string;
  cssPath?: string;
  page: PagePayload;
};

type CreateFromScreenshotMessage = {
  type: "record.create-from-screenshot";
  croppedDataUrl: string;
  rect: ScreenshotRect;
  devicePixelRatio: number;
  color?: AnnotationColor;
  page: PagePayload;
};

type CaptureVisibleTabMessage = {
  type: "capture-visible-tab";
};

type RecordsForPageMessage = {
  type: "records.for-page";
  url: string;
};

type SyncRootConnectedMessage = {
  type: "sync.root-connected";
};

type OpenLibraryMessage = {
  type: "library.open";
};

type RuntimeMessage =
  | CreateFromSelectionMessage
  | CreateFromImageMessage
  | CreateFromScreenshotMessage
  | CaptureVisibleTabMessage
  | RecordsForPageMessage
  | SyncRootConnectedMessage
  | OpenLibraryMessage;

type MessageResult =
  | { ok: true; id: string; record: AnnotationRecord }
  | { ok: true; dataUrl: string }
  | { ok: true; records: AnnotationRecord[] }
  | { ok: true; replay: Awaited<ReturnType<typeof flushPendingSync>> }
  | { ok: true }
  | { ok: false; error: string };

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void flushPendingSync();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

void flushPendingSync();

async function handleMessage(message: unknown, sender: ChromeRuntimeMessageSender): Promise<MessageResult> {
  const parsed = parseRuntimeMessage(message);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  try {
    switch (parsed.message.type) {
      case "capture-visible-tab":
        return await captureVisibleTab(sender);
      case "record.create-from-selection":
        return await createTextRecord(parsed.message);
      case "record.create-from-image":
        return await createImageRecord(parsed.message);
      case "record.create-from-screenshot":
        return await createScreenshotRecord(parsed.message);
      case "records.for-page":
        return await recordsForPage(parsed.message);
      case "sync.root-connected":
        return { ok: true, replay: await flushPendingSyncFromStoredRoot() };
      case "library.open":
        return await openLibrary();
    }
  } catch (error) {
    return { ok: false, error: errorReason(error) };
  }
}

async function openLibrary(): Promise<MessageResult> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/library.html") });
  return { ok: true };
}

async function captureVisibleTab(sender: ChromeRuntimeMessageSender): Promise<MessageResult> {
  if (!sender.tab) {
    return { ok: false, error: "capture-visible-tab requires a tab sender" };
  }

  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
  return { ok: true, dataUrl };
}

async function recordsForPage(message: RecordsForPageMessage): Promise<MessageResult> {
  const store = await createRecordStore();
  const records = await store.listRecordsByPage(pageIdForUrl(message.url));
  return { ok: true, records };
}

async function createTextRecord(message: CreateFromSelectionMessage): Promise<MessageResult> {
  const record = baseRecord(message.page, "text");
  record.color = message.color;
  record.note = "";
  record.target = message.target;
  return putRecordAndFlush(record);
}

async function createImageRecord(message: CreateFromImageMessage): Promise<MessageResult> {
  const store = await createRecordStore();
  const target: ImageTarget = {
    type: "image",
    sourceUrl: message.sourceUrl,
    ...(message.altText ? { altText: message.altText } : {}),
    ...(message.cssPath ? { cssPath: message.cssPath } : {})
  };
  let shouldFlushEvent = true;

  try {
    const blob = await fetchImageBlob(message.sourceUrl);
    const assetId = createId("asset");
    const filename = `${assetId}.${extensionForMimeType(blob.type)}`;
    const pendingAsset: StoredAsset = {
      id: assetId,
      folder: "images",
      filename,
      blob,
      createdAt: nowIso(),
      syncStatus: "pending"
    };
    await store.putAsset(pendingAsset);

    const assetFlush = await flushAsset("images", filename, blob);
    if (assetFlush.ok) {
      target.assetPath = assetFlush.assetPath;
      shouldFlushEvent = true;
      await store.putAsset({ ...pendingAsset, syncStatus: "flushed" });
    } else {
      target.assetPath = `pending/images/${filename}`;
      shouldFlushEvent = false;
    }
  } catch {
    shouldFlushEvent = !target.assetPath?.startsWith("pending/");
  }

  const record = baseRecord(message.page, "image");
  record.target = target;
  return putRecordAndFlush(record, store, {
    shouldFlushEvent,
    canMarkFlushed: shouldFlushEvent
  });
}

async function createScreenshotRecord(message: CreateFromScreenshotMessage): Promise<MessageResult> {
  const blob = await dataUrlToBlob(message.croppedDataUrl);
  const assetId = createId("asset");
  const filename = `${assetId}.png`;
  let assetPath = `pending/screenshots/${filename}`;

  const store = await createRecordStore();
  const pendingAsset: StoredAsset = {
    id: assetId,
    folder: "screenshots",
    filename,
    blob,
    createdAt: nowIso(),
    syncStatus: "pending"
  };
  await store.putAsset(pendingAsset);

  const assetFlush = await flushAsset("screenshots", filename, blob);
  if (assetFlush.ok) {
    assetPath = assetFlush.assetPath;
    await store.putAsset({ ...pendingAsset, syncStatus: "flushed" });
  }

  const color = message.color ?? "yellow";
  const target: ScreenshotTarget = {
    type: "screenshot",
    assetPath,
    viewportRect: message.rect,
    devicePixelRatio: message.devicePixelRatio,
    annotations: [
      {
        type: "highlight",
        color,
        note: "",
        rect: message.rect
      }
    ]
  };
  const record = baseRecord(message.page, "screenshot");
  record.color = color;
  record.target = target;
  return putRecordAndFlush(record, store, {
    shouldFlushEvent: assetFlush.ok,
    canMarkFlushed: assetFlush.ok
  });
}

function baseRecord(page: PagePayload, kind: AnnotationRecord["kind"]): AnnotationRecord {
  const timestamp = nowIso();
  const normalizedUrl = normalizeUrl(page.url);

  return {
    id: createId("rec"),
    kind,
    pageId: pageIdForUrl(page.url),
    url: normalizedUrl,
    ...(page.canonicalUrl ? { canonicalUrl: page.canonicalUrl } : {}),
    title: page.title,
    domain: domainForUrl(page.url),
    createdAt: timestamp,
    updatedAt: timestamp,
    note: "",
    tags: [],
    collectionIds: [],
    review: { enabled: false },
    target: { type: "page" },
    sync: { status: "pending" }
  };
}

async function putRecordAndFlush(
  record: AnnotationRecord,
  existingStore?: Awaited<ReturnType<typeof createRecordStore>>,
  options: { shouldFlushEvent?: boolean; canMarkFlushed?: boolean } = {}
): Promise<MessageResult> {
  const store = existingStore ?? (await createRecordStore());
  await store.putRecord(record);

  const shouldFlushEvent = options.shouldFlushEvent ?? true;
  const canMarkFlushed = options.canMarkFlushed ?? true;
  if (!shouldFlushEvent) {
    return { ok: true, id: record.id, record };
  }

  const flushedRecord: AnnotationRecord = {
    ...record,
    sync: { status: "flushed", filePath: EVENTS_FILE_PATH }
  };
  const flush = await flushEvent({
    type: "record.created",
    record: canMarkFlushed ? flushedRecord : record
  });
  if (flush.ok && canMarkFlushed) {
    await store.putRecord(flushedRecord);
    return { ok: true, id: flushedRecord.id, record: flushedRecord };
  }

  return { ok: true, id: record.id, record };
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function fetchImageBlob(sourceUrl: string): Promise<Blob> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`image-fetch-failed:${response.status}`);
  }

  return response.blob();
}

function extensionForMimeType(mimeType: string): "png" | "jpg" | "webp" | "bin" {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();

  switch (normalized) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

function parseRuntimeMessage(message: unknown): { ok: true; message: RuntimeMessage } | { ok: false; error: string } {
  if (!isObject(message) || typeof message.type !== "string") {
    return { ok: false, error: "unsupported-message" };
  }

  switch (message.type) {
    case "capture-visible-tab":
      return { ok: true, message: { type: "capture-visible-tab" } };
    case "records.for-page":
      return parseRecordsForPageMessage(message);
    case "sync.root-connected":
      return { ok: true, message: { type: "sync.root-connected" } };
    case "library.open":
      return { ok: true, message: { type: "library.open" } };
    case "record.create-from-selection":
      return parseSelectionMessage(message);
    case "record.create-from-image":
      return parseImageMessage(message);
    case "record.create-from-screenshot":
      return parseScreenshotMessage(message);
    default:
      return { ok: false, error: "unsupported-message" };
  }
}

function parseRecordsForPageMessage(
  message: Record<string, unknown>
): { ok: true; message: RecordsForPageMessage } | { ok: false; error: string } {
  if (!isNonEmptyString(message.url) || !isValidUrl(message.url)) {
    return { ok: false, error: "invalid-url" };
  }

  return {
    ok: true,
    message: {
      type: "records.for-page",
      url: message.url
    }
  };
}

function parseSelectionMessage(
  message: Record<string, unknown>
): { ok: true; message: CreateFromSelectionMessage } | { ok: false; error: string } {
  if (!isColor(message.color)) {
    return { ok: false, error: "invalid-color" };
  }

  if (!isTextTarget(message.target)) {
    return { ok: false, error: "invalid-text-target" };
  }

  if (!isPagePayload(message.page)) {
    return { ok: false, error: "invalid-page" };
  }

  return {
    ok: true,
    message: {
      type: "record.create-from-selection",
      color: message.color,
      target: message.target,
      page: message.page
    }
  };
}

function parseImageMessage(
  message: Record<string, unknown>
): { ok: true; message: CreateFromImageMessage } | { ok: false; error: string } {
  if (!isNonEmptyString(message.sourceUrl) || !isValidUrl(message.sourceUrl)) {
    return { ok: false, error: "invalid-image-source" };
  }

  if (!isPagePayload(message.page)) {
    return { ok: false, error: "invalid-page" };
  }

  return {
    ok: true,
    message: {
      type: "record.create-from-image",
      sourceUrl: message.sourceUrl,
      ...(typeof message.altText === "string" ? { altText: message.altText } : {}),
      ...(typeof message.cssPath === "string" ? { cssPath: message.cssPath } : {}),
      page: message.page
    }
  };
}

function parseScreenshotMessage(
  message: Record<string, unknown>
): { ok: true; message: CreateFromScreenshotMessage } | { ok: false; error: string } {
  if (!isScreenshotDataUrl(message.croppedDataUrl)) {
    return { ok: false, error: "invalid-screenshot-data-url" };
  }

  if (!isScreenshotRect(message.rect)) {
    return { ok: false, error: "invalid-screenshot-rect" };
  }

  if (!isFinitePositive(message.devicePixelRatio)) {
    return { ok: false, error: "invalid-device-pixel-ratio" };
  }

  if (message.color !== undefined && !isColor(message.color)) {
    return { ok: false, error: "invalid-color" };
  }

  if (!isPagePayload(message.page)) {
    return { ok: false, error: "invalid-page" };
  }

  return {
    ok: true,
    message: {
      type: "record.create-from-screenshot",
      croppedDataUrl: message.croppedDataUrl,
      rect: message.rect,
      devicePixelRatio: message.devicePixelRatio,
      ...(isColor(message.color) ? { color: message.color } : {}),
      page: message.page
    }
  };
}

function isPagePayload(value: unknown): value is PagePayload {
  if (!isObject(value) || !isNonEmptyString(value.url) || typeof value.title !== "string") {
    return false;
  }

  if (!isValidUrl(value.url)) {
    return false;
  }

  return (
    value.canonicalUrl === undefined ||
    (typeof value.canonicalUrl === "string" && isValidUrl(value.canonicalUrl))
  );
}

function isColor(value: unknown): value is AnnotationColor {
  return typeof value === "string" && COLORS.includes(value as AnnotationColor);
}

function isTextTarget(value: unknown): value is TextTarget {
  if (!isObject(value) || value.type !== "text") {
    return false;
  }

  return (
    isNonEmptyString(value.quote) &&
    typeof value.prefix === "string" &&
    typeof value.suffix === "string" &&
    isOptionalFiniteNonNegative(value.startOffset) &&
    isOptionalFiniteNonNegative(value.endOffset) &&
    (value.cssPath === undefined || typeof value.cssPath === "string") &&
    ["exact", "context", "manual"].includes(String(value.locatorConfidence))
  );
}

function isScreenshotRect(value: unknown): value is ScreenshotRect {
  if (!isObject(value)) {
    return false;
  }

  return (
    isFiniteNonNegative(value.x) &&
    isFiniteNonNegative(value.y) &&
    isFiniteNonNegative(value.width) &&
    isFiniteNonNegative(value.height)
  );
}

function isScreenshotDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(PNG_DATA_URL_PREFIX) &&
    value.length <= MAX_SCREENSHOT_DATA_URL_LENGTH
  );
}

function isOptionalFiniteNonNegative(value: unknown): boolean {
  return value === undefined || isFiniteNonNegative(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown-error";
}
