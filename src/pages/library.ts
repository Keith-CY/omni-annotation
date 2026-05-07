import { createRecordStore, type RecordStore } from "../shared/idb";
import { searchRecords } from "../shared/search";
import type { AnnotationColor, AnnotationRecord } from "../shared/types";
import { clear, el } from "../ui/dom";

const app = document.querySelector<HTMLElement>("#app");
const navItems = ["Inbox", "All Records", "Pages", "Collections", "Gallery", "Review", "Sync", "Settings"];
const activeNavItem = "All Records";
const editableColors: AnnotationColor[] = ["yellow", "green", "pink", "purple", "cyan"];

let store: RecordStore;
let records: AnnotationRecord[] = [];
let filteredRecords: AnnotationRecord[] = [];
let selectedId: string | undefined;
let query = "";
let recordListBody: HTMLElement | undefined;
let inspectorBody: HTMLElement | undefined;

void init().catch((error: unknown) => {
  renderError(error);
});

async function init(): Promise<void> {
  if (!app) {
    return;
  }

  store = await createRecordStore();
  records = sortRecords(await store.listRecords());
  filteredRecords = records;
  selectedId = records[0]?.id;
  render();
}

function render(): void {
  if (!app) {
    return;
  }

  const selected = filteredRecords.find((record) => record.id === selectedId) ?? filteredRecords[0];
  selectedId = selected?.id;

  clear(app);
  app.append(
    el("section", { className: "app-shell" }, [
      renderSidebar(),
      renderRecordListPanel(),
      renderInspectorPanel(selected)
    ])
  );
}

function renderSidebar(): HTMLElement {
  return el("aside", { className: "panel panel-muted" }, [
    el("div", { className: "panel-inner" }, [
      el("div", { className: "title-block" }, [el("h1", {}, ["Library"]), el("p", { className: "subtle" }, ["Local records"])]),
      el(
        "nav",
        { className: "nav-list", "aria-label": "Library sections" },
        navItems.map((item) => (item === activeNavItem ? renderActiveNavItem(item) : renderPlannedNavItem(item)))
      )
    ])
  ]);
}

function renderActiveNavItem(item: string): HTMLElement {
  return el("button", { className: "nav-item active", type: "button" }, [item]);
}

function renderPlannedNavItem(item: string): HTMLElement {
  return el("div", { className: "nav-item nav-item-planned", "aria-disabled": "true" }, [
    el("span", {}, [item]),
    el("span", { className: "planned-label" }, ["Planned"])
  ]);
}

function renderDynamicPanels(): void {
  const selected = filteredRecords.find((record) => record.id === selectedId) ?? filteredRecords[0];
  selectedId = selected?.id;

  if (recordListBody) {
    clear(recordListBody);
    recordListBody.append(renderRecordListContent());
  }

  if (inspectorBody) {
    clear(inspectorBody);
    inspectorBody.append(renderInspectorContent(selected));
  }
}

function renderRecordListPanel(): HTMLElement {
  const searchInput = el("input", {
    "aria-label": "Search records",
    type: "search",
    placeholder: "Search records",
    value: query,
    oninput: (event) => {
      query = (event.target as HTMLInputElement).value;
      filteredRecords = sortRecords(searchRecords(records, query));
      selectedId = filteredRecords[0]?.id;
      renderDynamicPanels();
    }
  });
  recordListBody = el("div", { className: "record-list-region" }, [renderRecordListContent()]);

  return el("section", { className: "panel" }, [
    el("div", { className: "panel-inner" }, [
      searchInput,
      recordListBody
    ])
  ]);
}

function renderRecordListContent(): HTMLElement {
  return el("div", { className: "detail-list" }, [
    el("div", { className: "toolbar-row" }, [
      el("div", { className: "title-block" }, [
        el("h2", {}, ["All Records"]),
        el("p", { className: "subtle" }, [`${filteredRecords.length} of ${records.length}`])
      ]),
      el("span", { className: "count-pill" }, [String(filteredRecords.length)])
    ]),
    filteredRecords.length > 0
      ? el("div", { className: "record-list" }, filteredRecords.map((record) => renderSelectableRow(record)))
      : el("div", { className: "empty-state" }, [query ? "No records match this search." : "No local records yet."])
  ]);
}

function renderSelectableRow(record: AnnotationRecord): HTMLElement {
  return el(
    "button",
    {
      className: `record-row ${record.id === selectedId ? "selected" : ""}`,
      type: "button",
      onclick: () => {
        selectedId = record.id;
        renderDynamicPanels();
      }
    },
    [
      el("span", { className: `swatch ${record.color ?? ""}`, "aria-hidden": "true" }),
      el("div", { className: "record-main" }, [
        el("div", { className: "record-title" }, [recordHeading(record)]),
        el("div", { className: "record-meta" }, [record.domain || record.url])
      ])
    ]
  );
}

function renderInspectorPanel(record: AnnotationRecord | undefined): HTMLElement {
  inspectorBody = el("div", { className: "panel-inner" }, [renderInspectorContent(record)]);
  return el("section", { className: "panel" }, [inspectorBody]);
}

