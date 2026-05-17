import type { AnnotationColor, AnnotationRecord, TextTarget } from "../shared/types";

const STYLE_ID = "omni-annotation-highlight-styles";
const MARK_CLASS = "omni-annotation-highlight";

export function installHighlightStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${MARK_CLASS} {
      border-radius: 2px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      padding: 0 1px;
    }
    .${MARK_CLASS}-yellow { background: rgba(255, 219, 77, 0.55); }
    .${MARK_CLASS}-green { background: rgba(84, 214, 127, 0.45); }
    .${MARK_CLASS}-pink { background: rgba(255, 128, 171, 0.45); }
    .${MARK_CLASS}-purple { background: rgba(180, 136, 255, 0.45); }
    .${MARK_CLASS}-cyan { background: rgba(80, 211, 230, 0.45); }
  `;
  document.documentElement.append(style);
}

export function renderTextHighlight(record: AnnotationRecord): boolean {
  if (record.target.type !== "text") {
    return false;
  }

  const range = rangeForTextTarget(record.target);
  if (!range) {
    return false;
  }

  const mark = document.createElement("mark");
  const color = record.color ?? "yellow";
  mark.className = `${MARK_CLASS} ${MARK_CLASS}-${color}`;
  mark.dataset.omniRecordId = record.id;
  mark.dataset.omniColor = color;

  return wrapRange(range, mark);
}

function rangeForTextTarget(target: TextTarget): Range | undefined {
  const root = target.cssPath ? document.querySelector(target.cssPath) : document.body;
  if (!root || isUnsafeHighlightElement(root)) {
    return undefined;
  }

  const textNodes = collectTextNodes(root);
  const location = locateQuote(textNodes, target.quote, target.prefix, target.suffix);
  if (!location) {
    return undefined;
  }

  const range = document.createRange();
  range.setStart(location.startNode, location.startOffset);
  range.setEnd(location.endNode, location.endOffset);
  return range;
}

function collectTextNodes(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || isUnsafeHighlightElement(parent)) {
        return NodeFilter.FILTER_REJECT;
      }

      return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes: Text[] = [];
  let current = walker.nextNode();

  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  return nodes;
}

function locateQuote(
  textNodes: Text[],
  quote: string,
  prefix: string,
  suffix: string
): { startNode: Text; startOffset: number; endNode: Text; endOffset: number } | undefined {
  const fullText = textNodes.map((node) => node.data).join("");
  const quoteCandidates = chooseQuoteCandidates(fullText, quote, prefix, suffix);
  for (const quoteIndex of quoteCandidates) {
    const start = nodeOffsetAt(textNodes, quoteIndex);
    const end = nodeOffsetAt(textNodes, quoteIndex + quote.length);
    if (!start || !end) {
      continue;
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (isUnsafeRange(range)) {
      continue;
    }

    return {
      startNode: start.node,
      startOffset: start.offset,
      endNode: end.node,
      endOffset: end.offset
    };
  }

  const normalizedLocation = locateQuoteIgnoringWhitespace(textNodes, quote, prefix, suffix);
  if (normalizedLocation) {
    return normalizedLocation;
  }

  return undefined;
}

function locateQuoteIgnoringWhitespace(
  textNodes: Text[],
  quote: string,
  prefix: string,
  suffix: string
): { startNode: Text; startOffset: number; endNode: Text; endOffset: number } | undefined {
  const normalizedQuote = normalizeForLooseMatch(quote);
  if (normalizedQuote.length === 0) {
    return undefined;
  }

  const fullText = textNodes.map((node) => node.data).join("");
  const mapped = mappedTextForLooseMatch(fullText);
  if (mapped.normalizedText.length === 0) {
    return undefined;
  }

  const normalizedPrefix = normalizeForLooseMatch(prefix);
  const normalizedSuffix = normalizeForLooseMatch(suffix);
  let bestMatch:
    | {
        startSourceOffset: number;
        endSourceOffset: number;
        score: number;
      }
    | undefined;

  let searchFrom = 0;
  while (searchFrom <= mapped.normalizedText.length) {
    const normalizedIndex = mapped.normalizedText.indexOf(normalizedQuote, searchFrom);
    if (normalizedIndex < 0) {
      break;
    }

    const startSourceOffset = mapped.sourceOffsets[normalizedIndex];
    const endSourceOffsetBase = mapped.sourceOffsets[normalizedIndex + normalizedQuote.length - 1];
    if (startSourceOffset === undefined || endSourceOffsetBase === undefined) {
      searchFrom = normalizedIndex + Math.max(normalizedQuote.length, 1);
      continue;
    }
    const endSourceOffset = endSourceOffsetBase + 1;

    const start = nodeOffsetAt(textNodes, startSourceOffset);
    const end = nodeOffsetAt(textNodes, endSourceOffset);
    if (!start || !end) {
      searchFrom = normalizedIndex + Math.max(normalizedQuote.length, 1);
      continue;
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (isUnsafeRange(range)) {
      searchFrom = normalizedIndex + Math.max(normalizedQuote.length, 1);
      continue;
    }

    const score =
      contextScore(
        mapped.normalizedText.slice(Math.max(0, normalizedIndex - normalizedPrefix.length), normalizedIndex),
        normalizedPrefix,
        "end"
      ) +
      contextScore(
        mapped.normalizedText.slice(
          normalizedIndex + normalizedQuote.length,
          normalizedIndex + normalizedQuote.length + normalizedSuffix.length
        ),
        normalizedSuffix,
        "start"
      );

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { startSourceOffset, endSourceOffset, score };
    }

    searchFrom = normalizedIndex + Math.max(normalizedQuote.length, 1);
  }

  if (!bestMatch) {
    return undefined;
  }

  const start = nodeOffsetAt(textNodes, bestMatch.startSourceOffset);
  const end = nodeOffsetAt(textNodes, bestMatch.endSourceOffset);
  if (!start || !end) {
    return undefined;
  }

  return {
    startNode: start.node,
    startOffset: start.offset,
    endNode: end.node,
    endOffset: end.offset
  };
}

function mappedTextForLooseMatch(sourceText: string): { normalizedText: string; sourceOffsets: number[] } {
  let normalizedText = "";
  const sourceOffsets: number[] = [];

  for (let index = 0; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (!char) {
      continue;
    }

    const canonical = canonicalLooseToken(char);
    for (const tokenChar of Array.from(canonical)) {
      if (isWhitespace(tokenChar)) {
        continue;
      }
      normalizedText += tokenChar;
      sourceOffsets.push(index);
    }
  }

  return { normalizedText, sourceOffsets };
}

function normalizeForLooseMatch(text: string): string {
  if (text.length === 0) {
    return "";
  }

  const mapped = mappedTextForLooseMatch(text);
  return mapped.normalizedText;
}

function canonicalLooseToken(char: string): string {
  const fullWidthCode = char.charCodeAt(0);
  if (fullWidthCode === 0x3000) {
    return " ";
  }
  if (fullWidthCode >= 0xff01 && fullWidthCode <= 0xff5e) {
    return String.fromCharCode(fullWidthCode - 0xfee0);
  }

  switch (char) {
    case "⇒":
      return "=>";
    case "→":
      return "->";
    case "∘":
      return "o";
    case "，":
      return ",";
    case "。":
      return ".";
    case "：":
      return ":";
    case "；":
      return ";";
    case "（":
      return "(";
    case "）":
      return ")";
    default:
      return char;
  }
}

function isWhitespace(char: string): boolean {
  return /\s/u.test(char) || char === "\u00a0";
}

export function __testNormalizeForLooseMatch(text: string): string {
  return normalizeForLooseMatch(text);
}

function chooseQuoteCandidates(text: string, quote: string, prefix: string, suffix: string): number[] {
  if (quote.length === 0) {
    return [];
  }

  const candidates: Array<{ index: number; score: number }> = [];
  let searchFrom = 0;

  while (searchFrom <= text.length) {
    const index = text.indexOf(quote, searchFrom);
    if (index < 0) {
      break;
    }

    const score =
      contextScore(text.slice(Math.max(0, index - prefix.length), index), prefix, "end") +
      contextScore(text.slice(index + quote.length, index + quote.length + suffix.length), suffix, "start");
    candidates.push({ index, score });

    searchFrom = index + Math.max(quote.length, 1);
  }

  candidates.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    return left.index - right.index;
  });

  return candidates.map((candidate) => candidate.index);
}

function contextScore(actual: string, expected: string, side: "start" | "end"): number {
  if (expected.length === 0) {
    return 0;
  }

  if (side === "start") {
    let score = 0;
    while (score < actual.length && score < expected.length && actual[score] === expected[score]) {
      score += 1;
    }
    return score;
  }

  let score = 0;
  while (
    score < actual.length &&
    score < expected.length &&
    actual[actual.length - 1 - score] === expected[expected.length - 1 - score]
  ) {
    score += 1;
  }
  return score;
}

function nodeOffsetAt(textNodes: Text[], characterOffset: number): { node: Text; offset: number } | undefined {
  let cursor = 0;

  for (const node of textNodes) {
    const next = cursor + node.data.length;
    if (characterOffset <= next) {
      return { node, offset: characterOffset - cursor };
    }
    cursor = next;
  }

  const last = textNodes.at(-1);
  return last ? { node: last, offset: last.data.length } : undefined;
}

function wrapRange(range: Range, mark: HTMLElement): boolean {
  if (range.collapsed) {
    return false;
  }

  if (isUnsafeRange(range)) {
    return false;
  }

  try {
    range.surroundContents(mark);
    return true;
  } catch {
    return wrapRangeByTextNodes(range, mark);
  }
}

function wrapRangeByTextNodes(range: Range, markTemplate: HTMLElement): boolean {
  const segments = rangeTextSegments(range);
  if (segments.length === 0) {
    return false;
  }

  let wrapped = false;
  for (const segment of segments) {
    const mark = markTemplate.cloneNode(false) as HTMLElement;
    if (wrapTextSegment(segment.node, segment.startOffset, segment.endOffset, mark)) {
      wrapped = true;
    }
  }

  return wrapped;
}

function rangeTextSegments(range: Range): Array<{ node: Text; startOffset: number; endOffset: number }> {
  if (range.startContainer.nodeType !== Node.TEXT_NODE || range.endContainer.nodeType !== Node.TEXT_NODE) {
    return [];
  }

  const startNode = range.startContainer as Text;
  const endNode = range.endContainer as Text;
  const segments: Array<{ node: Text; startOffset: number; endOffset: number }> = [];

  if (startNode === endNode) {
    if (range.startOffset < range.endOffset) {
      segments.push({ node: startNode, startOffset: range.startOffset, endOffset: range.endOffset });
    }
    return segments;
  }

  const commonNode =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;
  if (!commonNode) {
    return segments;
  }

  const walker = document.createTreeWalker(commonNode, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.parentElement || isUnsafeHighlightElement(node.parentElement)) {
        return NodeFilter.FILTER_REJECT;
      }

      return safelyIntersectsNode(range, node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const startOffset = textNode === startNode ? range.startOffset : 0;
    const endOffset = textNode === endNode ? range.endOffset : textNode.data.length;
    if (startOffset < endOffset) {
      segments.push({ node: textNode, startOffset, endOffset });
    }
    current = walker.nextNode();
  }

  return segments;
}

function wrapTextSegment(node: Text, startOffset: number, endOffset: number, mark: HTMLElement): boolean {
  const length = node.data.length;
  const safeStart = clamp(startOffset, 0, length);
  const safeEnd = clamp(endOffset, 0, length);
  if (safeStart >= safeEnd) {
    return false;
  }

  let target = node;
  if (safeStart > 0) {
    target = target.splitText(safeStart);
  }

  const segmentLength = safeEnd - safeStart;
  if (target.data.length > segmentLength) {
    target.splitText(segmentLength);
  }

  const parent = target.parentNode;
  if (!parent || !(parent instanceof Element) || isUnsafeHighlightElement(parent)) {
    return false;
  }

  parent.insertBefore(mark, target);
  mark.append(target);
  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isUnsafeRange(range: Range): boolean {
  const startElement = elementForRangeNode(range.startContainer);
  const endElement = elementForRangeNode(range.endContainer);
  const commonElement = elementForRangeNode(range.commonAncestorContainer);

  if (
    [startElement, endElement, commonElement].some((element) =>
      element ? isUnsafeHighlightElement(element) : true
    )
  ) {
    return true;
  }

  return commonElement ? rangeIntersectsUnsafeDescendant(range, commonElement) : true;
}

function elementForRangeNode(node: Node): Element | undefined {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement ?? undefined;
}

function isUnsafeHighlightElement(element: Element): boolean {
  if (["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA"].includes(element.tagName)) {
    return true;
  }

  if (element.closest(`.${MARK_CLASS}`)) {
    return true;
  }

  const editable = element.closest("[contenteditable]");
  return editable instanceof HTMLElement && editable.contentEditable !== "false";
}

function rangeIntersectsUnsafeDescendant(range: Range, commonElement: Element): boolean {
  const walker = document.createTreeWalker(commonElement, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();

  while (node) {
    const element = node as Element;
    if (isUnsafeHighlightElement(element) && safelyIntersectsNode(range, element)) {
      return true;
    }

    node = walker.nextNode();
  }

  return false;
}

function safelyIntersectsNode(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node);
  } catch {
    return true;
  }
}
