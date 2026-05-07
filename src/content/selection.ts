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

export type TextContext = {
  prefix: string;
  suffix: string;
};

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
  const offsets = commonElement ? rangeOffsetsInElement(commonElement, range) : undefined;
  if (!commonElement) {
    return createTextTargetFromParts({
      quote,
      startOffset: range.startOffset,
      endOffset: range.endOffset
    });
  }

  const text = commonElement.textContent ?? "";
  const context = offsets ? textContextForRange(text, offsets.start, offsets.end) : undefined;

  return createTextTargetFromParts({
    quote,
    prefix: context?.prefix ?? "",
    suffix: context?.suffix ?? "",
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    cssPath: cssPathForElement(commonElement)
  });
}

export function textContextForRange(text: string, start: number, end: number): TextContext {
  return {
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH)
  };
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

function rangeOffsetsInElement(element: Element, range: Range): { start: number; end: number } | undefined {
  const start = textOffsetForBoundary(element, range.startContainer, range.startOffset);
  const end = textOffsetForBoundary(element, range.endContainer, range.endOffset);

  if (start === undefined || end === undefined) {
    return undefined;
  }

  return { start, end };
}

function textOffsetForBoundary(root: Element, boundaryNode: Node, boundaryOffset: number): number | undefined {
  if (boundaryNode.nodeType === Node.TEXT_NODE) {
    return textOffsetForTextBoundary(root, boundaryNode as Text, boundaryOffset);
  }

  if (boundaryNode.nodeType === Node.ELEMENT_NODE) {
    return textOffsetForElementBoundary(root, boundaryNode as Element, boundaryOffset);
  }

  return undefined;
}

function textOffsetForTextBoundary(root: Element, boundaryNode: Text, boundaryOffset: number): number | undefined {
  let cursor = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    if (node === boundaryNode) {
      return cursor + boundaryOffset;
    }

    cursor += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }

  return undefined;
}

function textOffsetForElementBoundary(
  root: Element,
  boundaryElement: Element,
  boundaryOffset: number
): number | undefined {
  let cursor = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    if (isTextAfterElementBoundary(node, boundaryElement, boundaryOffset)) {
      return cursor;
    }

    cursor += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }

  return cursor;
}

function isTextAfterElementBoundary(node: Node, boundaryElement: Element, boundaryOffset: number): boolean {
  let current: Node | null = node;
  let childOfBoundary: Node | undefined;

  while (current && current !== boundaryElement) {
    childOfBoundary = current;
    current = current.parentNode;
  }

  if (!childOfBoundary) {
    return false;
  }

  return Array.prototype.indexOf.call(boundaryElement.childNodes, childOfBoundary) >= boundaryOffset;
}
