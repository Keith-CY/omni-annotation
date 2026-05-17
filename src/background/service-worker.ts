import {
  EVENTS_FILE_PATH,
  flushAsset,
  flushEvent,
  flushPendingSync,
  flushPendingSyncFromStoredRoot
} from "./sync-engine";
import {
  CONTEXT_MENU_ITEMS,
  contextActionForMenuId,
  contextColorForMenuId
} from "./context-menu";
import { createId } from "../shared/id";
import { createRecordStore, type StoredAsset } from "../shared/idb";
import { domainForUrl, normalizeUrl, pageIdCandidatesForUrl, pageIdForUrl } from "../shared/page";
import { nowIso } from "../shared/time";
import type {
  AnnotationColor,
  AnnotationRecord,
  ImageTarget,
  ScreenshotTarget,
  StickyImage,
  StickyNoteTarget,
  TextTarget
} from "../shared/types";

const COLORS: readonly AnnotationColor[] = ["yellow", "green", "pink", "purple", "cyan"];
const MAX_SCREENSHOT_DATA_URL_LENGTH = 20 * 1024 * 1024;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const IMAGE_DATA_URL_PREFIX = "data:image/";

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

type StickyRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CreateStickyNoteMessage = {
  type: "record.create-sticky-note";
  page: PagePayload;
  rect: StickyRect;
  color?: AnnotationColor;
  text?: string;
};

type UpdateStickyNoteMessage = {
  type: "record.update-sticky-note";
  id: string;
  rect?: StickyRect;
  text?: string;
  color?: AnnotationColor;
};

type AddStickyImageMessage = {
  type: "record.add-sticky-image";
  id: string;
  dataUrl: string;
};

type DeleteStickyNoteMessage = {
  type: "record.delete-sticky-note";
  id: string;
};

type ReadAssetDataUrlMessage = {
  type: "asset.read-data-url";
  assetId: string;
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
  | CreateStickyNoteMessage
  | UpdateStickyNoteMessage
  | AddStickyImageMessage
  | DeleteStickyNoteMessage
  | CaptureVisibleTabMessage
  | ReadAssetDataUrlMessage
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

type StickyRecordPatch = {
  target?: StickyNoteTarget;
  note?: string;
  color?: AnnotationColor;
};

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  void registerContextMenus();
  void flushPendingSync();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuClick(info, tab);
});

void registerContextMenus();
void flushPendingSync();

async function registerContextMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  for (const item of CONTEXT_MENU_ITEMS) {
    chrome.contextMenus.create({
      id: item.id,
      contexts: item.contexts,
      ...(item.title ? { title: item.title } : {}),
      ...(item.parentId ? { parentId: item.parentId } : {}),
      ...(item.type ? { type: item.type } : {})
    });
  }
}

async function handleContextMenuClick(info: ChromeContextMenusOnClickData, tab?: ChromeTab): Promise<void> {
  const tabId = tab?.id;
  if (typeof tabId !== "number") {
    return;
  }

  const menuItemId = String(info.menuItemId);
  const color = contextColorForMenuId(menuItemId);
  if (color) {
    await chrome.tabs.sendMessage(tabId, {
      type: "omni.context-menu-color",
      color
    });
    return;
  }

  const action = contextActionForMenuId(menuItemId);
  if (!action) {
    return;
  }

  await chrome.tabs.sendMessage(tabId, {
    type: "omni.context-menu-action",
    action,
    ...(action === "image" && info.srcUrl
      ? {
          image: {
            sourceUrl: info.srcUrl
          }
        }
      : {})
  });
}

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
      case "record.create-sticky-note":
        return await createStickyNoteRecord(parsed.message);
      case "record.update-sticky-note":
        return await updateStickyNoteRecord(parsed.message);
      case "record.add-sticky-image":
        return await addStickyImage(parsed.message);
      case "record.delete-sticky-note":
        return await deleteStickyNote(parsed.message);
      case "records.for-page":
        return await recordsForPage(parsed.message);
      case "asset.read-data-url":
        return await readAssetDataUrl(parsed.message);
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
  const candidates = pageIdCandidatesForUrl(message.url);
  const merged = new Map<string, AnnotationRecord>();

  for (const pageId of candidates) {
    const records = await store.listRecordsByPage(pageId);
    for (const record of records) {
      merged.set(record.id, record);
    }
  }

  return { ok: true, records: Array.from(merged.values()) };
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

async function createStickyNoteRecord(message: CreateStickyNoteMessage): Promise<MessageResult> {
  const record = baseRecord(message.page, "sticky-note");
  record.color = message.color ?? "yellow";
  const text = typeof message.text === "string" ? message.text : "";
  const rect = sanitizeStickyRect(message.rect);
  const target: StickyNoteTarget = {
    type: "sticky-note",
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    text,
    images: []
  };
  record.target = target;
  record.note = text;
  return putRecordAndFlush(record);
}

