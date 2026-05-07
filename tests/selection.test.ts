import { describe, expect, it } from "bun:test";
import {
  createTextTargetFromParts,
  cssPathForElement,
  readCurrentSentenceSelection,
  readCurrentSelection,
  sentenceRangeForSelection,
  textContextForRange
} from "../src/content/selection";

describe("createTextTargetFromParts", () => {
  it("creates an exact TextTarget with empty context defaults", () => {
    expect(createTextTargetFromParts({ quote: "selected text" })).toEqual({
      type: "text",
      quote: "selected text",
      prefix: "",
      suffix: "",
      locatorConfidence: "exact"
    });
  });

  it("preserves offsets and css path when provided", () => {
    expect(
      createTextTargetFromParts({
        quote: "world",
        prefix: "hello ",
        suffix: "!",
        startOffset: 6,
        endOffset: 11,
        cssPath: "html:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(2)"
      })
    ).toEqual({
      type: "text",
      quote: "world",
      prefix: "hello ",
      suffix: "!",
      startOffset: 6,
      endOffset: 11,
      cssPath: "html:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(2)",
      locatorConfidence: "exact"
    });
  });
});

describe("cssPathForElement", () => {
  it("creates nth-of-type paths for each ancestor", () => {
    const html = fakeElement("html");
    const body = fakeElement("body", html);
    const firstSection = fakeElement("section", body);
    const secondSection = fakeElement("section", body, firstSection);
    const firstParagraph = fakeElement("p", secondSection);
    const secondParagraph = fakeElement("p", secondSection, firstParagraph);

    withFakeNode(() => {
      expect(cssPathForElement(secondParagraph as unknown as Element)).toBe(
        "html:nth-of-type(1) > body:nth-of-type(1) > section:nth-of-type(2) > p:nth-of-type(2)"
      );
    });
  });
});

describe("readCurrentSelection", () => {
  it("returns undefined when getSelection is unavailable", () => {
    withSelection(undefined, () => {
      expect(readCurrentSelection()).toBeUndefined();
    });
  });

  it("returns undefined for an empty selection", () => {
    withSelection(
      () =>
        ({
          rangeCount: 0,
          isCollapsed: true,
          toString: () => "",
          getRangeAt: () => {
            throw new Error("unexpected range read");
          }
        }) as unknown as Selection,
      () => {
        expect(readCurrentSelection()).toBeUndefined();
      }
    );
  });
});

describe("readCurrentSentenceSelection", () => {
  it("expands through inline siblings to the containing sentence", () => {
    const paragraph = new FakeElementNode("p");
    const strong = new FakeElementNode("strong");
    const selectedText = new FakeTextNode("selected");
    strong.append(selectedText);
    paragraph.append(new FakeTextNode("Hello "), strong, new FakeTextNode(" world."));

    const range = {
      commonAncestorContainer: selectedText,
      startContainer: selectedText,
      startOffset: 0,
      endContainer: selectedText,
      endOffset: selectedText.data.length
    } as unknown as Range;

    withFakeDom(paragraph, () => {
      withSelection(
        () =>
          ({
            rangeCount: 1,
            isCollapsed: false,
            toString: () => selectedText.data,
            getRangeAt: () => range
          }) as unknown as Selection,
        () => {
          expect(readCurrentSentenceSelection()).toEqual({
            type: "text",
            quote: "Hello selected world.",
            prefix: "",
            suffix: "",
            startOffset: 0,
            endOffset: 21,
            cssPath: "p:nth-of-type(1)",
            locatorConfidence: "exact"
          });
        }
      );
    });
  });
});

describe("textContextForRange", () => {
  it("uses the selected repeated occurrence for prefix and suffix", () => {
    const text = "alpha repeat beta repeat gamma";
    const selectedStart = text.lastIndexOf("repeat");
    const selectedEnd = selectedStart + "repeat".length;

    expect(textContextForRange(text, selectedStart, selectedEnd)).toEqual({
      prefix: "alpha repeat beta ",
      suffix: " gamma"
    });
  });
});

