import { installHighlightStyles, renderTextHighlight } from "./highlight-layer";
import { startImagePickMode, type StopImagePickMode } from "./image-picker";
import { readCurrentSelection, readCurrentSentenceSelection } from "./selection";
import { cropCaptureDataUrl, startScreenshotOverlay } from "./screenshot-overlay";
import { mountToolbar, type ToolbarAction, type ToolbarController } from "./toolbar";
import type { AnnotationColor, AnnotationRecord, TextTarget } from "../shared/types";

type PagePayload = {
  url: string;
  canonicalUrl?: string;
  title: string;
};

type MessageResponse =
  | { ok: true; id?: string; dataUrl?: string; record?: AnnotationRecord }
  | { ok: false; error: string };

type PageRecordsResponse =
  | { ok: true; records: AnnotationRecord[] }
  | { ok: false; error: string };

let selectedColor: AnnotationColor = "yellow";
let stopImagePickMode: StopImagePickMode | undefined;
let toolbar: ToolbarController;
let toastTimer: number | undefined;

installHighlightStyles();
toolbar = mountToolbar((action) => {
  void handleToolbarAction(action).catch(() => undefined);
});
document.addEventListener("selectionchange", updateToolbarForSelection);
document.addEventListener("mouseup", updateToolbarForSelection);
void restorePageHighlights().catch(() => undefined);

async function handleToolbarAction(action: ToolbarAction): Promise<void> {
  switch (action.type) {
    case "color":
      selectedColor = action.color;
      return;
    case "highlight":
      await createRecordFromSelection(readCurrentSelection());
      return;
    case "sentence-highlight":
      await createRecordFromSelection(readCurrentSentenceSelection());
      return;
    case "image":
      startImageMode();
      return;
    case "screenshot":
      startScreenshotMode();
      return;
  }
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

async function restorePageHighlights(): Promise<void> {
  const response = await sendMessage<PageRecordsResponse>({
    type: "records.for-page",
    url: location.href
  });

  if (!response.ok) {
    return;
  }

  for (const record of response.records) {
    renderTextHighlightIfNeeded(record);
  }
}

function renderTextHighlightIfNeeded(record: AnnotationRecord): boolean {
  if (record.target.type !== "text" || hasRenderedRecord(record.id)) {
    return false;
  }

  return renderTextHighlight(record);
}

function hasRenderedRecord(recordId: string): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-omni-record-id]")).some(
    (element) => element.dataset.omniRecordId === recordId
  );
}

function updateToolbarForSelection(): void {
  const selection = globalThis.getSelection?.();
  if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
    toolbar.show();
  } else {
    toolbar.hide();
  }
}

function startImageMode(): void {
  stopImagePickMode?.();
  showCaptureToast("Click an image to save it", "info", { autoHide: false });
  stopImagePickMode = startImagePickMode((image) => {
    stopImagePickMode = undefined;
    void (async () => {
      const response = await sendMessage<MessageResponse>({
        type: "record.create-from-image",
        ...image,
        page: currentPagePayload()
      });
      showCaptureToast(response.ok ? "Image saved" : "Image save failed", response.ok ? "success" : "error");
    })().catch(() => {
      showCaptureToast("Image save failed", "error");
    });
  });
}

function startScreenshotMode(): void {
  startScreenshotOverlay((rect) => {
    void (async () => {
      const wasToolbarVisible = toolbar.hide();

      try {
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
      } finally {
        toolbar.restore(wasToolbarVisible);
      }
    })().catch(() => {
      showCaptureToast("Screenshot save failed", "error");
    });
  });
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
    window.open(chrome.runtime.getURL("src/pages/library.html"), "_blank", "noopener");
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