async function updateStickyNoteRecord(message: UpdateStickyNoteMessage): Promise<MessageResult> {
  const store = await createRecordStore();
  const current = await store.getRecord(message.id);
  if (!current || current.target.type !== "sticky-note") {
    return { ok: false, error: "sticky-note-not-found" };
  }

  const nextTarget: StickyNoteTarget = { ...current.target };
  if (message.rect) {
    const rect = sanitizeStickyRect(message.rect);
    nextTarget.x = rect.x;
    nextTarget.y = rect.y;
    nextTarget.width = rect.width;
    nextTarget.height = rect.height;
  }
  if (typeof message.text === "string") {
    nextTarget.text = message.text;
  }

  return await persistStickyRecordPatch(store, current, {
    target: nextTarget,
    note: nextTarget.text,
    ...(isColor(message.color) ? { color: message.color } : {})
  });
}

async function addStickyImage(message: AddStickyImageMessage): Promise<MessageResult> {
  const store = await createRecordStore();
  const current = await store.getRecord(message.id);
  if (!current || current.target.type !== "sticky-note") {
    return { ok: false, error: "sticky-note-not-found" };
  }

  if (!isImageDataUrl(message.dataUrl)) {
    return { ok: false, error: "invalid-sticky-image-data-url" };
  }

  const blob = await dataUrlToBlob(message.dataUrl);
  const assetId = createId("asset");
  const extension = extensionForMimeType(blob.type);
  const filename = `${assetId}.${extension}`;
  let assetPath = `pending/images/${filename}`;

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
    assetPath = assetFlush.assetPath;
    await store.putAsset({ ...pendingAsset, syncStatus: "flushed" });
  }

  const dimensions = await imageDimensionsFromBlob(blob);
  const stickyImage: StickyImage = {
    assetPath,
    width: dimensions.width,
    height: dimensions.height
  };
  const nextTarget: StickyNoteTarget = {
    ...current.target,
    images: [...current.target.images, stickyImage]
  };

  return await persistStickyRecordPatch(store, current, {
    target: nextTarget
  });
}

async function deleteStickyNote(message: DeleteStickyNoteMessage): Promise<MessageResult> {
  const store = await createRecordStore();
  const current = await store.getRecord(message.id);
  if (!current || current.target.type !== "sticky-note") {
    return { ok: false, error: "sticky-note-not-found" };
  }

  await store.deleteRecord(current.id);
  const deletedAt = nowIso();
  await flushEvent({ type: "record.deleted", id: current.id, updatedAt: deletedAt });
  return { ok: true, id: current.id, record: current };
}

async function readAssetDataUrl(message: ReadAssetDataUrlMessage): Promise<MessageResult> {
  const store = await createRecordStore();
  const asset = await store.getAsset(message.assetId);
  if (!asset) {
    return { ok: false, error: "asset-not-found" };
  }

  if (asset.syncStatus === "flushed") {
    const synced = await readSyncedAssetDataUrl(asset.folder, asset.filename);
    if (synced) {
      return { ok: true, dataUrl: synced };
    }
  }

  return { ok: true, dataUrl: await blobToDataUrl(asset.blob) };
}

async function persistStickyRecordPatch(
  store: Awaited<ReturnType<typeof createRecordStore>>,
  current: AnnotationRecord,
  patch: StickyRecordPatch
): Promise<MessageResult> {
  const updatedAt = nowIso();
  const nextPatch = {
    ...(patch.target ? { target: patch.target } : {}),
    ...(typeof patch.note === "string" ? { note: patch.note } : {}),
    ...(patch.color ? { color: patch.color } : {})
  };

  const updated: AnnotationRecord = {
    ...current,
    ...nextPatch,
    updatedAt,
    sync: current.sync.status === "flushed" ? { ...current.sync, status: "pending" } : current.sync
  };
  await store.putRecord(updated);

  const flush = await flushEvent({
    type: "record.updated",
    id: updated.id,
    updatedAt,
    patch: nextPatch
  });
  if (!flush.ok) {
    return { ok: true, id: updated.id, record: updated };
  }

  const flushed = withFlushedSync(updated);
  await store.putRecord(flushed);
  return { ok: true, id: flushed.id, record: flushed };
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
    case "asset.read-data-url":
      return parseReadAssetDataUrlMessage(message);
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
    case "record.create-sticky-note":
      return parseCreateStickyNoteMessage(message);
    case "record.update-sticky-note":
      return parseUpdateStickyNoteMessage(message);
    case "record.add-sticky-image":
      return parseAddStickyImageMessage(message);
    case "record.delete-sticky-note":
      return parseDeleteStickyNoteMessage(message);
    default:
      return { ok: false, error: "unsupported-message" };
  }
}

