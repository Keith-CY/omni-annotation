import type { TextTarget } from "../shared/types";

export type TextTargetParts = {
  quote: string;
  prefix?: string;
  suffix?: string;
  startOffset?: number;
  endOffset?: number;
  cssPath?: string;
};

const CONTEXT_LENGTH = 48;

export function createTextTargetFromParts(parts: TextTargetParts): TextTarget {
  return {
    type: "text",
    quote: parts.quote,
    prefix: parts.prefix ?? "",
    suffix: parts.suffix ?? "",
    ...(parts.startOffset === undefined ? {} : { startOffset: parts.startOffset }),
    ...(parts.endOffset === undefined ? {} : { endOffset: parts.endOffset }),
    ...(parts.cssPath === undefined ? {} : { cssPath: parts.cssPath }),
    locatorConfidence: "exact"
  };
}

export function readCurrentSelection(): TextTarget | undefined {
  const selection = globalThis.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return undefined;
  }

  const quote = selection.toString();
  if (quote.trim().length === 0) {
    return undefined;
  }

  const range = selection.getRangeAt(0);
  const commonElement = elementForNode(range.commonAncestorContainer);
  if (!commonElement) {
    return createTextTargetFromParts({
      quote,
      startOffset: range.startOffset,
      endOffset: range.endOffset
    });
  }

  const text = commonElement.textContent ?? "";
  const selectedIndex = text.indexOf(quote);

  return createTextTargetFromParts({
    quote,
    prefix: selectedIndex >= 0 ? text.slice(Math.max(0, selectedIndex - CONTEXT_LENGTH), selectedIndex) : "",
    suffix:
      selectedIndex >= 0
        ? text.slice(selectedIndex + quote.length, selectedIndex + quote.length + CONTEXT_LENGTH)
        : "",
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    cssPath: cssPathForElement(commonElement)
  });
}

export function cssPathForElement(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tagName = current.tagName.toLowerCase();
    parts.unshift(`${tagName}:nth-of-type(${nthOfType(current)})`);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function elementForNode(node: Node): Element | undefined {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return node as Element;
  }

  return node.parentElement ?? undefined;
}

function nthOfType(element: Element): number {
  let index = 1;
  let sibling = element.previousElementSibling;

  while (sibling) {
    if (sibling.tagName === element.tagName) {
      index += 1;
    }
    sibling = sibling.previousElementSibling;
  }

  return index;
}
