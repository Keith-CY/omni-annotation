import { installHighlightStyles, renderTextHighlight } from "./highlight-layer";
import { startImagePickMode, type StopImagePickMode } from "./image-picker";
import { readCurrentSelection, readCurrentSentenceSelection } from "./selection";
import { cropCaptureDataUrl, startScreenshotOverlay } from "./screenshot-overlay";
import { installStickyLayerStyles, renderStickyNote } from "./sticky-note-layer";
import type { ToolbarAction } from "./toolbar";
import type { AnnotationColor, AnnotationRecord, TextTarget } from "../shared/types";

type PagePayload = {
  url: string;
  canonicalUrl?: string;
  title: string;
};

type MessageResponse =
  | { ok: true; id?: string; dataUrl?: string; record?: AnnotationRecord; records?: AnnotationRecord[] }
  | { ok: false; error: string };

type PageRecordsResponse =
  | { ok: true; records: AnnotationRecord[] }
  | { ok: false; error: string };

type ContextMenuAction = Exclude<ToolbarAction, { type: "color" }>["type"];

type ContextMenuContentMessage =
  | {
      type: "omni.context-menu-action";
      action: ContextMenuAction;
      image?: {
        sourceUrl: string;
        altText?: string;
      };
    }
  | {
      type: "omni.context-menu-color";
      color: AnnotationColor;
    };

const RESTORE_RETRY_DELAYS_MS = [0, 350, 1100, 2600, 5200, 9000];
const RESTORE_OBSERVER_DEBOUNCE_MS = 240;
const RESTORE_OBSERVER_TIMEOUT_MS = 12000;

let selectedColor: AnnotationColor = "yellow";
let stopImagePickMode: StopImagePickMode | undefined;
let toastTimer: number | undefined;
let restoreInFlight = false;
let restoreQueued = false;
let restoreObserver: MutationObserver | undefined;
let restoreObserverDebounceTimer: number | undefined;
let restoreObserverStopTimer: number | undefined;
let lastSelectionTarget: TextTarget | undefined;
let lastSentenceTarget: TextTarget | undefined;

installHighlightStyles();
installStickyLayerStyles();
document.addEventListener("selectionchange", cacheCurrentSelection);
document.addEventListener("mouseup", cacheCurrentSelection);
window.addEventListener("omni-annotation-native-action", (event) => {
  void handleNativeBridgeEvent(event).catch(() => undefined);
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleContentMessage(message).then(sendResponse);
  return true;
});
startRestorePipeline();

async function handleToolbarAction(action: ToolbarAction): Promise<void> {
  switch (action.type) {
    case "color":
      selectedColor = action.color;
      return;
    case "highlight":
      await createRecordFromSelection(readCurrentSelection() ?? lastSelectionTarget);
      return;
    case "sentence-highlight":
      await createRecordFromSelection(readCurrentSentenceSelection() ?? lastSentenceTarget ?? lastSelectionTarget);
      return;
    case "image":
      startImageMode();
      return;
    case "screenshot":
      startScreenshotMode();
      return;
    case "sticky-note":
      await createStickyNote();
      return;
  }
}

async function handleContentMessage(message: unknown): Promise<MessageResponse> {
  const parsed = parseContextMenuContentMessage(message);
  if (!parsed) {
    return { ok: false, error: "unsupported-content-message" };
  }

  if (parsed.type === "omni.context-menu-color") {
    selectedColor = parsed.color;
    return { ok: true };
  }

  if (parsed.action === "image" && parsed.image) {
    await savePickedImage({
      ...parsed.image,
      cssPath: ""
    });
    return { ok: true };
  }

  await handleToolbarAction({ type: parsed.action });
  return { ok: true };
}

async function handleNativeBridgeEvent(event: Event): Promise<void> {
  if (!(event instanceof CustomEvent)) {
    return;
  }
  const detail = event.detail;
  if (!isObject(detail) || !isContextMenuAction(detail.action)) {
    return;
  }

  if (isColor(detail.color)) {
    selectedColor = detail.color;
  }

  await handleToolbarAction({ type: detail.action });
}