describe("sentenceRangeForSelection", () => {
  it("expands a selection to the containing sentence including punctuation", () => {
    const text = "Before. Select the middle words here! After.";
    const start = text.indexOf("middle");
    const end = start + "middle".length;

    const range = sentenceRangeForSelection(text, start, end);

    expect(range ? text.slice(range.start, range.end) : undefined).toBe("Select the middle words here!");
  });

  it("does not expand past selected sentence punctuation", () => {
    const text = "Before. Select the middle words here! After.";
    const start = text.indexOf("Select");
    const end = text.indexOf(" After.");

    const range = sentenceRangeForSelection(text, start, end);

    expect(range ? text.slice(range.start, range.end) : undefined).toBe("Select the middle words here!");
  });

  it("treats newline as a sentence boundary without including it", () => {
    const text = "First line\nSecond line selection\nThird line";
    const start = text.indexOf("selection");
    const end = start + "selection".length;

    const range = sentenceRangeForSelection(text, start, end);

    expect(range ? text.slice(range.start, range.end) : undefined).toBe("Second line selection");
  });

  it("supports CJK sentence terminators", () => {
    const text = "第一句。这里是选中的句子？下一句。";
    const start = text.indexOf("选中");
    const end = start + "选中".length;

    const range = sentenceRangeForSelection(text, start, end);

    expect(range ? text.slice(range.start, range.end) : undefined).toBe("这里是选中的句子？");
  });

  it("returns undefined for invalid or blank selection ranges", () => {
    expect(sentenceRangeForSelection("hello", 3, 3)).toBeUndefined();
    expect(sentenceRangeForSelection("hello", -1, 2)).toBeUndefined();
    expect(sentenceRangeForSelection("hello", 1, 8)).toBeUndefined();
    expect(sentenceRangeForSelection("before   after", 6, 9)).toBeUndefined();
  });
});

type FakeElement = {
  tagName: string;
  nodeType: number;
  parentElement: FakeElement | null;
  previousElementSibling: FakeElement | null;
};

type FakeDomNode = FakeElementNode | FakeTextNode;

class FakeElementNode {
  readonly nodeType = 1;
  readonly childNodes: FakeDomNode[] = [];
  parentElement: FakeElementNode | null = null;
  parentNode: FakeElementNode | null = null;
  previousElementSibling: FakeElementNode | null = null;
  readonly tagName: string;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent ?? "").join("");
  }

  append(...children: FakeDomNode[]): void {
    for (const child of children) {
      child.parentElement = this;
      child.parentNode = this;
      if (child instanceof FakeElementNode) {
        child.previousElementSibling = lastElementChild(this.childNodes);
      }
      this.childNodes.push(child);
    }
  }
}

class FakeTextNode {
  readonly nodeType = 3;
  parentElement: FakeElementNode | null = null;
  parentNode: FakeElementNode | null = null;

  constructor(readonly data: string) {}

  get textContent(): string {
    return this.data;
  }
}

function fakeElement(
  tagName: string,
  parentElement: FakeElement | null = null,
  previousElementSibling: FakeElement | null = null
): FakeElement {
  return {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    parentElement,
    previousElementSibling
  };
}

function withFakeNode(callback: () => void): void {
  const originalNode = globalThis.Node;
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: { ELEMENT_NODE: 1 }
  });

  try {
    callback();
  } finally {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: originalNode
    });
  }
}

function withFakeDom(root: FakeElementNode, callback: () => void): void {
  const originalDocument = globalThis.document;
  const originalNode = globalThis.Node;
  const originalNodeFilter = globalThis.NodeFilter;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createTreeWalker: (treeRoot: FakeElementNode) => fakeTextTreeWalker(treeRoot)
    }
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: { ELEMENT_NODE: 1, TEXT_NODE: 3 }
  });
  Object.defineProperty(globalThis, "NodeFilter", {
    configurable: true,
    value: { SHOW_TEXT: 4 }
  });

  try {
    void root;
    callback();
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument
    });
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: originalNode
    });
    Object.defineProperty(globalThis, "NodeFilter", {
      configurable: true,
      value: originalNodeFilter
    });
  }
}

function fakeTextTreeWalker(root: FakeElementNode): { nextNode: () => FakeTextNode | null } {
  const textNodes: FakeTextNode[] = [];
  collectFakeTextNodes(root, textNodes);
  let index = 0;

  return {
    nextNode: () => textNodes[index++] ?? null
  };
}

function collectFakeTextNodes(node: FakeDomNode, output: FakeTextNode[]): void {
  if (node instanceof FakeTextNode) {
    output.push(node);
    return;
  }

  for (const child of node.childNodes) {
    collectFakeTextNodes(child, output);
  }
}

function lastElementChild(nodes: readonly FakeDomNode[]): FakeElementNode | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node instanceof FakeElementNode) {
      return node;
    }
  }

  return null;
}

function withSelection(getSelection: (() => Selection | null) | undefined, callback: () => void): void {
  const originalGetSelection = globalThis.getSelection;
  Object.defineProperty(globalThis, "getSelection", {
    configurable: true,
    value: getSelection
  });

  try {
    callback();
  } finally {
    Object.defineProperty(globalThis, "getSelection", {
      configurable: true,
      value: originalGetSelection
    });
  }
}
