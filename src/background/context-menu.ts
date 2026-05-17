import type { AnnotationColor } from "../shared/types";

export type ContextMenuAction = "highlight" | "sentence-highlight" | "image" | "screenshot" | "sticky-note";

export type ContextMenuDefinition = {
  id: string;
  title?: string;
  contexts: ChromeContextMenuContext[];
  parentId?: string;
  type?: "normal" | "separator";
};

const ROOT_MENU_ID = "omni-annotation-root";
const COLOR_ROOT_MENU_ID = "omni-annotation-color-root";
const BROAD_CONTEXTS: ChromeContextMenuContext[] = ["page", "selection", "image"];
const COLORS: AnnotationColor[] = ["yellow", "green", "pink", "purple", "cyan"];

const ACTION_BY_MENU_ID: Record<string, ContextMenuAction> = {
  "omni-annotation-note": "highlight",
  "omni-annotation-sentence": "sentence-highlight",
  "omni-annotation-sticky-note": "sticky-note",
  "omni-annotation-image": "image",
  "omni-annotation-shot": "screenshot"
};

export const CONTEXT_MENU_ITEMS: readonly ContextMenuDefinition[] = [
  {
    id: ROOT_MENU_ID,
    title: "Omni Annotation",
    contexts: BROAD_CONTEXTS
  },
  {
    id: "omni-annotation-note",
    parentId: ROOT_MENU_ID,
    title: "Note",
    contexts: ["selection"]
  },
  {
    id: "omni-annotation-sentence",
    parentId: ROOT_MENU_ID,
    title: "Sentence",
    contexts: ["selection"]
  },
  {
    id: "omni-annotation-sticky-note",
    parentId: ROOT_MENU_ID,
    title: "Sticky note",
    contexts: BROAD_CONTEXTS
  },
  {
    id: "omni-annotation-image",
    parentId: ROOT_MENU_ID,
    title: "Image",
    contexts: ["image"]
  },
  {
    id: "omni-annotation-shot",
    parentId: ROOT_MENU_ID,
    title: "Shot",
    contexts: BROAD_CONTEXTS
  },
  {
    id: "omni-annotation-separator",
    parentId: ROOT_MENU_ID,
    contexts: BROAD_CONTEXTS,
    type: "separator"
  },
  {
    id: COLOR_ROOT_MENU_ID,
    parentId: ROOT_MENU_ID,
    title: "Color",
    contexts: BROAD_CONTEXTS
  },
  ...COLORS.map((color) => ({
    id: colorMenuId(color),
    parentId: COLOR_ROOT_MENU_ID,
    title: colorLabel(color),
    contexts: BROAD_CONTEXTS
  }))
];

export function contextActionForMenuId(menuItemId: string): ContextMenuAction | undefined {
  return ACTION_BY_MENU_ID[menuItemId];
}

export function contextColorForMenuId(menuItemId: string): AnnotationColor | undefined {
  const color = menuItemId.replace("omni-annotation-color-", "");
  return isAnnotationColor(color) ? color : undefined;
}

export function colorMenuId(color: AnnotationColor): string {
  return `omni-annotation-color-${color}`;
}

function colorLabel(color: AnnotationColor): string {
  return color[0]?.toUpperCase() + color.slice(1);
}

function isAnnotationColor(value: string): value is AnnotationColor {
  return COLORS.includes(value as AnnotationColor);
}
