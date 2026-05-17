import { describe, expect, it } from "bun:test";
import { __testNormalizeForLooseMatch } from "../src/content/highlight-layer";

describe("highlight-layer loose normalization", () => {
  it("normalizes full-width and symbolic variants used in imported Diigo quotes", () => {
    const imported =
      "态射在组合操作下是闭合的。所以如果存在态射f: A => B 和g: B => C，那么范畴中必定存在态射 h: A => C 使得 h = g o f。";
    const pageVariant =
      "态射在组合操作下是闭合的。所以如果存在态射f: A ⇒ B 和g: B ⇒ C，那么范畴中必定存在态射 h: A ⇒ C 使得 h = g ∘ f。";

    expect(__testNormalizeForLooseMatch(imported)).toBe(__testNormalizeForLooseMatch(pageVariant));
  });

  it("normalizes full-width punctuation and spacing differences", () => {
    const imported = "记作：f o (g o h) = (f o g) o h";
    const pageVariant = "记作: f　o（g o h）=（f o g）o h";

    expect(__testNormalizeForLooseMatch(imported)).toBe(__testNormalizeForLooseMatch(pageVariant));
  });
});
