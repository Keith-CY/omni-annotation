import { createRecordStore, type RecordStore } from "../shared/idb";
import { searchRecords } from "../shared/search";
import type { AnnotationColor, AnnotationRecord } from "../shared/types";
import { clear, el } from "../ui/dom";

const app = document.querySelector<HTMLElement>("#app");
const navItems = ["Inbox", "All Records", "Pages", "Collections", "Gallery", "Review", "Sync", "Settings"];
const activeNavItem = "All Records";
const editableColors: AnnotationColor[] = ["yellow", "green", "pink", "purple", "cyan"];
const PAGE_SIZE_OPTIONS = [50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

let store: RecordStore;
let records: AnnotationRecord[] = [];
let filteredRecords: AnnotationRecord[] = [];
let selectedId: string | undefined;
let query = "";
let pageIndex = 0;
let pageSize = DEFAULT_PAGE_SIZE;
let recordListBody: HTMLElement | undefined;
let inspectorBody: HTMLElement | undefined;

void init().catch((error: unknown) => {
  renderError(error);
});

async function init(): Promise<void> {
  if (!app) {
    return;
  }

  document.addEventListener("keydown", onLibraryKeyDown);
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

  const selected = selectedRecordForCurrentPage();

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
  const selected = selectedRecordForCurrentPage();

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
      pageIndex = 0;
      selectedId = undefined;
      renderDynamicPanels();
    }
  });
  recordListBody = el("div", { className: "record-list-region" }, [renderRecordListContent()]);

  return el("section", { className: "panel panel-list" }, [
    el("div", { className: "panel-inner" }, [
      searchInput,
      recordListBody
    ])
  ]);
}

function renderRecordListContent(): HTMLElement {
  const pageRecords = recordsForCurrentPage();
  const totalPages = pageCount();
  const currentPage = filteredRecords.length === 0 ? 0 : pageIndex + 1;

  return el("div", { className: "detail-list" }, [
    el("div", { className: "toolbar-row" }, [
      el("div", { className: "title-block" }, [
        el("h2", {}, ["All Records"]),
        el("p", { className: "subtle" }, [`${filteredRecords.length} of ${records.length}`])
      ]),
      el("span", { className: "count-pill" }, [String(filteredRecords.length)])
    ]),
    filteredRecords.length > 0
      ? el("div", { className: "record-list-scroll" }, [
          el("div", { className: "record-list" }, pageRecords.map((record) => renderSelectableRow(record)))
        ])
      : el("div", { className: "empty-state" }, [query ? "No records match this search." : "No local records yet."])
    ,
    filteredRecords.length > 0
      ? renderPagination(totalPages, currentPage)
      : undefined
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
      },
      oncontextmenu: (event) => {
        event.preventDefault();
        selectedId = record.id;
        void deleteRecord(record);
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
  inspectorBody = el("div", { className: "panel-inner panel-inner-scroll" }, [renderInspectorContent(record)]);
  return el("section", { className: "panel panel-inspector" }, [inspectorBody]);
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
        el("p", { className: "subtle" }, [linkToUrl(record.url, "Open page")])
      ]),
      el("div", { className: "toolbar-row" }, [
        el("button", { type: "button", onclick: () => void deleteRecord(record) }, ["Delete"])
      ]),
      detailField("Kind", kindLabel(record.kind)),
      detailField("Created", formatDate(record.createdAt)),
      ...(record.source?.provider === "diigo" ? renderDiigoSourceFields(record) : []),
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

function renderDiigoSourceFields(record: AnnotationRecord): HTMLElement[] {
  if (record.source?.provider !== "diigo") {
    return [];
  }

  const fields: HTMLElement[] = [
    detailField("Imported from", "Diigo")
  ];

  if (record.source.visibility) {
    fields.push(detailField("Visibility", record.source.visibility));
  }
  if (record.source.addedAt) {
    fields.push(detailField("Diigo added", formatDate(record.source.addedAt)));
  }
  if (record.source.lastVisitAt) {
    fields.push(detailField("Diigo last visit", formatDate(record.source.lastVisitAt)));
  }

  return fields;
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
        detailLinkField("Image source", record.target.sourceUrl),
        ...(record.target.assetPath ? [detailField("Asset", record.target.assetPath)] : []),
        el("img", { className: "asset-preview", src: record.target.sourceUrl, alt: record.target.altText ?? "Captured image" })
      ]);
    case "screenshot":
      return el("div", { className: "detail-list" }, [
        detailField("Screenshot asset", record.target.assetPath),
        detailField(
          "Viewport",
          `${Math.round(record.target.viewportRect.width)} x ${Math.round(record.target.viewportRect.height)} @ ${record.target.devicePixelRatio}x`
        ),
        renderScreenshotPreview(record.target.assetPath)
      ]);
    case "page":
      return detailLinkField("Page", record.url);
    case "sticky-note":
      return el("div", { className: "detail-list" }, [
        detailField("Position", `${Math.round(record.target.x)}, ${Math.round(record.target.y)}`),
        detailField("Size", `${Math.round(record.target.width)} x ${Math.round(record.target.height)}`),
        detailField("Sticky text", record.target.text || "None"),
        detailField("Images", String(record.target.images.length))
      ]);
    case "system-selection":
      return el("div", { className: "detail-list" }, [
        detailField("App", record.target.appName),
        detailField("Bundle", record.target.bundleIdentifier || "Unknown"),
        detailField("Window", record.target.windowTitle || "Unknown"),
        detailField("Quote", record.target.quote),
        detailField("Context before", record.target.contextBefore || "None"),
        detailField("Context after", record.target.contextAfter || "None")
      ]);
  }
}

