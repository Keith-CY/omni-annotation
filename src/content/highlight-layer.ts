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
  const quoteIndex = chooseQuoteIndex(fullText, quote, prefix, suffix);
  if (quoteIndex < 0) {
    return undefined;
  }

  const start = nodeOffsetAt(textNodes, quoteIndex);
  const end = nodeOffsetAt(textNodes, quoteIndex + quote.length);
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

function chooseQuoteIndex(text: string, quote: string, prefix: string, suffix: string): number {
  if (quote.length === 0) {
    return -1;
  }

  let bestIndex = -1;
  let bestScore = -1;
  let searchFrom = 0;

  while (searchFrom <= text.length) {
    const index = text.indexOf(quote, searchFrom);
    if (index < 0) {
      break;
    }

    const score =
      contextScore(text.slice(Math.max(0, index - prefix.length), index), prefix, "end") +
      contextScore(text.slice(index + quote.length, index + quote.length + suffix.length), suffix, "start");

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }

    searchFrom = index + Math.max(quote.length, 1);
  }

  return bestIndex;
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
  if (isUnsafeRange(range)) {
    return false;
  }

  try {
    range.surroundContents(mark);
    return true;
  } catch {
    try {
      const contents = range.extractContents();
      mark.append(contents);
      range.insertNode(mark);
      return true;
    } catch {
      return false;
    }
  }
}

function isUnsafeRange(range: Range): boolean {
  const startElement = elementForRangeNode(range.startContainer);
  const endElement = elementForRangeNode(range.endContainer);
  const commonElement = elementForRangeNode(range.commonAncestorContainer);

  return [startElement, endElement, commonElement].some((element) =>
    element ? isUnsafeHighlightElement(element) : true
  );
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