async function createRecordFromSelection(target: TextTarget | undefined): Promise<void> {
  if (!target) {
    return;
  }

  const response = await sendMessage<MessageResponse>({
    type: "record.create-from-selection",
    color: selectedColor,
    target,
    page: currentPagePayload()
  });

  if (response.ok && response.record) {
    renderTextHighlightIfNeeded(response.record);
    showCaptureToast("Text saved");
  } else if (!response.ok) {
    showCaptureToast("Text save failed", "error");
  }
}

function startRestorePipeline(): void {
  for (const delay of RESTORE_RETRY_DELAYS_MS) {
    window.setTimeout(() => {
      void restorePageHighlightsWithLock();
    }, delay);
  }
  startRestoreObserver();
}

function startRestoreObserver(): void {
  if (!document.documentElement || restoreObserver) {
    return;
  }

  restoreObserver = new MutationObserver(() => {
    if (restoreObserverDebounceTimer !== undefined) {
      return;
    }
    restoreObserverDebounceTimer = window.setTimeout(() => {
      restoreObserverDebounceTimer = undefined;
      void restorePageHighlightsWithLock();
    }, RESTORE_OBSERVER_DEBOUNCE_MS);
  });
  restoreObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  restoreObserverStopTimer = window.setTimeout(() => {
    stopRestoreObserver();
  }, RESTORE_OBSERVER_TIMEOUT_MS);
}

function stopRestoreObserver(): void {
  if (restoreObserver) {
    restoreObserver.disconnect();
    restoreObserver = undefined;
  }
  if (restoreObserverDebounceTimer !== undefined) {
    window.clearTimeout(restoreObserverDebounceTimer);
    restoreObserverDebounceTimer = undefined;
  }
  if (restoreObserverStopTimer !== undefined) {
    window.clearTimeout(restoreObserverStopTimer);
    restoreObserverStopTimer = undefined;
  }
}

async function restorePageHighlightsWithLock(): Promise<void> {
  if (restoreInFlight) {
    restoreQueued = true;
    return;
  }

  restoreInFlight = true;
  try {
    const renderedCount = await restorePageHighlights();
    if (renderedCount > 0) {
      stopRestoreObserver();
    }
  } finally {
    restoreInFlight = false;
    if (restoreQueued) {
      restoreQueued = false;
      void restorePageHighlightsWithLock();
    }
  }
}

async function restorePageHighlights(): Promise<number> {
  const page = currentPagePayload();
  const response = await sendMessage<PageRecordsResponse>({
    type: "records.for-page",
    url: page.url
  });

  const canonicalRecords = page.canonicalUrl
    ? await sendMessage<PageRecordsResponse>({
        type: "records.for-page",
        url: page.canonicalUrl
      }).catch(() => ({ ok: false } as { ok: false }))
    : undefined;

  if (!response.ok) {
    return 0;
  }

  const merged = canonicalRecords?.ok ? mergeRecords(response.records, canonicalRecords.records) : response.records;
  let renderedCount = 0;
  for (const record of prioritizedRestoreRecords(merged)) {
    if (renderTextHighlightIfNeeded(record)) {
      renderedCount += 1;
    }
  }
  return renderedCount;
}

function renderTextHighlightIfNeeded(record: AnnotationRecord): boolean {
  if (record.target.type === "text") {
    if (hasRenderedRecord(record.id)) {
      return false;
    }
    return renderTextHighlight(record);
  }

  if (record.target.type === "sticky-note") {
    return renderStickyNote(record, {
      onUpdated: upsertRenderedRecord,
      readAssetDataUrl: readAssetDataUrl,
      sendMessage
    });
  }

  return false;
}

