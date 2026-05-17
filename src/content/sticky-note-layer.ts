import type { AnnotationRecord, StickyImage, StickyNoteTarget } from "../shared/types";

const HOST_ID = "omni-annotation-sticky-layer";
const NOTE_CLASS = "omni-annotation-sticky-note";
const MIN_WIDTH = 160;
const MIN_HEIGHT = 120;
const MAX_WIDTH = 920;
const MAX_HEIGHT = 920;
const COLORS = ["yellow", "green", "pink", "purple", "cyan"] as const;

type StickyMessageResponse =
  | { ok: true; id?: string; dataUrl?: string; record?: AnnotationRecord }
  | { ok: false; error: string };

export function installStickyLayerStyles(): void {
  if (document.getElementById(HOST_ID)) {
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "2147483645";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483645;
      font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .note {
      position: absolute;
      pointer-events: auto;
      border: 1px solid rgba(0, 0, 0, 0.18);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      display: grid;
      grid-template-rows: 26px minmax(56px, 1fr) auto;
      min-width: 160px;
      min-height: 120px;
      overflow: hidden;
      backdrop-filter: blur(2px);
    }
    .note.yellow { background: rgba(255, 238, 160, 0.95); }
    .note.green { background: rgba(200, 245, 209, 0.95); }
    .note.pink { background: rgba(255, 216, 230, 0.95); }
    .note.purple { background: rgba(229, 219, 255, 0.95); }
    .note.cyan { background: rgba(211, 246, 252, 0.95); }

    .header {
      align-items: center;
      display: flex;
      justify-content: space-between;
      padding: 2px 6px;
      cursor: move;
      user-select: none;
      border-bottom: 1px solid rgba(0, 0, 0, 0.12);
    }

    .title {
      color: rgba(0, 0, 0, 0.65);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0;
    }

    .actions {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    button {
      appearance: none;
      border: 1px solid rgba(0, 0, 0, 0.18);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.74);
      color: #1f2937;
      cursor: pointer;
      font: inherit;
      min-height: 20px;
      padding: 2px 6px;
    }
    button:hover { background: #fff; }

    .palette {
      display: flex;
      gap: 3px;
      align-items: center;
    }

    .palette .color {
      width: 16px;
      min-height: 16px;
      height: 16px;
      border-radius: 999px;
      padding: 0;
      border-color: rgba(0, 0, 0, 0.2);
      background: #fff;
    }
    .palette .color.yellow { background: #f4c84a; }
    .palette .color.green { background: #54b875; }
    .palette .color.pink { background: #e9749c; }
    .palette .color.purple { background: #9571d3; }
    .palette .color.cyan { background: #43a9c7; }
    .palette .color[aria-pressed="true"] {
      box-shadow: 0 0 0 2px rgba(17, 24, 39, 0.45);
    }

    .editor {
      border: 0;
      background: transparent;
      color: #111827;
      resize: none;
      font: inherit;
      line-height: 1.45;
      width: 100%;
      min-height: 56px;
      padding: 8px;
      outline: none;
    }

    .images {
      display: grid;
      gap: 6px;
      padding: 0 8px 8px;
      max-height: 260px;
      overflow: auto;
    }

    .images img {
      width: 100%;
      border-radius: 6px;
      border: 1px solid rgba(0, 0, 0, 0.16);
      background: rgba(255, 255, 255, 0.84);
      display: block;
    }

    .resize {
      position: absolute;
      width: 12px;
      height: 12px;
      right: 0;
      bottom: 0;
      cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 35%, rgba(0, 0, 0, 0.28) 35%);
    }

    .note.dragging,
    .note.resizing {
      transition: none;
      user-select: none;
    }
  `;

  const container = document.createElement("div");
  container.className = "container";
  shadow.append(style, container);
  document.documentElement.append(host);
}

export function renderStickyNote(
  record: AnnotationRecord,
  options: {
    onUpdated: (record: AnnotationRecord) => void;
    readAssetDataUrl: (assetId: string) => Promise<string | undefined>;
    sendMessage: <TResponse = StickyMessageResponse>(message: unknown) => Promise<TResponse>;
  }
): boolean {
  if (record.target.type !== "sticky-note") {
    return false;
  }

  const existing = findSticky(record.id);
  if (existing) {
    syncStickyNode(existing, record, options.readAssetDataUrl);
    return true;
  }

  const host = document.getElementById(HOST_ID);
  const root = host?.shadowRoot?.querySelector(".container");
  if (!root) {
    return false;
  }

  const note = document.createElement("div");
  note.className = `${NOTE_CLASS} note ${(record.color ?? "yellow")}`;
  note.dataset.omniRecordId = record.id;
  note.style.left = `${record.target.x}px`;
  note.style.top = `${record.target.y}px`;
  note.style.width = `${record.target.width}px`;
  note.style.height = `${record.target.height}px`;

  const header = document.createElement("div");
  header.className = "header";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = "Sticky";
  const actions = document.createElement("div");
  actions.className = "actions";
  const addImageButton = document.createElement("button");
  addImageButton.type = "button";
  addImageButton.textContent = "Image";
  const palette = document.createElement("div");
  palette.className = "palette";
  const colorButtons = COLORS.map((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `color ${color}`;
    button.title = color;
    button.setAttribute("aria-label", `Set sticky color ${color}`);
    button.setAttribute("data-color", color);
    return button;
  });
  palette.append(...colorButtons);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  actions.append(palette, addImageButton, deleteButton);
  header.append(title, actions);

  const editor = document.createElement("textarea");
  editor.className = "editor";
  editor.value = record.target.text;
  editor.placeholder = "Type note";

  const images = document.createElement("div");
  images.className = "images";

  const resize = document.createElement("div");
  resize.className = "resize";

  note.append(header, editor, images, resize);
  root.append(note);

  void renderStickyImages(record.target.images, images, options.readAssetDataUrl);

  attachStickyDrag(note, header, options);
  attachStickyResize(note, resize, options);
  attachStickyTextEdit(editor, options);
  attachStickyImagePicker(addImageButton, images, options);
  attachStickyDelete(deleteButton, note, options);
  attachStickyColorPicker(colorButtons, note, options);
  return true;
}

function findSticky(recordId: string): HTMLElement | undefined {
  return (
    document
      .getElementById(HOST_ID)
      ?.shadowRoot?.querySelector<HTMLElement>(`.${NOTE_CLASS}[data-omni-record-id="${recordId}"]`) ?? undefined
  );
}

function syncStickyNode(
  node: HTMLElement,
  record: AnnotationRecord,
  readAssetDataUrl: (assetId: string) => Promise<string | undefined>
): void {
  if (record.target.type !== "sticky-note") {
    return;
  }
  syncStickyGeometry(node, record.target);
  syncStickyColor(node, record.color ?? "yellow");

  const editor = node.querySelector<HTMLTextAreaElement>(".editor");
  if (editor && document.activeElement !== editor && editor.value !== record.target.text) {
    editor.value = record.target.text;
  }

  const images = node.querySelector<HTMLElement>(".images");
  if (images) {
    void renderStickyImages(record.target.images, images, readAssetDataUrl);
  }

  syncStickyPalette(node, record.color ?? "yellow");
}

function syncStickyGeometry(node: HTMLElement, target: StickyNoteTarget): void {
  node.style.left = `${target.x}px`;
  node.style.top = `${target.y}px`;
  node.style.width = `${target.width}px`;
  node.style.height = `${target.height}px`;
}

function syncStickyColor(node: HTMLElement, color: string): void {
  node.classList.remove("yellow", "green", "pink", "purple", "cyan");
  node.classList.add(color);
}

async function renderStickyImages(
  source: StickyImage[],
  container: HTMLElement,
  readAssetDataUrl: (assetId: string) => Promise<string | undefined>
): Promise<void> {
  container.textContent = "";
  for (const image of source) {
    const imageElement = document.createElement("img");
    imageElement.alt = "Sticky image";
    const assetId = assetIdFromPath(image.assetPath);
    if (!assetId) {
      continue;
    }
    const dataUrl = await readAssetDataUrl(assetId);
    if (!dataUrl) {
      continue;
    }
    imageElement.src = dataUrl;
    container.append(imageElement);
  }
}

function attachStickyDrag(
  note: HTMLElement,
  handle: HTMLElement,
  options: {
    onUpdated: (record: AnnotationRecord) => void;
    sendMessage: <TResponse = StickyMessageResponse>(message: unknown) => Promise<TResponse>;
  }
): void {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    originLeft = parseFloat(note.style.left || "0");
    originTop = parseFloat(note.style.top || "0");
    note.classList.add("dragging");
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    const nextX = clamp(originLeft + (event.clientX - startX), 0, maxViewportX(note));
    const nextY = clamp(originTop + (event.clientY - startY), 0, maxViewportY(note));
    note.style.left = `${nextX}px`;
    note.style.top = `${nextY}px`;
  });

  const finish = async (event: PointerEvent) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    note.classList.remove("dragging");
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      // ignore release failures
    }

    const response = await options.sendMessage({
      type: "record.update-sticky-note",
      id: stickyRecordId(note),
      rect: {
        x: parseFloat(note.style.left || "0"),
        y: parseFloat(note.style.top || "0"),
        width: parseFloat(note.style.width || "0"),
        height: parseFloat(note.style.height || "0")
      }
    });
    if (response.ok && response.record) {
      options.onUpdated(response.record);
    }
  };

  handle.addEventListener("pointerup", (event) => {
    void finish(event);
  });
  handle.addEventListener("pointercancel", (event) => {
    void finish(event);
  });
}

function attachStickyResize(
  note: HTMLElement,
  handle: HTMLElement,
  options: {
    onUpdated: (record: AnnotationRecord) => void;
    sendMessage: <TResponse = StickyMessageResponse>(message: unknown) => Promise<TResponse>;
  }
): void {
  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    resizing = true;
    startX = event.clientX;
    startY = event.clientY;
    startWidth = parseFloat(note.style.width || "0");
    startHeight = parseFloat(note.style.height || "0");
    note.classList.add("resizing");
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!resizing) {
      return;
    }
    const width = clamp(startWidth + (event.clientX - startX), MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 16));
    const height = clamp(
      startHeight + (event.clientY - startY),
      MIN_HEIGHT,
      Math.min(MAX_HEIGHT, window.innerHeight - 16)
    );
    note.style.width = `${width}px`;
    note.style.height = `${height}px`;
  });

  const finish = async (event: PointerEvent) => {
    if (!resizing) {
      return;
    }
    resizing = false;
    note.classList.remove("resizing");
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      // ignore release failures
    }

    const response = await options.sendMessage({
      type: "record.update-sticky-note",
      id: stickyRecordId(note),
      rect: {
        x: parseFloat(note.style.left || "0"),
        y: parseFloat(note.style.top || "0"),
        width: parseFloat(note.style.width || "0"),
        height: parseFloat(note.style.height || "0")
      }
    });
    if (response.ok && response.record) {
      options.onUpdated(response.record);
    }
  };

  handle.addEventListener("pointerup", (event) => {
    void finish(event);
  });
  handle.addEventListener("pointercancel", (event) => {
    void finish(event);
  });
}

function attachStickyTextEdit(
  editor: HTMLTextAreaElement,
  options: {
    onUpdated: (record: AnnotationRecord) => void;
    sendMessage: <TResponse = StickyMessageResponse>(message: unknown) => Promise<TResponse>;
  }
): void {
  let blurTimer: number | undefined;

  const save = async () => {
    const response = await options.sendMessage({
      type: "record.update-sticky-note",
      id: stickyRecordIdFromEditor(editor),
      text: editor.value
    });
    if (response.ok && response.record) {
      options.onUpdated(response.record);
    }
  };

  editor.addEventListener("input", () => {
    if (blurTimer !== undefined) {
      window.clearTimeout(blurTimer);
    }
    blurTimer = window.setTimeout(() => {
      blurTimer = undefined;
      void save();
    }, 320);
  });
  editor.addEventListener("blur", () => {
    void save();
  });
}

function attachStickyImagePicker(
  button: HTMLButtonElement,
  imagesContainer: HTMLElement,
  options: {
    onUpdated: (record: AnnotationRecord) => void;
    readAssetDataUrl: (assetId: string) => Promise<string | undefined>;
    sendMessage: <TResponse = StickyMessageResponse>(message: unknown) => Promise<TResponse>;
  }
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";
  button.after(input);

  button.addEventListener("click", () => {
    input.click();
  });

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }

    void (async () => {
      const dataUrl = await fileToDataUrl(file);
      const response = await options.sendMessage({
        type: "record.add-sticky-image",
        id: stickyRecordIdFromEditor(button),
        dataUrl
      });
      if (!response.ok || !response.record || response.record.target.type !== "sticky-note") {
        return;
      }
      options.onUpdated(response.record);
      await renderStickyImages(response.record.target.images, imagesContainer, options.readAssetDataUrl);
    })();
  });
}

function attachStickyDelete(
  button: HTMLButtonElement,
  note: HTMLElement,
  options: {
    sendMessage: <TResponse = StickyMessageResponse>(message: unknown) => Promise<TResponse>;
  }
): void {
  button.addEventListener("click", () => {
    const confirmed = globalThis.confirm?.("Delete this sticky note?");
    if (!confirmed) {
      return;
    }
    void (async () => {
      const response = await options.sendMessage({
        type: "record.delete-sticky-note",
        id: stickyRecordId(note)
      });
      if (response.ok) {
        note.remove();
      }
    })();
  });
}

function attachStickyColorPicker(
  buttons: HTMLButtonElement[],
  note: HTMLElement,
  options: {
    onUpdated: (record: AnnotationRecord) => void;
    sendMessage: <TResponse = StickyMessageResponse>(message: unknown) => Promise<TResponse>;
  }
): void {
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const color = button.dataset.color;
      if (!color) {
        return;
      }
      void (async () => {
        const response = await options.sendMessage({
          type: "record.update-sticky-note",
          id: stickyRecordId(note),
          color
        });
        if (response.ok && response.record) {
          options.onUpdated(response.record);
        }
      })();
    });
  }
}

function assetIdFromPath(assetPath: string): string | undefined {
  const filename = assetPath.split("/").at(-1);
  return filename?.split(".")[0];
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("sticky-file-read-failed"));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("sticky-file-read-failed"));
      }
    };
    reader.readAsDataURL(file);
  });
}

function maxViewportX(note: HTMLElement): number {
  const width = parseFloat(note.style.width || "0");
  return Math.max(0, window.innerWidth - width);
}

function maxViewportY(note: HTMLElement): number {
  const height = parseFloat(note.style.height || "0");
  return Math.max(0, window.innerHeight - height);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function stickyRecordId(note: HTMLElement): string {
  return note.dataset.omniRecordId ?? "";
}

function stickyRecordIdFromEditor(node: HTMLElement): string {
  return node.closest<HTMLElement>(`.${NOTE_CLASS}`)?.dataset.omniRecordId ?? "";
}

function syncStickyPalette(note: HTMLElement, color: string): void {
  const buttons = Array.from(note.querySelectorAll<HTMLButtonElement>(".palette .color"));
  for (const button of buttons) {
    button.setAttribute("aria-pressed", button.dataset.color === color ? "true" : "false");
  }
}
