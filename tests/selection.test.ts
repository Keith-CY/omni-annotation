import { describe, expect, it } from "bun:test";
import { createTextTargetFromParts } from "../src/content/selection";

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
