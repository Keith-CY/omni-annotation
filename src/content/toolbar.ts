import type { AnnotationColor } from "../shared/types";

export type ToolbarAction =
  | { type: "color"; color: AnnotationColor }
  | { type: "highlight" }
  | { type: "image" }
  | { type: "screenshot" };

const COLORS: AnnotationColor[] = ["yellow", "green", "pink", "purple", "cyan"];

export type ToolbarController = {
  element: HTMLElement;
  hide(): boolean;
  restore(wasVisible: boolean): void;
  show(): void;
};

export function mountToolbar(onAction: (action: ToolbarAction) => void): ToolbarController {
  const existing = document.getElementById("omni-annotation-toolbar");
  if (existing) {
    return toolbarController(existing, toolbarBar(existing));
  }

  const host = document.createElement("div");
  host.id = "omni-annotation-toolbar";
  host.style.display = "none";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 2147483646;
      font: 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .bar {
      align-items: center;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(0, 0, 0, 0.14);
      border-radius: 8px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.16);
      display: flex;
      gap: 6px;
      padding: 6px;
      user-select: none;
    }
    button {
      appearance: none;
      border: 1px solid rgba(0, 0, 0, 0.16);
      border-radius: 6px;
      background: #fff;
      color: #1f2937;
      cursor: pointer;
      font: inherit;
      height: 28px;
      min-width: 28px;
      padding: 0 8px;
    }
    button:hover { background: #f3f4f6; }
    .swatch {
      border-radius: 999px;
      min-width: 18px;
      width: 18px;
      height: 18px;
      padding: 0;
    }
    .swatch[aria-pressed="true"] {
      outline: 2px solid #111827;
      outline-offset: 2px;
    }
    .yellow { background: #ffdb4d; }
    .green { background: #54d67f; }
    .pink { background: #ff80ab; }
    .purple { background: #b488ff; }
    .cyan { background: #50d3e6; }
  `;

  const bar = document.createElement("div");
  bar.className = "bar";

  let selectedColor: AnnotationColor = "yellow";
  const swatches = COLORS.map((color) => {
    const button = document.createElement("button");
    button.className = `swatch ${color}`;
    button.type = "button";
    button.title = color;
    button.setAttribute("aria-label", `Use ${color}`);
    button.setAttribute("aria-pressed", color === selectedColor ? "true" : "false");
    button.addEventListener("click", () => {
      selectedColor = color;
      for (const swatch of swatches) {
        swatch.setAttribute("aria-pressed", swatch.title === color ? "true" : "false");
      }
      onAction({ type: "color", color });
    });
    return button;
  });

  const noteButton = createButton("Note", "Create annotation from selected text", () =>
    onAction({ type: "highlight" })
  );
  const imageButton = createButton("Image", "Pick image", () => onAction({ type: "image" }));
  const shotButton = createButton("Shot", "Capture screenshot area", () => onAction({ type: "screenshot" }));

  bar.append(...swatches, noteButton, imageButton, shotButton);
  shadow.append(style, bar);
  document.documentElement.append(host);
  return toolbarController(host, bar);
}

function createButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function toolbarController(element: HTMLElement, bar: HTMLElement | undefined): ToolbarController {
  return {
    element,
    hide() {
      const wasVisible = element.style.display !== "none";
      element.style.display = "none";
      return wasVisible;
    },
    restore(wasVisible) {
      if (wasVisible) {
        element.style.display = "";
      }
    },
    show() {
      element.style.display = "";
      if (bar) {
        bar.hidden = false;
      }
    }
  };
}

function toolbarBar(element: HTMLElement): HTMLElement | undefined {
  return element.shadowRoot?.querySelector<HTMLElement>(".bar") ?? undefined;
}
