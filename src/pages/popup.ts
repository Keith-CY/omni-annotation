import { clear, el } from "../ui/dom";

const app = document.querySelector<HTMLElement>("#app");
let statusMessage = "";

void render();

function render(): void {
  if (!app) {
    return;
  }

  clear(app);
  app.append(
    el("section", { className: "options-shell" }, [
      el("div", { className: "settings-section" }, [
        el("div", { className: "title-block" }, [
          el("h1", {}, ["Omni Annotation"]),
          el("p", { className: "subtle" }, ["Quick actions"])
        ]),
        el("button", { type: "button", onclick: () => void openLibrary() }, ["Open Library"]),
        statusMessage ? el("div", { className: "message" }, [statusMessage]) : undefined
      ])
    ])
  );
}

async function openLibrary(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "library.open" });
    if (!isObject(response) || response.ok !== true) {
      statusMessage = "Library open failed.";
      render();
      return;
    }
    window.close();
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : "Library open failed.";
    render();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {};
