import { installHighlightStyles, renderTextHighlight } from "./highlight-layer";
import { startImagePickMode, type StopImagePickMode } from "./image-picker";
import { readCurrentSelection } from "./selection";
import { cropCaptureDataUrl, startScreenshotOverlay } from "./screenshot-overlay";
import { mountToolbar, type ToolbarAction, type ToolbarController } from "./toolbar";
import type { AnnotationColor, AnnotationRecord } from "../shared/types";

type PagePayload = {
  url: string;
  canonicalUrl?: string;
  title: string;
};

type MessageResponse =
  | { ok: true; id?: string; dataUrl?: string; record?: AnnotationRecord }
  | { ok: false; error: string };

let selectedColor: AnnotationColor = "yellow";
let stopImagePickMode: StopImagePickMode | undefined;
let toolbar: ToolbarController;

installHighlightStyles();
toolbar = mountToolbar((action) => {
  void handleToolbarAction(action).catch(() => undefined);
});
document.addEventListener("selectionchange", updateToolbarForSelection);
document.addEventListener("mouseup", updateToolbarForSelection);

async function handleToolbarAction(action: ToolbarAction): Promise<void> {
  switch (action.type) {
    case "color":
      selectedColor = action.color;
      return;
    case "highlight":
      await createRecordFromSelection();
      return;
    case "image":
      startImageMode();
      return;
    case "screenshot":
      startScreenshotMode();
      return;
  }
}

async function createRecordFromSelection(): Promise<void> {
  const target = readCurrentSelection();
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
    renderTextHighlight(response.record);
  }
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
  stopImagePickMode = startImagePickMode((image) => {
    stopImagePickMode = undefined;
    void sendMessage({
      type: "record.create-from-image",
      ...image,
      page: currentPagePayload()
    }).catch(() => undefined);
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

        await sendMessage({
          type: "record.create-from-screenshot",
          croppedDataUrl,
          rect,
          page: currentPagePayload(),
          devicePixelRatio
        });
      } finally {
        toolbar.restore(wasToolbarVisible);
      }
    })().catch(() => undefined);
  });
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
