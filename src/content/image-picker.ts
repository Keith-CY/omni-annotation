import { cssPathForElement } from "./selection";

export type PickedImage = {
  sourceUrl: string;
  altText?: string;
  cssPath: string;
};

export type StopImagePickMode = () => void;

export function startImagePickMode(onPick: (image: PickedImage) => void): StopImagePickMode {
  let hovered: HTMLImageElement | undefined;
  let previousOutline = "";
  let stopped = false;

  const clearHover = () => {
    if (hovered) {
      hovered.style.outline = previousOutline;
      hovered = undefined;
      previousOutline = "";
    }
  };

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    clearHover();
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };

  const setHover = (image: HTMLImageElement) => {
    if (hovered === image) {
      return;
    }

    clearHover();
    hovered = image;
    previousOutline = image.style.outline;
    image.style.outline = "2px solid #2563eb";
  };

  const onMouseOver = (event: MouseEvent) => {
    const image = imageFromTarget(event.target);
    if (image) {
      setHover(image);
    }
  };

  const onMouseOut = (event: MouseEvent) => {
    if (hovered && event.target === hovered) {
      clearHover();
    }
  };

  const onClick = (event: MouseEvent) => {
    const image = imageFromTarget(event.target);
    if (!image) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    stop();
    onPick({
      sourceUrl: image.currentSrc || image.src,
      ...(image.alt ? { altText: image.alt } : {}),
      cssPath: cssPathForElement(image)
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      stop();
    }
  };

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  return stop;
}

function imageFromTarget(target: EventTarget | null): HTMLImageElement | undefined {
  return target instanceof HTMLImageElement ? target : undefined;
}