function parseReadAssetDataUrlMessage(
  message: Record<string, unknown>
): { ok: true; message: ReadAssetDataUrlMessage } | { ok: false; error: string } {
  if (!isNonEmptyString(message.assetId)) {
    return { ok: false, error: "invalid-asset-id" };
  }

  return {
    ok: true,
    message: {
      type: "asset.read-data-url",
      assetId: message.assetId
    }
  };
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

function parseCreateStickyNoteMessage(
  message: Record<string, unknown>
): { ok: true; message: CreateStickyNoteMessage } | { ok: false; error: string } {
  if (!isPagePayload(message.page)) {
    return { ok: false, error: "invalid-page" };
  }
  if (!isStickyRect(message.rect)) {
    return { ok: false, error: "invalid-sticky-rect" };
  }
  if (message.color !== undefined && !isColor(message.color)) {
    return { ok: false, error: "invalid-color" };
  }
  if (message.text !== undefined && typeof message.text !== "string") {
    return { ok: false, error: "invalid-sticky-text" };
  }

  return {
    ok: true,
    message: {
      type: "record.create-sticky-note",
      page: message.page,
      rect: message.rect,
      ...(isColor(message.color) ? { color: message.color } : {}),
      ...(typeof message.text === "string" ? { text: message.text } : {})
    }
  };
}

function parseUpdateStickyNoteMessage(
  message: Record<string, unknown>
): { ok: true; message: UpdateStickyNoteMessage } | { ok: false; error: string } {
  if (!isNonEmptyString(message.id)) {
    return { ok: false, error: "invalid-sticky-id" };
  }
  if (message.rect !== undefined && !isStickyRect(message.rect)) {
    return { ok: false, error: "invalid-sticky-rect" };
  }
  if (message.text !== undefined && typeof message.text !== "string") {
    return { ok: false, error: "invalid-sticky-text" };
  }
  if (message.color !== undefined && !isColor(message.color)) {
    return { ok: false, error: "invalid-color" };
  }

  return {
    ok: true,
    message: {
      type: "record.update-sticky-note",
      id: message.id,
      ...(message.rect ? { rect: message.rect } : {}),
      ...(typeof message.text === "string" ? { text: message.text } : {}),
      ...(isColor(message.color) ? { color: message.color } : {})
    }
  };
}

function parseAddStickyImageMessage(
  message: Record<string, unknown>
): { ok: true; message: AddStickyImageMessage } | { ok: false; error: string } {
  if (!isNonEmptyString(message.id)) {
    return { ok: false, error: "invalid-sticky-id" };
  }
  if (!isNonEmptyString(message.dataUrl) || !isImageDataUrl(message.dataUrl)) {
    return { ok: false, error: "invalid-sticky-image-data-url" };
  }

  return {
    ok: true,
    message: {
      type: "record.add-sticky-image",
      id: message.id,
      dataUrl: message.dataUrl
    }
  };
}

function parseDeleteStickyNoteMessage(
  message: Record<string, unknown>
): { ok: true; message: DeleteStickyNoteMessage } | { ok: false; error: string } {
  if (!isNonEmptyString(message.id)) {
    return { ok: false, error: "invalid-sticky-id" };
  }

  return {
    ok: true,
    message: {
      type: "record.delete-sticky-note",
      id: message.id
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

function isStickyRect(value: unknown): value is StickyRect {
  if (!isObject(value)) {
    return false;
  }

  return (
    isFiniteNonNegative(value.x) &&
    isFiniteNonNegative(value.y) &&
    isFinitePositive(value.width) &&
    isFinitePositive(value.height)
  );
}

function sanitizeStickyRect(rect: StickyRect): StickyRect {
  return {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    width: clamp(rect.width, 120, 10000),
    height: clamp(rect.height, 80, 10000)
  };
}

function isScreenshotDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(PNG_DATA_URL_PREFIX) &&
    value.length <= MAX_SCREENSHOT_DATA_URL_LENGTH
  );
}

function isImageDataUrl(value: string): boolean {
  return value.startsWith(IMAGE_DATA_URL_PREFIX);
}

function withFlushedSync(record: AnnotationRecord): AnnotationRecord {
  return {
    ...record,
    sync: { status: "flushed", filePath: EVENTS_FILE_PATH }
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("blob-to-data-url-failed"));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("blob-to-data-url-failed"));
      }
    };
    reader.readAsDataURL(blob);
  });
}

async function imageDimensionsFromBlob(blob: Blob): Promise<{ width: number; height: number }> {
  const image = await createImageBitmap(blob);
  const width = image.width;
  const height = image.height;
  image.close();
  return { width, height };
}

async function readSyncedAssetDataUrl(
  folder: "screenshots" | "images",
  filename: string
): Promise<string | undefined> {
  try {
    const root = await resolveRootHandleForRead();
    if (!root) {
      return undefined;
    }
    const assetsDir = await root.getDirectoryHandle("assets");
    const folderDir = await assetsDir.getDirectoryHandle(folder);
    const file = await folderDir.getFileHandle(filename);
    const blob = await file.getFile();
    return await blobToDataUrl(blob);
  } catch {
    return undefined;
  }
}

async function resolveRootHandleForRead(): Promise<FileSystemDirectoryHandle | undefined> {
  const store = await createRecordStore();
  const saved = await store.getMeta<FileSystemDirectoryHandle>("syncRootHandle");
  return saved;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
