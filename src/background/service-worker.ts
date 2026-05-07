import { flushAsset, flushEvent } from "./sync-engine";
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
  page: PagePayload;
};

type CaptureVisibleTabMessage = {
  type: "capture-visible-tab";
};

type RuntimeMessage =
  | CreateFromSelectionMessage
  | CreateFromImageMessage
  | CreateFromScreenshotMessage
  | CaptureVisibleTabMessage;

type MessageResult =
  | { ok: true; id: string; record: AnnotationRecord }
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(message: unknown, sender: ChromeRuntimeMessageSender): Promise<MessageResult> {
  if (!isRuntimeMessage(message)) {
    return { ok: false, error: "unsupported-message" };
  }

  try {
    switch (message.type) {
      case "capture-visible-tab":
        return await captureVisibleTab(sender);
      case "record.create-from-selection":
        return await createTextRecord(message);
      case "record.create-from-image":
        return await createImageRecord(message);
      case "record.create-from-screenshot":
        return await createScreenshotRecord(message);
    }
  } catch (error) {
    return { ok: false, error: errorReason(error) };
  }
}

async function captureVisibleTab(sender: ChromeRuntimeMessageSender): Promise<MessageResult> {
  const windowId = sender.tab?.windowId ?? (await activeWindowId());
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  return { ok: true, dataUrl };
}

async function createTextRecord(message: CreateFromSelectionMessage): Promise<MessageResult> {
  const record = baseRecord(message.page, "text");
  record.color = message.color;
  record.note = "";
  record.target = message.target;
  return putRecordAndFlush(record);
}

async function createImageRecord(message: CreateFromImageMessage): Promise<MessageResult> {
  const target: ImageTarget = {
    type: "image",
    sourceUrl: message.sourceUrl,
    ...(message.altText ? { altText: message.altText } : {}),
    ...(message.cssPath ? { cssPath: message.cssPath } : {})
  };

  const record = baseRecord(message.page, "image");
  record.target = target;
  return putRecordAndFlush(record);
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

  const target: ScreenshotTarget = {
    type: "screenshot",
    assetPath,
    viewportRect: message.rect,
    devicePixelRatio: message.devicePixelRatio
  };
  const record = baseRecord(message.page, "screenshot");
  record.target = target;
  return putRecordAndFlush(record, store);
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
  existingStore?: Awaited<ReturnType<typeof createRecordStore>>
): Promise<MessageResult> {
  const store = existingStore ?? (await createRecordStore());
  await store.putRecord(record);

  const flush = await flushEvent({ type: "record.created", record });
  if (flush.ok) {
    const flushedRecord: AnnotationRecord = { ...record, sync: { status: "flushed" } };
    await store.putRecord(flushedRecord);
    return { ok: true, id: flushedRecord.id, record: flushedRecord };
  }

  return { ok: true, id: record.id, record };
}

async function activeWindowId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.windowId;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

function isRuntimeMessage(message: unknown): message is RuntimeMessage {
  if (!isObject(message) || typeof message.type !== "string") {
    return false;
  }

  switch (message.type) {
    case "capture-visible-tab":
      return true;
    case "record.create-from-selection":
      return isObject(message.target) && isObject(message.page);
    case "record.create-from-image":
      return typeof message.sourceUrl === "string" && isObject(message.page);
    case "record.create-from-screenshot":
      return (
        typeof message.croppedDataUrl === "string" &&
        isObject(message.rect) &&
        typeof message.devicePixelRatio === "number" &&
        isObject(message.page)
      );
    default:
      return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown-error";
}