function prioritizedRestoreRecords(records: AnnotationRecord[]): AnnotationRecord[] {
  const textRecords = dedupeTextRestoreRecords(records);
  textRecords.sort((left, right) => {
    const lengthDelta = textQuoteLength(right) - textQuoteLength(left);
    if (lengthDelta !== 0) {
      return lengthDelta;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });

  return [...textRecords, ...records.filter((record) => record.target.type !== "text")];
}

function dedupeTextRestoreRecords(records: AnnotationRecord[]): AnnotationRecord[] {
  const unique: AnnotationRecord[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    if (record.target.type !== "text") {
      continue;
    }
    const key = [
      record.url,
      record.target.cssPath ?? "",
      record.target.quote,
      record.target.prefix,
      record.target.suffix
    ].join("::");

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(record);
  }

  return unique;
}

function textQuoteLength(record: AnnotationRecord): number {
  return record.target.type === "text" ? record.target.quote.length : 0;
}

function mergeRecords(primary: AnnotationRecord[], secondary: AnnotationRecord[]): AnnotationRecord[] {
  if (secondary.length === 0) {
    return primary;
  }

  const merged = [...primary];
  const seen = new Set(primary.map((record) => record.id));
  for (const record of secondary) {
    if (seen.has(record.id)) {
      continue;
    }
    seen.add(record.id);
    merged.push(record);
  }
  return merged;
}

function hasRenderedRecord(recordId: string): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-omni-record-id]")).some(
    (element) => element.dataset.omniRecordId === recordId
  );
}

function upsertRenderedRecord(record: AnnotationRecord): void {
  if (record.target.type === "sticky-note") {
    void renderTextHighlightIfNeeded(record);
  }
}

function cacheCurrentSelection(): void {
  const selection = globalThis.getSelection?.();
  if (isUsableSelection(selection)) {
    lastSelectionTarget = readCurrentSelection() ?? lastSelectionTarget;
    lastSentenceTarget = readCurrentSentenceSelection() ?? lastSentenceTarget ?? lastSelectionTarget;
  }
}

function startImageMode(): void {
  stopImagePickMode?.();
  showCaptureToast("Click an image to save it", "info", { autoHide: false });
  stopImagePickMode = startImagePickMode((image) => {
    stopImagePickMode = undefined;
    void savePickedImage(image).catch(() => {
      showCaptureToast("Image save failed", "error");
    });
  });
}

async function savePickedImage(image: { sourceUrl: string; altText?: string; cssPath?: string }): Promise<void> {
  const response = await sendMessage<MessageResponse>({
    type: "record.create-from-image",
    ...image,
    page: currentPagePayload()
  });
  showCaptureToast(response.ok ? "Image saved" : "Image save failed", response.ok ? "success" : "error");
}

function startScreenshotMode(): void {
  startScreenshotOverlay((rect) => {
    void (async () => {
      const capture = await sendMessage<MessageResponse>({ type: "capture-visible-tab" });
      if (!capture.ok || !capture.dataUrl) {
        return;
      }

      const devicePixelRatio = window.devicePixelRatio || 1;
      const croppedDataUrl = await cropCaptureDataUrl(capture.dataUrl, rect, devicePixelRatio);

      const response = await sendMessage<MessageResponse>({
        type: "record.create-from-screenshot",
        croppedDataUrl,
        rect,
        page: currentPagePayload(),
        devicePixelRatio,
        color: selectedColor
      });
      showCaptureToast(
        response.ok ? "Screenshot saved" : "Screenshot save failed",
        response.ok ? "success" : "error"
      );
    })().catch(() => {
      showCaptureToast("Screenshot save failed", "error");
    });
  });
}

async function createStickyNote(): Promise<void> {
  const viewportWidth = Math.max(window.innerWidth, 320);
  const viewportHeight = Math.max(window.innerHeight, 240);
  const width = Math.min(320, Math.max(180, Math.round(viewportWidth * 0.28)));
  const height = Math.min(220, Math.max(120, Math.round(viewportHeight * 0.24)));
  const x = Math.max(8, Math.round((viewportWidth - width) / 2));
  const y = Math.max(56, Math.round((viewportHeight - height) / 2));

  const response = await sendMessage<MessageResponse>({
    type: "record.create-sticky-note",
    page: currentPagePayload(),
    color: selectedColor,
    rect: { x, y, width, height },
    text: ""
  });
  if (response.ok && response.record) {
    renderTextHighlightIfNeeded(response.record);
    showCaptureToast("Sticky note saved");
  } else {
    showCaptureToast("Sticky save failed", "error");
  }
}

async function readAssetDataUrl(assetId: string): Promise<string | undefined> {
  const response = await sendMessage<MessageResponse>({
    type: "asset.read-data-url",
    assetId
  });
  if (!response.ok || !response.dataUrl) {
    return undefined;
  }
  return response.dataUrl;
}

