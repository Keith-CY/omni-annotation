import { createRecordStore } from "../shared/idb";
import { pageIdForUrl } from "../shared/page";
import type { AnnotationRecord } from "../shared/types";
import { clear, el } from "../ui/dom";

const app = document.querySelector<HTMLElement>("#app");

void render().catch((error: unknown) => {
  renderError(error);
});

async function render(): Promise<void> {
  if (!app) {
    return;
  }

  const activeTab = await getActiveTab();
  const activePageUrl = activeTab?.url && isWebPageUrl(activeTab.url) ? activeTab.url : undefined;
  const records = activePageUrl ? await recordsForUrl(activePageUrl) : [];

  clear(app);
  app.append(
    el("section", { className: "app-shell compact" }, [
      el("div", { className: "panel" }, [
        el("div", { className: "panel-inner" }, [
          el("div", { className: "toolbar-row" }, [
            el("div", { className: "title-block" }, [
              el("h1", {}, ["Current Page"]),
              el("p", { className: "subtle" }, [activePageUrl ? activeTab?.title || activePageUrl : "No active web page"])
            ]),
            el("span", { className: "count-pill" }, [String(records.length)])
          ]),
          records.length > 0
            ? el("div", { className: "record-list" }, records.map((record) => renderRecordRow(record)))
            : el("div", { className: "empty-state" }, [
                activePageUrl ? "No records for this page yet." : "Open a web page to see its records."
              ])
        ])
      ])
    ])
  );
}

async function getActiveTab(): Promise<ChromeTab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function recordsForUrl(url: string): Promise<AnnotationRecord[]> {
  const store = await createRecordStore();
  return store.listRecordsByPage(pageIdForUrl(url));
}

function isWebPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function renderRecordRow(record: AnnotationRecord): HTMLElement {
  return el("article", { className: "record-row" }, [
    el("span", { className: `swatch ${record.color ?? ""}`, "aria-hidden": "true" }),
    el("div", { className: "record-main" }, [
      el("div", { className: "record-title" }, [recordHeading(record)]),
      el("div", { className: "record-meta" }, [recordMeta(record)])
    ])
  ]);
}

function recordHeading(record: AnnotationRecord): string {
  if (record.target.type === "text") {
    return `${kindLabel(record.kind)}: ${record.target.quote}`;
  }
  if (record.target.type === "sticky-note" && record.target.text.trim()) {
    return `${kindLabel(record.kind)}: ${record.target.text.trim()}`;
  }

  return `${kindLabel(record.kind)}: ${record.title || record.domain}`;
}

function recordMeta(record: AnnotationRecord): string {
  if (record.note.trim()) {
    return record.note.trim();
  }

  if (record.target.type === "image") {
    return record.target.sourceUrl;
  }

  return record.url;
}

function kindLabel(kind: AnnotationRecord["kind"]): string {
  switch (kind) {
    case "page-note":
      return "Page note";
    case "sticky-note":
      return "Sticky note";
    case "system-excerpt":
      return "System excerpt";
    case "screenshot":
      return "Screenshot";
    case "image":
      return "Image";
    case "text":
      return "Text";
    default:
      return "Record";
  }
}

function renderError(error: unknown): void {
  if (!app) {
    return;
  }

  const message = error instanceof Error ? error.message : "Unable to load current page records.";
  clear(app);
  app.append(
    el("section", { className: "app-shell compact" }, [
      el("div", { className: "panel" }, [
        el("div", { className: "panel-inner" }, [
          el("h1", {}, ["Current Page"]),
          el("div", { className: "message" }, [message])
        ])
      ])
    ])
  );
}

export {};
