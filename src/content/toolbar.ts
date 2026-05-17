import type { AnnotationColor } from "../shared/types";
import { positionToolbarForSelection, type SelectionAnchorRect } from "./toolbar-position";

export type ToolbarAction =
  | { type: "color"; color: AnnotationColor }
  | { type: "highlight" }
  | { type: "sentence-highlight" }
  | { type: "image" }
  | { type: "screenshot" }
  | { type: "sticky-note" };

const COLORS: AnnotationColor[] = ["yellow", "green", "pink", "purple", "cyan"];

export type ToolbarController = {
  element: HTMLElement;
  hide(): boolean;
  restore(wasVisible: boolean): void;
  setColor(color: AnnotationColor): void;
  show(anchor: SelectionAnchorRect, color: AnnotationColor): void;
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
      left: 0;
      top: 0;
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
      padding: 6px 7px;
      user-select: none;
    }
    label {
      align-items: center;
      color: #374151;
      display: flex;
      gap: 6px;
      white-space: nowrap;
    }
    select {
      appearance: none;
      border: 1px solid rgba(0, 0, 0, 0.16);
      border-radius: 6px;
      background: #fff;
      color: #1f2937;
      cursor: pointer;
      font: inherit;
      height: 28px;
      min-width: 104px;
      padding: 0 28px 0 8px;
    }
    .select-wrap {
      position: relative;
    }
    .select-wrap::after {
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 5px solid #4b5563;
      content: "";
      pointer-events: none;
      position: absolute;
      right: 10px;
      top: 12px;
    }
  `;

  const bar = document.createElement("div");
  bar.className = "bar";

  const label = document.createElement("label");
  const labelText = document.createElement("span");
  labelText.textContent = "Color";
  const selectWrap = document.createElement("span");
  selectWrap.className = "select-wrap";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Annotation color");
  for (const color of COLORS) {
    const option = document.createElement("option");
    option.value = color;
    option.textContent = colorLabel(color);
    select.append(option);
  }
  select.addEventListener("change", () => {
    if (isColor(select.value)) {
      onAction({ type: "color", color: select.value });
    }
  });
  selectWrap.append(select);
  label.append(labelText, selectWrap);
  bar.append(label);
  shadow.append(style, bar);
  document.documentElement.append(host);
  return toolbarController(host, bar, select);
}

function toolbarController(
  element: HTMLElement,
  bar: HTMLElement | undefined,
  select?: HTMLSelectElement
): ToolbarController {
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
    setColor(color) {
      const colorSelect = select ?? toolbarSelect(element);
      if (colorSelect) {
        colorSelect.value = color;
      }
    },
    show(anchor, color) {
      this.setColor(color);
      element.style.display = "";
      if (bar) {
        bar.hidden = false;
      }
      const toolbarRect = element.getBoundingClientRect();
      const position = positionToolbarForSelection(
        anchor,
        {
          width: toolbarRect.width || 140,
          height: toolbarRect.height || 40
        },
        {
          width: window.innerWidth,
          height: window.innerHeight
        }
      );
      element.style.left = `${position.left}px`;
      element.style.top = `${position.top}px`;
    }
  };
}

function toolbarBar(element: HTMLElement): HTMLElement | undefined {
  return element.shadowRoot?.querySelector<HTMLElement>(".bar") ?? undefined;
}

function toolbarSelect(element: HTMLElement): HTMLSelectElement | undefined {
  return element.shadowRoot?.querySelector<HTMLSelectElement>("select") ?? undefined;
}

function colorLabel(color: AnnotationColor): string {
  return color[0]?.toUpperCase() + color.slice(1);
}

function isColor(value: string): value is AnnotationColor {
  return COLORS.includes(value as AnnotationColor);
}
