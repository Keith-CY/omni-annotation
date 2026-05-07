export type ScreenshotRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StopScreenshotOverlay = () => void;

const MIN_SELECTION_SIZE = 4;

export function startScreenshotOverlay(onSelect: (rect: ScreenshotRect) => void): StopScreenshotOverlay {
  const host = document.createElement("div");
  host.id = "omni-annotation-screenshot-overlay";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      cursor: crosshair;
      inset: 0;
      position: fixed;
      z-index: 2147483647;
    }
    .veil {
      background: rgba(15, 23, 42, 0.18);
      height: 100%;
      width: 100%;
    }
    .selection {
      background: rgba(37, 99, 235, 0.14);
      border: 1px solid #2563eb;
      box-sizing: border-box;
      display: none;
      position: fixed;
    }
  `;
  const veil = document.createElement("div");
  veil.className = "veil";
  const selection = document.createElement("div");
  selection.className = "selection";
  shadow.append(style, veil, selection);
  document.documentElement.append(host);

  let startX = 0;
  let startY = 0;
  let active = false;
  let stopped = false;

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("keydown", onKeyDown, true);
    host.remove();
  };

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    active = true;
    startX = clamp(event.clientX, 0, window.innerWidth);
    startY = clamp(event.clientY, 0, window.innerHeight);
    host.setPointerCapture(event.pointerId);
    drawSelection(rectFromPoints(startX, startY, startX, startY), selection);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active) {
      return;
    }

    event.preventDefault();
    drawSelection(rectFromPoints(startX, startY, event.clientX, event.clientY), selection);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!active) {
      return;
    }

    event.preventDefault();
    active = false;
    const rect = rectFromPoints(startX, startY, event.clientX, event.clientY);
    stop();

    if (rect.width >= MIN_SELECTION_SIZE && rect.height >= MIN_SELECTION_SIZE) {
      onSelect(rect);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      stop();
    }
  };

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  document.addEventListener("keydown", onKeyDown, true);

  return stop;
}

export async function cropCaptureDataUrl(
  dataUrl: string,
  rect: ScreenshotRect,
  dpr: number
): Promise<string> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable");
  }

  context.drawImage(
    image,
    Math.round(rect.x * dpr),
    Math.round(rect.y * dpr),
    Math.round(rect.width * dpr),
    Math.round(rect.height * dpr),
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas.toDataURL("image/png");
}

function rectFromPoints(startX: number, startY: number, endX: number, endY: number): ScreenshotRect {
  const clampedStartX = clamp(startX, 0, window.innerWidth);
  const clampedStartY = clamp(startY, 0, window.innerHeight);
  const clampedEndX = clamp(endX, 0, window.innerWidth);
  const clampedEndY = clamp(endY, 0, window.innerHeight);

  return {
    x: Math.min(clampedStartX, clampedEndX),
    y: Math.min(clampedStartY, clampedEndY),
    width: Math.abs(clampedEndX - clampedStartX),
    height: Math.abs(clampedEndY - clampedStartY)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function drawSelection(rect: ScreenshotRect, selection: HTMLElement): void {
  selection.style.display = "block";
  selection.style.left = `${rect.x}px`;
  selection.style.top = `${rect.y}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load captured screenshot"));
    image.src = dataUrl;
  });
}
