import { describe, expect, it } from "bun:test";
import { CONTEXT_MENU_ITEMS, colorMenuId, contextActionForMenuId, contextColorForMenuId } from "../src/background/context-menu";

describe("context menu definitions", () => {
  it("places capture actions under the Omni Annotation parent menu", () => {
    expect(CONTEXT_MENU_ITEMS.map((item) => item.id)).toEqual([
      "omni-annotation-root",
      "omni-annotation-note",
      "omni-annotation-sentence",
      "omni-annotation-sticky-note",
      "omni-annotation-image",
      "omni-annotation-shot",
      "omni-annotation-separator",
      "omni-annotation-color-root",
      "omni-annotation-color-yellow",
      "omni-annotation-color-green",
      "omni-annotation-color-pink",
      "omni-annotation-color-purple",
      "omni-annotation-color-cyan"
    ]);
  });

  it("uses narrow Chrome contexts for actions that need a selection or image", () => {
    expect(CONTEXT_MENU_ITEMS.find((item) => item.id === "omni-annotation-note")?.contexts).toEqual([
      "selection"
    ]);
    expect(CONTEXT_MENU_ITEMS.find((item) => item.id === "omni-annotation-sentence")?.contexts).toEqual([
      "selection"
    ]);
    expect(CONTEXT_MENU_ITEMS.find((item) => item.id === "omni-annotation-image")?.contexts).toEqual(["image"]);
    expect(CONTEXT_MENU_ITEMS.find((item) => item.id === "omni-annotation-sticky-note")?.contexts).toEqual([
      "page",
      "selection",
      "image"
    ]);
  });

  it("maps action and color menu ids back to content-script commands", () => {
    expect(contextActionForMenuId("omni-annotation-note")).toBe("highlight");
    expect(contextActionForMenuId("omni-annotation-sentence")).toBe("sentence-highlight");
    expect(contextActionForMenuId("omni-annotation-sticky-note")).toBe("sticky-note");
    expect(contextActionForMenuId("omni-annotation-shot")).toBe("screenshot");
    expect(contextActionForMenuId("omni-annotation-color-yellow")).toBeUndefined();
    expect(colorMenuId("cyan")).toBe("omni-annotation-color-cyan");
    expect(contextColorForMenuId("omni-annotation-color-purple")).toBe("purple");
    expect(contextColorForMenuId("omni-annotation-note")).toBeUndefined();
  });
});
