import { installHighlightStyles, renderTextHighlight } from "./highlight-layer";
import { startImagePickMode, type StopImagePickMode } from "./image-picker";
import { readCurrentSelection } from "./selection";
import { cropCaptureDataUrl, startScreenshotOverlay } from "./screenshot-overlay";
import { mountToolbar, type ToolbarAction } from "./toolbar";
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

installHighlightStyles();
mountToolbar((action) => {
  void handleToolbarAction(action).catch(() => undefined);
});

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
