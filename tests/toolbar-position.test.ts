import { describe, expect, it } from "bun:test";
import { positionToolbarForSelection } from "../src/content/toolbar-position";

describe("positionToolbarForSelection", () => {
  it("places the toolbar centered above the selected text", () => {
    expect(
      positionToolbarForSelection(
        { left: 100, top: 120, right: 220, bottom: 140, width: 120, height: 20 },
        { width: 90, height: 32 },
        { width: 800, height: 600 }
      )
    ).toEqual({ left: 115, top: 80 });
  });

  it("falls below the selection when there is no room above", () => {
    expect(
      positionToolbarForSelection(
        { left: 20, top: 10, right: 120, bottom: 30, width: 100, height: 20 },
        { width: 140, height: 32 },
        { width: 320, height: 240 }
      )
    ).toEqual({ left: 8, top: 38 });
  });

  it("clamps horizontal position inside the viewport", () => {
    expect(
      positionToolbarForSelection(
        { left: 290, top: 120, right: 310, bottom: 138, width: 20, height: 18 },
        { width: 120, height: 32 },
        { width: 320, height: 240 }
      )
    ).toEqual({ left: 192, top: 80 });
  });
});
