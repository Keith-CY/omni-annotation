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
const INLINE_TEXT_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "font",
  "i",
  "kbd",
  "label",
  "mark",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr"
]);

export type TextContext = {
  prefix: string;
  suffix: string;
};

export type TextRange = {
  start: number;
  end: number;
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
  return readSelectionTarget(false);
}

export function readCurrentSentenceSelection(): TextTarget | undefined {
  return readSelectionTarget(true);
}

export function sentenceRangeForSelection(text: string, start: number, end: number): TextRange | undefined {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > text.length) {
    return undefined;
  }

  if (text.slice(start, end).trim().length === 0) {
    return undefined;
  }

  let sentenceStart = 0;
  for (let index = start - 1; index >= 0; index -= 1) {
    if (isSentenceBoundary(text[index])) {
      sentenceStart = index + 1;
      break;
    }
  }

  let sentenceEnd = text.length;
  let endScanStart = end;
  while (endScanStart > start && isInlineWhitespace(text[endScanStart - 1])) {
    endScanStart -= 1;
  }

  for (let index = Math.max(start, endScanStart - 1); index < text.length; index += 1) {
    const character = text[index];
    if (isNewlineBoundary(character)) {
      sentenceEnd = index;
      break;
    }

    if (isSentenceTerminator(character)) {
      sentenceEnd = index + 1;
      break;
    }
  }

  while (sentenceStart < sentenceEnd && isInlineWhitespace(text[sentenceStart])) {
    sentenceStart += 1;
  }

  while (sentenceEnd > sentenceStart && isInlineWhitespace(text[sentenceEnd - 1])) {
    sentenceEnd -= 1;
  }

  return sentenceStart < sentenceEnd ? { start: sentenceStart, end: sentenceEnd } : undefined;
}

function readSelectionTarget(expandToSentence: boolean): TextTarget | undefined {
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

  const targetElement = expandToSentence ? sentenceRootForElement(commonElement) : commonElement;
  const offsets = rangeOffsetsInElement(targetElement, range);
  const text = targetElement.textContent ?? "";
  const context = offsets ? textContextForRange(text, offsets.start, offsets.end) : undefined;
  if (expandToSentence && offsets) {
    const sentenceRange = sentenceRangeForSelection(text, offsets.start, offsets.end);
    const sentenceQuote = sentenceRange ? text.slice(sentenceRange.start, sentenceRange.end) : "";
    if (sentenceRange && sentenceQuote.trim().length > 0) {
      const sentenceContext = textContextForRange(text, sentenceRange.start, sentenceRange.end);
      return createTextTargetFromParts({
        quote: sentenceQuote,
        prefix: sentenceContext.prefix,
        suffix: sentenceContext.suffix,
        startOffset: sentenceRange.start,
        endOffset: sentenceRange.end,
        cssPath: cssPathForElement(targetElement)
      });
    }
  }

  return createTextTargetFromParts({
    quote,
    prefix: context?.prefix ?? "",
    suffix: context?.suffix ?? "",
    startOffset: offsets?.start ?? range.startOffset,
    endOffset: offsets?.end ?? range.endOffset,
    cssPath: cssPathForElement(targetElement)
  });
}

function sentenceRootForElement(element: Element): Element {
  let current = element;

  while (current.parentElement && isInlineTextElement(current)) {
    current = current.parentElement;
  }

  return current;
}

function isInlineTextElement(element: Element): boolean {
  const computedDisplay = computedDisplayForElement(element);
  if (computedDisplay) {
    return computedDisplay === "inline" || computedDisplay === "contents";
  }

  return INLINE_TEXT_TAGS.has(element.tagName.toLowerCase());
}

function computedDisplayForElement(element: Element): string | undefined {
  if (typeof globalThis.getComputedStyle !== "function") {
    return undefined;
  }

  try {
    return globalThis.getComputedStyle(element).display;
  } catch {
    return undefined;
  }
}

function isSentenceBoundary(character: string | undefined): boolean {
  return isNewlineBoundary(character) || isSentenceTerminator(character);
}

function isSentenceTerminator(character: string | undefined): boolean {
  return (
    character === "." ||
    character === "!" ||
    character === "?" ||
    character === "。" ||
    character === "！" ||
    character === "？"
  );
}

function isNewlineBoundary(character: string | undefined): boolean {
  return character === "\n" || character === "\r";
}

function isInlineWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t";
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
