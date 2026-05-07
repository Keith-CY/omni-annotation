import { describe, expect, it } from "bun:test";
import { createTextTargetFromParts, cssPathForElement, readCurrentSelection } from "../src/content/selection";

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

type FakeElement = {
  tagName: string;
  nodeType: number;
  parentElement: FakeElement | null;
  previousElementSibling: FakeElement | null;
};

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