function renderScreenshotPreview(assetPath: string): HTMLElement {
  const container = el("div", { className: "asset-preview-placeholder" }, ["Loading screenshot preview..."]);
  void loadAssetPreview(assetPath, container, "Captured screenshot");
  return container;
}

async function loadAssetPreview(assetPath: string, container: HTMLElement, alt: string): Promise<void> {
  const assetId = assetIdFromPath(assetPath);
  if (!assetId) {
    container.textContent = "Preview is available after local asset replay.";
    return;
  }

  const asset = await store.getAsset(assetId);
  if (!asset) {
    container.textContent = "Preview asset is not in local cache.";
    return;
  }

  const objectUrl = URL.createObjectURL(asset.blob);
  clear(container);
  const image = el("img", { className: "asset-preview", src: objectUrl, alt });
  image.addEventListener("error", () => {
    URL.revokeObjectURL(objectUrl);
  }, { once: true });
  container.append(image);
}

function assetIdFromPath(assetPath: string): string | undefined {
  const filename = assetPath.split("/").at(-1);
  const id = filename?.split(".")[0];
  return id || undefined;
}

function detailField(label: string, value: string): HTMLElement {
  return el("div", { className: "detail-field" }, [
    el("label", {}, [label]),
    el("p", {}, [value || "None"])
  ]);
}

function detailLinkField(label: string, url: string): HTMLElement {
  if (!isHttpUrl(url)) {
    return detailField(label, url);
  }

  return el("div", { className: "detail-field" }, [
    el("label", {}, [label]),
    el("p", {}, [linkToUrl(url, `Open ${label.toLowerCase()}`)])
  ]);
}

function linkToUrl(url: string, ariaLabel: string): HTMLElement | string {
  if (!isHttpUrl(url)) {
    return url;
  }

  return el("a", {
    href: url,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": ariaLabel
  }, [url]);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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

async function deleteRecord(record: AnnotationRecord): Promise<void> {
  const confirmed = globalThis.confirm?.("Delete this record?");
  if (!confirmed) {
    return;
  }

  await store.deleteRecord(record.id);
  records = records.filter((item) => item.id !== record.id);
  filteredRecords = sortRecords(searchRecords(records, query));
  selectedId = undefined;
  renderDynamicPanels();
}

function onLibraryKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Delete" && event.key !== "Backspace") {
    return;
  }
  if (isEditableTarget(event.target)) {
    return;
  }
  const record = records.find((item) => item.id === selectedId);
  if (!record) {
    return;
  }

  event.preventDefault();
  void deleteRecord(record);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  const editable = target.closest("[contenteditable]");
  return editable instanceof HTMLElement && editable.contentEditable !== "false";
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
  if (record.target.type === "sticky-note" && record.target.text.trim()) {
    return record.target.text.trim();
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

function sortRecords(items: AnnotationRecord[]): AnnotationRecord[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function selectedRecordForCurrentPage(): AnnotationRecord | undefined {
  const pageRecords = recordsForCurrentPage();
  const selected = pageRecords.find((record) => record.id === selectedId) ?? pageRecords[0];
  selectedId = selected?.id;
  return selected;
}

function recordsForCurrentPage(): AnnotationRecord[] {
  clampPageIndex();
  if (filteredRecords.length === 0) {
    return [];
  }
  const start = pageIndex * pageSize;
  return filteredRecords.slice(start, start + pageSize);
}

function pageCount(): number {
  return Math.max(1, Math.ceil(filteredRecords.length / pageSize));
}

function clampPageIndex(): void {
  const totalPages = pageCount();
  if (pageIndex < 0) {
    pageIndex = 0;
    return;
  }
  if (pageIndex >= totalPages) {
    pageIndex = totalPages - 1;
  }
}

function renderPagination(totalPages: number, currentPage: number): HTMLElement {
  const prevDisabled = pageIndex <= 0;
  const nextDisabled = pageIndex >= totalPages - 1;

  const sizeSelect = el(
    "select",
    {
      "aria-label": "Records per page",
      onchange: (event) => {
        const nextSize = Number((event.target as HTMLSelectElement).value);
        if (!Number.isFinite(nextSize) || nextSize <= 0 || nextSize === pageSize) {
          return;
        }
        pageSize = nextSize;
        pageIndex = 0;
        selectedId = undefined;
        renderDynamicPanels();
      }
    },
    PAGE_SIZE_OPTIONS.map((size) =>
      el("option", { value: String(size), ...(size === pageSize ? { selected: true } : {}) }, [String(size)])
    )
  );

  return el("div", { className: "pagination-row" }, [
    el("div", { className: "pagination-left" }, [
      el("label", { className: "subtle" }, ["Per page"]),
      sizeSelect
    ]),
    el("div", { className: "pagination-controls" }, [
      el(
        "button",
        {
          type: "button",
          ...(prevDisabled ? { disabled: true } : {}),
          onclick: () => {
            if (pageIndex <= 0) {
              return;
            }
            pageIndex -= 1;
            selectedId = undefined;
            renderDynamicPanels();
          }
        },
        ["Prev"]
      ),
      el("span", { className: "subtle" }, [`${currentPage} / ${totalPages}`]),
      el(
        "button",
        {
          type: "button",
          ...(nextDisabled ? { disabled: true } : {}),
          onclick: () => {
            if (pageIndex >= totalPages - 1) {
              return;
            }
            pageIndex += 1;
            selectedId = undefined;
            renderDynamicPanels();
          }
        },
        ["Next"]
      )
    ])
  ]);
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