function renderInspectorContent(record: AnnotationRecord | undefined): HTMLElement {
  if (!record) {
    return el("div", { className: "detail-list" }, [
      el("h2", {}, ["Inspector"]),
      el("div", { className: "empty-state" }, ["Select a record to inspect it."])
    ]);
  }

  const note = el("textarea", {
    "aria-label": "Record note",
    onblur: (event) => {
      void saveNote(record, (event.target as HTMLTextAreaElement).value);
    }
  }, [record.note]);
  const tagInput = el("input", {
    "aria-label": "Record tags",
    type: "text",
    value: record.tags.join(", "),
    placeholder: "tag-one, tag-two",
    onblur: (event) => {
      void saveTags(record, (event.target as HTMLInputElement).value);
    }
  });

  return el("div", { className: "detail-list" }, [
      el("div", { className: "detail-heading" }, [
        el("span", { className: `status-pill ${record.sync.status === "flushed" ? "ok" : ""}` }, [record.sync.status]),
        el("div", { className: "detail-title" }, [record.title || record.domain || "Untitled record"]),
        el("p", { className: "subtle" }, [record.url])
      ]),
      detailField("Kind", kindLabel(record.kind)),
      detailField("Created", formatDate(record.createdAt)),
      renderTargetDetails(record),
      ...(record.color ? [renderColorEditor(record)] : []),
      el("div", { className: "detail-field" }, [el("label", {}, ["Note"]), note]),
      el("div", { className: "detail-field" }, [
        el("label", {}, ["Tags"]),
        tagInput
      ]),
      detailField("Sync file", record.sync.filePath ?? "Not flushed")
  ]);
}

function renderColorEditor(record: AnnotationRecord): HTMLElement {
  return el("div", { className: "detail-field" }, [
    el("label", {}, ["Color"]),
    el(
      "div",
      { className: "color-swatch-row", role: "group", "aria-label": "Record color" },
      editableColors.map((color) => {
        const isSelected = record.color === color;
        return el(
          "button",
          {
            className: `color-swatch-button ${color} ${isSelected ? "selected" : ""}`,
            type: "button",
            "aria-label": `Set color ${color}`,
            "aria-pressed": isSelected ? "true" : "false",
            "aria-current": isSelected ? "true" : undefined,
            onclick: () => {
              void saveColor(record, color);
            }
          },
          []
        );
      })
    )
  ]);
}

function renderTargetDetails(record: AnnotationRecord): HTMLElement {
  switch (record.target.type) {
    case "text":
      return detailField("Quote", record.target.quote);
    case "image":
      return el("div", { className: "detail-list" }, [
        detailField("Image source", record.target.sourceUrl),
        ...(record.target.assetPath ? [detailField("Asset", record.target.assetPath)] : []),
        el("img", { className: "asset-preview", src: record.target.sourceUrl, alt: record.target.altText ?? "Captured image" })
      ]);
    case "screenshot":
      return el("div", { className: "detail-list" }, [
        detailField("Screenshot asset", record.target.assetPath),
        detailField(
          "Viewport",
          `${Math.round(record.target.viewportRect.width)} x ${Math.round(record.target.viewportRect.height)} @ ${record.target.devicePixelRatio}x`
        )
      ]);
    case "page":
      return detailField("Page", record.url);
  }
}

function detailField(label: string, value: string): HTMLElement {
  return el("div", { className: "detail-field" }, [
    el("label", {}, [label]),
    el("p", {}, [value || "None"])
  ]);
}

async function saveNote(record: AnnotationRecord, note: string): Promise<void> {
  if (note === record.note) {
    return;
  }

  await saveRecordMetadata({ ...record, note });
}

async function saveColor(record: AnnotationRecord, color: AnnotationColor): Promise<void> {
  if (color === record.color) {
    return;
  }

  await saveRecordMetadata({ ...record, color });
}

async function saveTags(record: AnnotationRecord, rawTags: string): Promise<void> {
  const tags = parseTags(rawTags);
  if (arraysEqual(tags, record.tags)) {
    return;
  }

  await saveRecordMetadata({ ...record, tags });
}

async function saveRecordMetadata(record: AnnotationRecord): Promise<void> {
  const updated: AnnotationRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
    sync: record.sync.status === "flushed" ? { ...record.sync, status: "pending" } : record.sync
  };
  await store.putRecord(updated);
  records = records.map((item) => (item.id === updated.id ? updated : item));
  filteredRecords = sortRecords(searchRecords(records, query));
  selectedId = updated.id;
  renderDynamicPanels();
}

function parseTags(rawTags: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const tag of rawTags.split(",")) {
    const normalized = tag.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tags.push(normalized);
  }

  return tags;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function recordHeading(record: AnnotationRecord): string {
  if (record.target.type === "text") {
    return record.target.quote;
  }

  if (record.note.trim()) {
    return record.note.trim();
  }

  return record.title || kindLabel(record.kind);
}

function kindLabel(kind: AnnotationRecord["kind"]): string {
  switch (kind) {
    case "page-note":
      return "Page note";
    case "screenshot":
      return "Screenshot";
    case "image":
      return "Image";
    case "text":
      return "Text";
  }
}

function sortRecords(items: AnnotationRecord[]): AnnotationRecord[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderError(error: unknown): void {
  if (!app) {
    return;
  }

  const message = error instanceof Error ? error.message : "Unable to load the library.";
  clear(app);
  app.append(
    el("section", { className: "app-shell compact" }, [
      el("div", { className: "panel" }, [
        el("div", { className: "panel-inner" }, [
          el("h1", {}, ["Library"]),
          el("div", { className: "message" }, [message])
        ])
      ])
    ])
  );
}

export {};