function showCaptureToast(
  message: string,
  kind: "success" | "info" | "error" = "success",
  options: { autoHide?: boolean } = {}
): void {
  const existing = document.getElementById("omni-annotation-toast");
  existing?.remove();

  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
    toastTimer = undefined;
  }

  const host = document.createElement("div");
  host.id = "omni-annotation-toast";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      position: fixed;
      right: 12px;
      top: 58px;
      z-index: 2147483646;
      font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .toast {
      align-items: center;
      background: rgba(255, 255, 255, 0.96);
      border: 1px solid rgba(0, 0, 0, 0.14);
      border-left: 4px solid #2563eb;
      border-radius: 8px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.16);
      color: #1f2937;
      display: flex;
      gap: 10px;
      min-width: 220px;
      max-width: min(320px, calc(100vw - 24px));
      padding: 9px 10px;
    }
    .toast.success { border-left-color: #16a34a; }
    .toast.error { border-left-color: #dc2626; }
    .message { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    button {
      appearance: none;
      border: 1px solid rgba(0, 0, 0, 0.16);
      border-radius: 6px;
      background: #fff;
      color: #1f2937;
      cursor: pointer;
      font: inherit;
      padding: 5px 8px;
      white-space: nowrap;
    }
    button:hover { background: #f3f4f6; }
  `;
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  const text = document.createElement("span");
  text.className = "message";
  text.textContent = message;
  const libraryButton = document.createElement("button");
  libraryButton.type = "button";
  libraryButton.textContent = "Open Library";
  libraryButton.addEventListener("click", () => {
    void sendMessage({ type: "library.open" }).catch(() => {
      showCaptureToast("Library open failed", "error");
    });
  });
  toast.append(text, libraryButton);
  shadow.append(style, toast);
  document.documentElement.append(host);

  if (options.autoHide !== false) {
    toastTimer = window.setTimeout(() => {
      host.remove();
      toastTimer = undefined;
    }, 4200);
  }
}

function currentPagePayload(): PagePayload {
  const canonicalUrl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;

  return {
    url: location.href,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    title: document.title
  };
}

async function sendMessage<TResponse = MessageResponse>(message: unknown): Promise<TResponse> {
  return chrome.runtime.sendMessage(message) as Promise<TResponse>;
}

function parseContextMenuContentMessage(message: unknown): ContextMenuContentMessage | undefined {
  if (!isObject(message) || typeof message.type !== "string") {
    return undefined;
  }

  if (message.type === "omni.context-menu-color") {
    return isColor(message.color) ? { type: "omni.context-menu-color", color: message.color } : undefined;
  }

  if (message.type !== "omni.context-menu-action" || !isContextMenuAction(message.action)) {
    return undefined;
  }

  const image = isObject(message.image) && typeof message.image.sourceUrl === "string"
    ? {
        sourceUrl: message.image.sourceUrl,
        ...(typeof message.image.altText === "string" ? { altText: message.image.altText } : {})
      }
    : undefined;

  return {
    type: "omni.context-menu-action",
    action: message.action,
    ...(image ? { image } : {})
  };
}

function isUsableSelection(selection: Selection | null | undefined): boolean {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || selection.toString().trim().length === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  const commonElement = elementForSelectionNode(range.commonAncestorContainer);
  if (!commonElement || isIgnoredSelectionElement(commonElement)) {
    return false;
  }

  return true;
}

function elementForSelectionNode(node: Node): Element | undefined {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return node as Element;
  }
  return node.parentElement ?? undefined;
}

function isIgnoredSelectionElement(element: Element): boolean {
  if (element.closest("#omni-annotation-toolbar, #omni-annotation-toast, #omni-annotation-sticky-layer")) {
    return true;
  }

  if (element.closest("input, textarea, select, option, [contenteditable='true'], [contenteditable='']")) {
    return true;
  }

  return false;
}

function isContextMenuAction(value: unknown): value is ContextMenuAction {
  return (
    value === "highlight" ||
    value === "sentence-highlight" ||
    value === "image" ||
    value === "screenshot" ||
    value === "sticky-note"
  );
}

function isColor(value: unknown): value is AnnotationColor {
  return value === "yellow" || value === "green" || value === "pink" || value === "purple" || value === "cyan";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
