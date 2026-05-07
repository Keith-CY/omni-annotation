# Omni Annotation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-minimized Chrome MV3 extension for webpage text highlights, image capture, screenshot annotations, local library management, and iCloud Drive folder sync.

**Architecture:** The extension uses vanilla TypeScript, browser APIs, and static HTML/CSS. Content scripts own webpage capture and rendering, the service worker owns privileged Chrome API calls, shared modules own storage/search/sync logic, and extension pages render side-panel and library UIs from IndexedDB state.

**Tech Stack:** Bun, TypeScript, Chrome Manifest V3, IndexedDB, File System Access API, Canvas 2D, Shadow DOM, CSS custom properties, `bun test`.

---

## File Structure

- Create: `package.json` - Bun scripts for build, typecheck, and tests.
- Create: `tsconfig.json` - strict TypeScript config for extension source.
- Create: `extension/manifest.json` - MV3 manifest copied into `dist`.
- Create: `extension/icons/icon.svg` - simple local development icon for unpacked extension testing.
- Create: `src/background/service-worker.ts` - message router and `chrome.tabs.captureVisibleTab` owner.
- Create: `src/background/sync-engine.ts` - file-system sync orchestration.
- Create: `src/content/content-script.ts` - content-script entrypoint.
- Create: `src/content/selection.ts` - selected text extraction and target creation.
- Create: `src/content/highlight-layer.ts` - DOM highlight rendering and relocation.
- Create: `src/content/toolbar.ts` - Shadow DOM floating toolbar.
- Create: `src/content/image-picker.ts` - image pick mode.
- Create: `src/content/screenshot-overlay.ts` - visible-region screenshot selection overlay.
- Create: `src/pages/sidepanel.html` - side panel shell.
- Create: `src/pages/sidepanel.ts` - current-page record UI.
- Create: `src/pages/library.html` - full library shell.
- Create: `src/pages/library.ts` - local library UI and routes.
- Create: `src/pages/options.html` - options shell.
- Create: `src/pages/options.ts` - folder/settings UI.
- Create: `src/ui/styles.css` - shared visual system.
- Create: `src/ui/dom.ts` - small DOM helpers for rendering without a framework.
- Create: `src/shared/types.ts` - shared domain model.
- Create: `src/shared/id.ts` - stable id helpers.
- Create: `src/shared/time.ts` - ISO time helpers.
- Create: `src/shared/page.ts` - stable page id and URL helpers.
- Create: `src/shared/events.ts` - event-log schema and reducers.
- Create: `src/shared/idb.ts` - small IndexedDB adapter.
- Create: `src/shared/file-store.ts` - File System Access helpers.
- Create: `src/shared/search.ts` - local search index.
- Create: `src/shared/chrome.d.ts` - minimal Chrome API declarations used by the MVP.
- Create: `tests/events.test.ts` - reducer tests.
- Create: `tests/search.test.ts` - search tests.
- Create: `tests/selection.test.ts` - selector tests with DOM-like fixtures.

## Dependency Guardrails

- Runtime dependencies remain empty in `package.json`.
- Do not add React, Tailwind, Radix, Dexie, MiniSearch, Konva, Fabric, or a router.
- If a dev dependency is added, record why in the commit message.
- Use native elements plus CSS for controls.
- Use inline DOM templates through helper functions rather than JSX.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `extension/manifest.json`
- Create: `extension/icons/icon.svg`
- Create: `src/shared/chrome.d.ts`

- [ ] **Step 1: Write the package manifest**

Create `package.json` with no runtime dependencies:

```json
{
  "name": "omni-annotation",
  "private": true,
  "type": "module",
  "scripts": {
    "clean": "rm -rf dist",
    "build": "bun run clean && bun build src/background/service-worker.ts src/content/content-script.ts src/pages/sidepanel.ts src/pages/library.ts src/pages/options.ts --outdir dist/src --target browser && bun run copy-static",
    "copy-static": "mkdir -p dist && cp -R extension/. dist/ && cp src/pages/*.html dist/src/pages/ && cp src/ui/styles.css dist/src/ui/styles.css",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "devDependencies": {
    "typescript": "^5.9.0"
  },
  "dependencies": {}
}
```

- [ ] **Step 2: Add strict TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": []
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Add MV3 manifest**

Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Omni Annotation",
  "version": "0.1.0",
  "description": "Local-first webpage annotation and browser library.",
  "permissions": ["activeTab", "sidePanel", "storage", "tabs"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "side_panel": {
    "default_path": "src/pages/sidepanel.html"
  },
  "options_page": "src/pages/options.html",
  "action": {
    "default_title": "Omni Annotation"
  },
  "icons": {
    "128": "icons/icon.svg"
  }
}
```

- [ ] **Step 4: Add minimal Chrome API declarations**

Create `src/shared/chrome.d.ts` to avoid a dev dependency on `@types/chrome` in the MVP:

```ts
declare namespace chrome {
  namespace runtime {
    type MessageSender = { tab?: tabs.Tab };
    const onInstalled: { addListener(callback: () => void): void };
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
    function sendMessage<TResponse = unknown>(message: unknown): Promise<TResponse>;
  }

  namespace sidePanel {
    function setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  }

  namespace tabs {
    type Tab = { id?: number; url?: string; title?: string };
    function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    function captureVisibleTab(
      windowId?: number,
      options?: { format?: "png" | "jpeg"; quality?: number }
    ): Promise<string>;
  }
}
```

- [ ] **Step 5: Build**

Run: `bun run build`

Expected: `dist/manifest.json`, bundled JS files, HTML pages, and `dist/src/ui/styles.css` exist.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json extension
git add src/shared/chrome.d.ts src/pages src/ui
git commit -m "chore: scaffold minimal extension"
```

## Task 2: Shared Domain Model and Event Reducer

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/id.ts`
- Create: `src/shared/time.ts`
- Create: `src/shared/page.ts`
- Create: `src/shared/events.ts`
- Create: `tests/events.test.ts`

- [ ] **Step 1: Add shared types**

Create `src/shared/types.ts` with these exported types:

```ts
export type RecordKind = "text" | "image" | "screenshot" | "page-note";
export type AnnotationColor = "yellow" | "green" | "pink" | "purple" | "cyan";
export type SyncStatus = "local" | "pending" | "flushed" | "conflict";

export type TextTarget = {
  type: "text";
  quote: string;
  prefix: string;
  suffix: string;
  startOffset?: number;
  endOffset?: number;
  cssPath?: string;
  locatorConfidence: "exact" | "context" | "manual";
};

export type ImageTarget = {
  type: "image";
  sourceUrl: string;
  assetPath?: string;
  altText?: string;
  cssPath?: string;
};

export type ScreenshotTarget = {
  type: "screenshot";
  assetPath: string;
  viewportRect: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
};

export type PageTarget = { type: "page" };

export type AnnotationTarget = TextTarget | ImageTarget | ScreenshotTarget | PageTarget;

export type AnnotationRecord = {
  id: string;
  kind: RecordKind;
  pageId: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  domain: string;
  createdAt: string;
  updatedAt: string;
  color?: AnnotationColor;
  note: string;
  tags: string[];
  collectionIds: string[];
  review: { enabled: boolean; dueAt?: string };
  target: AnnotationTarget;
  sync: { status: SyncStatus; filePath?: string };
};
```

- [ ] **Step 2: Add event reducer test**

Create `tests/events.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { applyRecordEvent } from "../src/shared/events";
import type { AnnotationRecord } from "../src/shared/types";

const baseRecord: AnnotationRecord = {
  id: "rec_1",
  kind: "text",
  pageId: "page_1",
  url: "https://example.com/a",
  title: "Example",
  domain: "example.com",
  createdAt: "2026-05-07T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z",
  color: "yellow",
  note: "",
  tags: [],
  collectionIds: [],
  review: { enabled: false },
  target: {
    type: "text",
    quote: "hello world",
    prefix: "",
    suffix: "",
    locatorConfidence: "exact"
  },
  sync: { status: "pending" }
};

describe("applyRecordEvent", () => {
  it("creates and updates records by id", () => {
    const created = applyRecordEvent(new Map(), {
      type: "record.created",
      record: baseRecord
    });

    const updated = applyRecordEvent(created, {
      type: "record.updated",
      id: "rec_1",
      updatedAt: "2026-05-07T00:01:00.000Z",
      patch: { note: "important", tags: ["research"] }
    });

    expect(updated.get("rec_1")?.note).toBe("important");
    expect(updated.get("rec_1")?.tags).toEqual(["research"]);
  });
});
```

- [ ] **Step 3: Implement the event reducer**

Create `src/shared/events.ts`:

```ts
import type { AnnotationRecord } from "./types";

export type RecordEvent =
  | { type: "record.created"; record: AnnotationRecord }
  | {
      type: "record.updated";
      id: string;
      updatedAt: string;
      patch: Partial<Pick<AnnotationRecord, "color" | "note" | "tags" | "collectionIds" | "review" | "sync">>;
    }
  | { type: "record.deleted"; id: string; updatedAt: string };

export function applyRecordEvent(
  records: Map<string, AnnotationRecord>,
  event: RecordEvent
): Map<string, AnnotationRecord> {
  const next = new Map(records);
  if (event.type === "record.created") {
    next.set(event.record.id, event.record);
    return next;
  }
  if (event.type === "record.updated") {
    const current = next.get(event.id);
    if (!current) return next;
    next.set(event.id, { ...current, ...event.patch, updatedAt: event.updatedAt });
    return next;
  }
  next.delete(event.id);
  return next;
}

export function serializeEvent(event: RecordEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseEventLine(line: string): RecordEvent {
  const parsed = JSON.parse(line) as RecordEvent;
  if (!("type" in parsed)) throw new Error("Invalid event line: missing type");
  return parsed;
}
```

- [ ] **Step 4: Add id, time, and page helpers**

Create `src/shared/id.ts`:

```ts
export function createId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${body}`;
}
```

Create `src/shared/time.ts`:

```ts
export function nowIso(): string {
  return new Date().toISOString();
}
```

Create `src/shared/page.ts`:

```ts
export function pageIdForUrl(url: string): string {
  const parsed = new URL(url);
  return `page_${parsed.hostname}_${Math.abs(hashString(normalizeUrl(url)))}`;
}

export function domainForUrl(url: string): string {
  return new URL(url).hostname;
}

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/events.test.ts`

Expected: the reducer test passes.

## Task 3: IndexedDB Store

**Files:**
- Create: `src/shared/idb.ts`
- Create: `tests/idb-contract.md`

- [ ] **Step 1: Define the storage interface**

Create the top of `src/shared/idb.ts`:

```ts
import type { AnnotationRecord } from "./types";

const DB_NAME = "omni-annotation";
const DB_VERSION = 1;
const RECORD_STORE = "records";
const META_STORE = "meta";
const ASSET_STORE = "assets";

export type StoredMeta = {
  key: string;
  value: unknown;
};

export type StoredAsset = {
  id: string;
  folder: "screenshots" | "images";
  filename: string;
  blob: Blob;
  createdAt: string;
  syncStatus: "pending" | "flushed";
};

export type RecordStore = {
  putRecord(record: AnnotationRecord): Promise<void>;
  getRecord(id: string): Promise<AnnotationRecord | undefined>;
  listRecords(): Promise<AnnotationRecord[]>;
  listRecordsByPage(pageId: string): Promise<AnnotationRecord[]>;
  deleteRecord(id: string): Promise<void>;
  putAsset(asset: StoredAsset): Promise<void>;
  getAsset(id: string): Promise<StoredAsset | undefined>;
  listPendingAssets(): Promise<StoredAsset[]>;
  setMeta(key: string, value: unknown): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
};
```

- [ ] **Step 2: Implement the database opener**

Append to `src/shared/idb.ts`:

```ts
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORD_STORE)) {
        const records = db.createObjectStore(RECORD_STORE, { keyPath: "id" });
        records.createIndex("pageId", "pageId", { unique: false });
        records.createIndex("domain", "domain", { unique: false });
        records.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        const assets = db.createObjectStore(ASSET_STORE, { keyPath: "id" });
        assets.createIndex("syncStatus", "syncStatus", { unique: false });
        assets.createIndex("folder", "folder", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
```

- [ ] **Step 3: Implement `createRecordStore`**

Append to `src/shared/idb.ts`:

```ts
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function createRecordStore(): Promise<RecordStore> {
  const db = await openDatabase();
  return {
    async putRecord(record) {
      const tx = db.transaction(RECORD_STORE, "readwrite");
      tx.objectStore(RECORD_STORE).put(record);
      await transactionDone(tx);
    },
    async getRecord(id) {
      const tx = db.transaction(RECORD_STORE, "readonly");
      return requestToPromise<AnnotationRecord | undefined>(tx.objectStore(RECORD_STORE).get(id));
    },
    async listRecords() {
      const tx = db.transaction(RECORD_STORE, "readonly");
      return requestToPromise<AnnotationRecord[]>(tx.objectStore(RECORD_STORE).getAll());
    },
    async listRecordsByPage(pageId) {
      const tx = db.transaction(RECORD_STORE, "readonly");
      const index = tx.objectStore(RECORD_STORE).index("pageId");
      return requestToPromise<AnnotationRecord[]>(index.getAll(pageId));
    },
    async deleteRecord(id) {
      const tx = db.transaction(RECORD_STORE, "readwrite");
      tx.objectStore(RECORD_STORE).delete(id);
      await transactionDone(tx);
    },
    async putAsset(asset) {
      const tx = db.transaction(ASSET_STORE, "readwrite");
      tx.objectStore(ASSET_STORE).put(asset);
      await transactionDone(tx);
    },
    async getAsset(id) {
      const tx = db.transaction(ASSET_STORE, "readonly");
      return requestToPromise<StoredAsset | undefined>(tx.objectStore(ASSET_STORE).get(id));
    },
    async listPendingAssets() {
      const tx = db.transaction(ASSET_STORE, "readonly");
      const index = tx.objectStore(ASSET_STORE).index("syncStatus");
      return requestToPromise<StoredAsset[]>(index.getAll("pending"));
    },
    async setMeta(key, value) {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put({ key, value });
      await transactionDone(tx);
    },
    async getMeta(key) {
      const tx = db.transaction(META_STORE, "readonly");
      const result = await requestToPromise<StoredMeta | undefined>(tx.objectStore(META_STORE).get(key));
      return result?.value as unknown;
    }
  };
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
```

- [ ] **Step 4: Document the manual browser check**

Create `tests/idb-contract.md`:

```md
# IndexedDB Manual Contract

1. Load the unpacked extension from `dist`.
2. Open `chrome-extension://<id>/src/pages/library.html`.
3. Run `await import("../shared/idb.js")` from the page console.
4. Verify that `indexedDB.databases()` contains `omni-annotation`.
5. Add one record through the UI after Task 8 and verify it appears in the `records` object store.
```

## Task 4: File System Sync

**Files:**
- Create: `src/shared/file-store.ts`
- Create: `src/background/sync-engine.ts`

- [ ] **Step 1: Add file store helpers**

Create `src/shared/file-store.ts`:

```ts
import { serializeEvent, type RecordEvent } from "./events";

export type OmniDirectory = {
  root: FileSystemDirectoryHandle;
};

export async function ensureDirectory(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

export async function appendEvent(root: FileSystemDirectoryHandle, event: RecordEvent): Promise<void> {
  const dataDir = await ensureDirectory(root, "data");
  const file = await dataDir.getFileHandle("events.jsonl", { create: true });
  const current = await file.getFile();
  const writer = await file.createWritable({ keepExistingData: true });
  await writer.seek(current.size);
  await writer.write(serializeEvent(event));
  await writer.close();
}

export async function writeAsset(
  root: FileSystemDirectoryHandle,
  folder: "screenshots" | "images",
  filename: string,
  blob: Blob
): Promise<string> {
  const assetsDir = await ensureDirectory(root, "assets");
  const targetDir = await ensureDirectory(assetsDir, folder);
  const file = await targetDir.getFileHandle(filename, { create: true });
  const writer = await file.createWritable();
  await writer.write(blob);
  await writer.close();
  return `assets/${folder}/${filename}`;
}
```

- [ ] **Step 2: Add sync engine shell**

Create `src/background/sync-engine.ts`:

```ts
import { appendEvent, writeAsset } from "../shared/file-store";
import type { RecordEvent } from "../shared/events";
import { createRecordStore } from "../shared/idb";

let rootHandle: FileSystemDirectoryHandle | undefined;

export async function setSyncRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  rootHandle = handle;
  const store = await createRecordStore();
  await store.setMeta("syncRootHandle", handle);
  await store.setMeta("folderName", handle.name);
  await store.setMeta("folderConnectedAt", new Date().toISOString());
}

export async function flushEvent(event: RecordEvent): Promise<{ ok: true } | { ok: false; reason: string }> {
  const root = await getRootHandle();
  if (!root) return { ok: false, reason: "folder-not-connected" };
  try {
    await appendEvent(root, event);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "unknown-sync-error" };
  }
}

export async function flushAsset(
  folder: "screenshots" | "images",
  filename: string,
  blob: Blob
): Promise<{ ok: true; assetPath: string } | { ok: false; reason: string }> {
  const root = await getRootHandle();
  if (!root) return { ok: false, reason: "folder-not-connected" };
  try {
    const assetPath = await writeAsset(root, folder, filename, blob);
    return { ok: true, assetPath };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "unknown-asset-sync-error" };
  }
}

async function getRootHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  if (rootHandle) return rootHandle;
  const store = await createRecordStore();
  rootHandle = await store.getMeta<FileSystemDirectoryHandle>("syncRootHandle");
  return rootHandle;
}
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`

Expected: no TypeScript errors in file-store or sync-engine.

## Task 5: Text Selection and Highlight Relocation

**Files:**
- Create: `src/content/selection.ts`
- Create: `src/content/highlight-layer.ts`
- Create: `tests/selection.test.ts`

- [ ] **Step 1: Add text target test**

Create `tests/selection.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createTextTargetFromParts } from "../src/content/selection";

describe("createTextTargetFromParts", () => {
  it("keeps quote context for relocation", () => {
    const target = createTextTargetFromParts({
      quote: "local-first annotation",
      prefix: "Build a ",
      suffix: " tool",
      startOffset: 8,
      endOffset: 30,
      cssPath: "main p:nth-of-type(1)"
    });

    expect(target).toEqual({
      type: "text",
      quote: "local-first annotation",
      prefix: "Build a ",
      suffix: " tool",
      startOffset: 8,
      endOffset: 30,
      cssPath: "main p:nth-of-type(1)",
      locatorConfidence: "exact"
    });
  });
});
```

- [ ] **Step 2: Implement selection target helper**

Create `src/content/selection.ts`:

```ts
import type { TextTarget } from "../shared/types";

export type TextTargetParts = {
  quote: string;
  prefix: string;
  suffix: string;
  startOffset?: number;
  endOffset?: number;
  cssPath?: string;
};

export function createTextTargetFromParts(parts: TextTargetParts): TextTarget {
  return {
    type: "text",
    quote: parts.quote,
    prefix: parts.prefix,
    suffix: parts.suffix,
    startOffset: parts.startOffset,
    endOffset: parts.endOffset,
    cssPath: parts.cssPath,
    locatorConfidence: "exact"
  };
}

export function readCurrentSelection(): TextTarget | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const quote = selection.toString().trim();
  if (!quote) return undefined;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.parentElement;
  return createTextTargetFromParts({
    quote,
    prefix: "",
    suffix: "",
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    cssPath: container ? cssPathForElement(container) : undefined
  });
}

export function cssPathForElement(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    const parent = current.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
    const index = siblings.indexOf(current) + 1;
    segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
    current = parent;
  }
  return segments.join(" > ");
}
```

- [ ] **Step 3: Implement highlight layer skeleton**

Create `src/content/highlight-layer.ts`:

```ts
import type { AnnotationColor, AnnotationRecord, TextTarget } from "../shared/types";

const COLOR_CLASS: Record<AnnotationColor, string> = {
  yellow: "omni-highlight-yellow",
  green: "omni-highlight-green",
  pink: "omni-highlight-pink",
  purple: "omni-highlight-purple",
  cyan: "omni-highlight-cyan"
};

export function installHighlightStyles(): void {
  if (document.getElementById("omni-highlight-style")) return;
  const style = document.createElement("style");
  style.id = "omni-highlight-style";
  style.textContent = `
    .omni-highlight-yellow { background: #ffe066; }
    .omni-highlight-green { background: #a7f3d0; }
    .omni-highlight-pink { background: #fbcfe8; }
    .omni-highlight-purple { background: #ddd6fe; }
    .omni-highlight-cyan { background: #a5f3fc; }
  `;
  document.documentElement.append(style);
}

export function renderTextHighlight(record: AnnotationRecord): boolean {
  if (record.target.type !== "text") return false;
  const target = record.target;
  const range = findRangeForTextTarget(target);
  if (!range) return false;
  const mark = document.createElement("mark");
  mark.dataset.omniRecordId = record.id;
  mark.className = COLOR_CLASS[record.color ?? "yellow"];
  range.surroundContents(mark);
  return true;
}

export function findRangeForTextTarget(target: TextTarget): Range | undefined {
  const root = target.cssPath ? document.querySelector(target.cssPath) : document.body;
  if (!root) return undefined;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    const index = text.indexOf(target.quote);
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + target.quote.length);
      return range;
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/selection.test.ts`

Expected: target creation test passes.

## Task 6: In-Page Toolbar and Content Script

**Files:**
- Create: `src/content/toolbar.ts`
- Create: `src/content/content-script.ts`

- [ ] **Step 1: Create toolbar module**

Create `src/content/toolbar.ts`:

```ts
import type { AnnotationColor } from "../shared/types";

export type ToolbarAction =
  | { type: "highlight"; color: AnnotationColor }
  | { type: "note" }
  | { type: "image-mode" }
  | { type: "screenshot-mode" };

export function mountToolbar(onAction: (action: ToolbarAction) => void): HTMLElement {
  const host = document.createElement("div");
  host.id = "omni-toolbar-host";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { position: fixed; z-index: 2147483647; top: 16px; right: 16px; }
      .bar { display: flex; gap: 6px; padding: 8px; background: white; border: 1px solid #d8dbe0; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.14); }
      button { border: 1px solid #d8dbe0; background: #fff; border-radius: 6px; min-width: 28px; height: 28px; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .swatch { width: 22px; min-width: 22px; border-radius: 999px; }
    </style>
    <div class="bar" role="toolbar" aria-label="Omni Annotation">
      <button class="swatch" data-color="yellow" title="Yellow" style="background:#ffe066"></button>
      <button class="swatch" data-color="green" title="Green" style="background:#a7f3d0"></button>
      <button class="swatch" data-color="pink" title="Pink" style="background:#fbcfe8"></button>
      <button data-action="note" title="Note">Note</button>
      <button data-action="image-mode" title="Pick image">Image</button>
      <button data-action="screenshot-mode" title="Screenshot">Shot</button>
    </div>
  `;
  shadow.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const color = target.dataset.color as AnnotationColor | undefined;
    if (color) onAction({ type: "highlight", color });
    const action = target.dataset.action as ToolbarAction["type"] | undefined;
    if (action === "note" || action === "image-mode" || action === "screenshot-mode") onAction({ type: action });
  });
  document.documentElement.append(host);
  return host;
}
```

- [ ] **Step 2: Wire content script entrypoint**

Create `src/content/content-script.ts`:

```ts
import { installHighlightStyles } from "./highlight-layer";
import { readCurrentSelection } from "./selection";
import { mountToolbar } from "./toolbar";

installHighlightStyles();

mountToolbar((action) => {
  if (action.type === "highlight") {
    const target = readCurrentSelection();
    if (!target) return;
    chrome.runtime.sendMessage({
      type: "record.create-from-selection",
      color: action.color,
      target,
      page: {
        url: location.href,
        title: document.title,
        domain: location.hostname
      }
    });
  }
  if (action.type === "image-mode") {
    chrome.runtime.sendMessage({ type: "image-mode.requested" });
  }
  if (action.type === "screenshot-mode") {
    chrome.runtime.sendMessage({ type: "screenshot-mode.requested" });
  }
});
```

- [ ] **Step 3: Build**

Run: `bun run build`

Expected: `dist/src/content/content-script.js` is generated and referenced by `dist/manifest.json`.

## Task 7: Background Message Router

**Files:**
- Create: `src/background/service-worker.ts`

- [ ] **Step 1: Implement record-create message handling**

Create `src/background/service-worker.ts`:

```ts
import { createId } from "../shared/id";
import { pageIdForUrl } from "../shared/page";
import { nowIso } from "../shared/time";
import { createRecordStore } from "../shared/idb";
import { flushAsset, flushEvent } from "./sync-engine";
import type { AnnotationColor, TextTarget } from "../shared/types";

type CreateSelectionMessage = {
  type: "record.create-from-selection";
  color: AnnotationColor;
  target: TextTarget;
  page: { url: string; title: string; domain: string };
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message: CreateSelectionMessage, _sender, sendResponse) => {
  if (message.type !== "record.create-from-selection") return false;
  void createFromSelection(message).then(sendResponse);
  return true;
});

async function createFromSelection(message: CreateSelectionMessage): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const store = await createRecordStore();
    const now = nowIso();
    const id = createId("rec");
    const record = {
      id,
      kind: "text" as const,
      pageId: pageIdForUrl(message.page.url),
      url: message.page.url,
      title: message.page.title,
      domain: message.page.domain,
      createdAt: now,
      updatedAt: now,
      color: message.color,
      note: "",
      tags: [],
      collectionIds: [],
      review: { enabled: false },
      target: message.target,
      sync: { status: "pending" as const }
    };
    await store.putRecord(record);
    await flushEvent({ type: "record.created", record });
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown-error" };
  }
}
```

- [ ] **Step 2: Build and load**

Run: `bun run build`

Expected: build succeeds. Load `dist` as an unpacked extension in Chrome.

## Task 8: Shared UI Styles and DOM Helpers

**Files:**
- Create: `src/ui/styles.css`
- Create: `src/ui/dom.ts`

- [ ] **Step 1: Add visual system CSS**

Create `src/ui/styles.css`:

```css
:root {
  color-scheme: light;
  --bg: #f7f7f5;
  --surface: #ffffff;
  --text: #1f2328;
  --muted: #6b7280;
  --border: #d8dbe0;
  --accent: #2563eb;
  --yellow: #ffe066;
  --green: #a7f3d0;
  --pink: #fbcfe8;
  --purple: #ddd6fe;
  --cyan: #a5f3fc;
  font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

button, input, textarea, select {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 236px minmax(320px, 440px) minmax(420px, 1fr);
}

.panel {
  background: var(--surface);
  border-right: 1px solid var(--border);
  min-width: 0;
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.record-row {
  display: grid;
  grid-template-columns: 12px 1fr;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, .18);
}
```

- [ ] **Step 2: Add DOM helper**

Create `src/ui/dom.ts`:

```ts
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}
```

## Task 9: Side Panel UI

**Files:**
- Create: `src/pages/sidepanel.html`
- Create: `src/pages/sidepanel.ts`

- [ ] **Step 1: Add side panel HTML**

Create `src/pages/sidepanel.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Omni Annotation</title>
    <link rel="stylesheet" href="../ui/styles.css">
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="./sidepanel.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Render current-page records**

Create `src/pages/sidepanel.ts`:

```ts
import { createRecordStore } from "../shared/idb";
import { pageIdForUrl } from "../shared/page";
import type { AnnotationRecord } from "../shared/types";
import { clear, el } from "../ui/dom";

const app = document.getElementById("app");
if (!app) throw new Error("Missing app root");

void render();

async function render(): Promise<void> {
  const store = await createRecordStore();
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const records = activeTab?.url ? await store.listRecordsByPage(pageIdForUrl(activeTab.url)) : [];
  clear(app);
  app.append(
    el("section", { class: "panel" }, [
      el("div", { class: "toolbar-row" }, [
        el("strong", {}, ["Current Page"]),
        el("span", { "aria-live": "polite" }, [`${records.length} records`])
      ]),
      renderRecordList(records)
    ])
  );
}

function renderRecordList(records: AnnotationRecord[]): HTMLElement {
  const list = el("div", { role: "list" });
  for (const record of records) {
    list.append(
      el("button", { class: "record-row", type: "button" }, [
        el("span", { class: "swatch", style: `background: var(--${record.color ?? "yellow"})` }),
        el("span", {}, [record.target.type === "text" ? record.target.quote : record.title])
      ])
    );
  }
  return list;
}
```

- [ ] **Step 3: Build and inspect**

Run: `bun run build`

Expected: side panel opens from the extension action and renders an empty Current Page state or saved records.

## Task 10: Library UI

**Files:**
- Create: `src/pages/library.html`
- Create: `src/pages/library.ts`

- [ ] **Step 1: Add library HTML**

Create `src/pages/library.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Omni Library</title>
    <link rel="stylesheet" href="../ui/styles.css">
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="./library.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Render three-pane layout**

Create `src/pages/library.ts`:

```ts
import { createRecordStore } from "../shared/idb";
import type { AnnotationRecord } from "../shared/types";
import { clear, el } from "../ui/dom";

const app = document.getElementById("app");
if (!app) throw new Error("Missing app root");

void renderLibrary();

async function renderLibrary(): Promise<void> {
  const store = await createRecordStore();
  const records = await store.listRecords();
  clear(app);
  app.append(
    el("div", { class: "app-shell" }, [
      renderSidebar(),
      renderRecords(records),
      renderInspector(records[0])
    ])
  );
}

function renderSidebar(): HTMLElement {
  const items = ["Inbox", "All Records", "Pages", "Collections", "Gallery", "Review", "Sync", "Settings"];
  return el("nav", { class: "panel", "aria-label": "Library" }, items.map((item) => el("button", { type: "button" }, [item])));
}

function renderRecords(records: AnnotationRecord[]): HTMLElement {
  return el("section", { class: "panel" }, [
    el("div", { class: "toolbar-row" }, [
      el("input", { type: "search", placeholder: "Search records", "aria-label": "Search records" })
    ]),
    ...records.map((record) =>
      el("button", { class: "record-row", type: "button" }, [
        el("span", { class: "swatch", style: `background: var(--${record.color ?? "yellow"})` }),
        el("span", {}, [record.target.type === "text" ? record.target.quote : record.title])
      ])
    )
  ]);
}

function renderInspector(record: AnnotationRecord | undefined): HTMLElement {
  if (!record) return el("aside", { class: "panel" }, [el("div", { class: "toolbar-row" }, ["No record selected"])]);
  return el("aside", { class: "panel" }, [
    el("div", { class: "toolbar-row" }, [el("strong", {}, [record.title])]),
    el("div", { style: "padding:12px" }, [
      el("p", {}, [record.url]),
      el("textarea", { "aria-label": "Note" }, [record.note])
    ])
  ]);
}
```

- [ ] **Step 3: Add manifest access path**

Open `chrome-extension://<id>/src/pages/library.html` after build.

Expected: Library displays sidebar, record list, and detail inspector.

## Task 11: Search Index

**Files:**
- Create: `src/shared/search.ts`
- Create: `tests/search.test.ts`

- [ ] **Step 1: Add search test**

Create `tests/search.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { searchRecords } from "../src/shared/search";
import type { AnnotationRecord } from "../src/shared/types";

const record = {
  id: "rec_1",
  kind: "text",
  pageId: "page_1",
  url: "https://example.com",
  title: "Local research",
  domain: "example.com",
  createdAt: "2026-05-07T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z",
  color: "cyan",
  note: "browser library",
  tags: ["annotation"],
  collectionIds: [],
  review: { enabled: false },
  target: { type: "text", quote: "iCloud sync", prefix: "", suffix: "", locatorConfidence: "exact" },
  sync: { status: "pending" }
} satisfies AnnotationRecord;

describe("searchRecords", () => {
  it("matches title, note, quote, domain, and tags", () => {
    expect(searchRecords([record], "icloud")).toHaveLength(1);
    expect(searchRecords([record], "browser")).toHaveLength(1);
    expect(searchRecords([record], "annotation")).toHaveLength(1);
    expect(searchRecords([record], "missing")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement search**

Create `src/shared/search.ts`:

```ts
import type { AnnotationRecord } from "./types";

export function searchRecords(records: AnnotationRecord[], query: string): AnnotationRecord[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return records;
  return records.filter((record) => {
    const haystack = tokenize(recordToSearchText(record));
    return tokens.every((token) => haystack.some((candidate) => candidate.includes(token)));
  });
}

function recordToSearchText(record: AnnotationRecord): string {
  const targetText =
    record.target.type === "text"
      ? record.target.quote
      : record.target.type === "image"
        ? `${record.target.sourceUrl} ${record.target.altText ?? ""}`
        : record.target.type === "screenshot"
          ? record.target.assetPath
          : "";
  return [record.title, record.url, record.domain, record.note, record.tags.join(" "), targetText].join(" ");
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}
```

- [ ] **Step 3: Run search tests**

Run: `bun test tests/search.test.ts`

Expected: all search tests pass.

## Task 12: Image Pick and Screenshot Capture

**Files:**
- Create: `src/content/image-picker.ts`
- Create: `src/content/screenshot-overlay.ts`
- Modify: `src/content/content-script.ts`
- Modify: `src/background/service-worker.ts`

- [ ] **Step 1: Implement image pick module**

Create `src/content/image-picker.ts`:

```ts
export function startImagePickMode(onPick: (image: HTMLImageElement) => void): () => void {
  function onClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    event.preventDefault();
    event.stopPropagation();
    onPick(target);
    stop();
  }
  function onMove(event: MouseEvent): void {
    document.querySelectorAll("[data-omni-image-hover]").forEach((node) => {
      (node as HTMLElement).style.outline = "";
      delete (node as HTMLElement).dataset.omniImageHover;
    });
    const target = event.target;
    if (target instanceof HTMLImageElement) {
      target.dataset.omniImageHover = "true";
      target.style.outline = "2px solid #2563eb";
    }
  }
  function stop(): void {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousemove", onMove, true);
  }
  document.addEventListener("click", onClick, true);
  document.addEventListener("mousemove", onMove, true);
  return stop;
}
```

- [ ] **Step 2: Implement screenshot overlay module**

Create `src/content/screenshot-overlay.ts`:

```ts
export type ScreenshotRect = { x: number; y: number; width: number; height: number };

export function startScreenshotOverlay(onSelect: (rect: ScreenshotRect) => void): () => void {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:rgba(0,0,0,.18)";
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;border:2px solid #2563eb;background:rgba(37,99,235,.12)";
  overlay.append(box);
  document.documentElement.append(overlay);

  let start: { x: number; y: number } | undefined;

  overlay.addEventListener("pointerdown", (event) => {
    start = { x: event.clientX, y: event.clientY };
  });
  overlay.addEventListener("pointermove", (event) => {
    if (!start) return;
    const rect = normalizeRect(start.x, start.y, event.clientX, event.clientY);
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  });
  overlay.addEventListener("pointerup", (event) => {
    if (!start) return;
    const rect = normalizeRect(start.x, start.y, event.clientX, event.clientY);
    onSelect(rect);
    stop();
  });

  function stop(): void {
    overlay.remove();
  }

  return stop;
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): ScreenshotRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

export async function cropCaptureDataUrl(
  dataUrl: string,
  rect: ScreenshotRect,
  devicePixelRatio: number
): Promise<string> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.drawImage(
    image,
    Math.round(rect.x * devicePixelRatio),
    Math.round(rect.y * devicePixelRatio),
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas.toDataURL("image/png");
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load captured screenshot"));
    image.src = dataUrl;
  });
}
```

- [ ] **Step 3: Wire modules from content script**

Update `src/content/content-script.ts` so image and screenshot actions call these modules:

```ts
import { installHighlightStyles } from "./highlight-layer";
import { startImagePickMode } from "./image-picker";
import { cropCaptureDataUrl, startScreenshotOverlay } from "./screenshot-overlay";
import { readCurrentSelection } from "./selection";
import { mountToolbar } from "./toolbar";

installHighlightStyles();

mountToolbar((action) => {
  if (action.type === "highlight") {
    const target = readCurrentSelection();
    if (!target) return;
    chrome.runtime.sendMessage({
      type: "record.create-from-selection",
      color: action.color,
      target,
      page: { url: location.href, title: document.title, domain: location.hostname }
    });
  }
  if (action.type === "image-mode") {
    startImagePickMode((image) => {
      chrome.runtime.sendMessage({
        type: "record.create-from-image",
        image: {
          sourceUrl: image.currentSrc || image.src,
          altText: image.alt,
          cssPath: ""
        },
        page: { url: location.href, title: document.title, domain: location.hostname }
      });
    });
  }
  if (action.type === "screenshot-mode") {
    startScreenshotOverlay(async (rect) => {
      const response = await chrome.runtime.sendMessage<{ ok: true; dataUrl: string } | { ok: false; error: string }>({
        type: "capture-visible-tab"
      });
      if (!response.ok) return;
      const croppedDataUrl = await cropCaptureDataUrl(response.dataUrl, rect, window.devicePixelRatio);
      await chrome.runtime.sendMessage({
        type: "record.create-from-screenshot",
        croppedDataUrl,
        rect,
        page: { url: location.href, title: document.title, domain: location.hostname },
        devicePixelRatio: window.devicePixelRatio
      });
    });
  }
});
```

- [ ] **Step 4: Add background screenshot and asset handlers**

Extend `src/background/service-worker.ts` with message routing for visible-tab capture, image records, and cropped screenshot records:

```ts
type CaptureVisibleTabMessage = { type: "capture-visible-tab" };
type CreateImageMessage = {
  type: "record.create-from-image";
  image: { sourceUrl: string; altText?: string; cssPath?: string };
  page: { url: string; title: string; domain: string };
};
type CreateScreenshotMessage = {
  type: "record.create-from-screenshot";
  croppedDataUrl: string;
  rect: { x: number; y: number; width: number; height: number };
  page: { url: string; title: string; domain: string };
  devicePixelRatio: number;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const typed = message as CaptureVisibleTabMessage | CreateImageMessage | CreateScreenshotMessage;
  if (typed.type === "capture-visible-tab") {
    void chrome.tabs
      .captureVisibleTab(undefined, { format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (typed.type === "record.create-from-image") {
    void createFromImage(typed).then(sendResponse);
    return true;
  }
  if (typed.type === "record.create-from-screenshot") {
    void createFromScreenshot(typed).then(sendResponse);
    return true;
  }
  return false;
});

async function createFromImage(message: CreateImageMessage): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const store = await createRecordStore();
    const now = nowIso();
    const id = createId("rec");
    const record = {
      id,
      kind: "image" as const,
      pageId: pageIdForUrl(message.page.url),
      url: message.page.url,
      title: message.page.title,
      domain: message.page.domain,
      createdAt: now,
      updatedAt: now,
      note: "",
      tags: [],
      collectionIds: [],
      review: { enabled: false },
      target: { type: "image" as const, ...message.image },
      sync: { status: "pending" as const }
    };
    await store.putRecord(record);
    await flushEvent({ type: "record.created", record });
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown-image-error" };
  }
}

async function createFromScreenshot(message: CreateScreenshotMessage): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const store = await createRecordStore();
    const now = nowIso();
    const id = createId("rec");
    const filename = `${id}.png`;
    const blob = dataUrlToBlob(message.croppedDataUrl);
    await store.putAsset({ id, folder: "screenshots", filename, blob, createdAt: now, syncStatus: "pending" });
    const assetSync = await flushAsset("screenshots", filename, blob);
    const record = {
      id,
      kind: "screenshot" as const,
      pageId: pageIdForUrl(message.page.url),
      url: message.page.url,
      title: message.page.title,
      domain: message.page.domain,
      createdAt: now,
      updatedAt: now,
      note: "",
      tags: [],
      collectionIds: [],
      review: { enabled: false },
      target: {
        type: "screenshot" as const,
        assetPath: assetSync.ok ? assetSync.assetPath : `pending/screenshots/${filename}`,
        viewportRect: message.rect,
        devicePixelRatio: message.devicePixelRatio
      },
      sync: { status: "pending" as const }
    };
    await store.putRecord(record);
    await flushEvent({ type: "record.created", record });
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown-screenshot-error" };
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, body] = dataUrl.split(",");
  if (!header || !body) throw new Error("Invalid data URL");
  const mime = header.match(/data:(.*?);base64/)?.[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}
```

Expected behavior: screenshot capture creates a cropped PNG asset in IndexedDB, tries to flush it to the connected folder, creates a screenshot record, and appends the record event to the local event log when folder permission exists.

## Task 13: Options and Folder Connection

**Files:**
- Create: `src/pages/options.html`
- Create: `src/pages/options.ts`

- [ ] **Step 1: Add options HTML**

Create `src/pages/options.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Omni Settings</title>
    <link rel="stylesheet" href="../ui/styles.css">
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="./options.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Add folder connection UI**

Create `src/pages/options.ts`:

```ts
import { createRecordStore } from "../shared/idb";
import { clear, el } from "../ui/dom";

const app = document.getElementById("app");
if (!app) throw new Error("Missing app root");

void renderOptions();

async function renderOptions(): Promise<void> {
  const store = await createRecordStore();
  const folderName = await store.getMeta<string>("folderName");
  clear(app);
  const button = el("button", { type: "button" }, [folderName ? "Reconnect Folder" : "Connect iCloud Folder"]);
  button.addEventListener("click", async () => {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await store.setMeta("syncRootHandle", handle);
    await store.setMeta("folderName", handle.name);
    await store.setMeta("folderConnectedAt", new Date().toISOString());
    await renderOptions();
  });
  app.append(
    el("section", { style: "max-width:720px;margin:0 auto;padding:24px" }, [
      el("h1", {}, ["Settings"]),
      el("p", {}, [folderName ? `Connected folder: ${folderName}` : "No folder connected"]),
      button
    ])
  );
}
```

- [ ] **Step 3: Manual folder check**

Run: `bun run build`

Expected: opening Options lets the user choose an iCloud Drive folder and stores both the folder handle and folder name in IndexedDB metadata.

## Task 14: Final Verification

**Files:**
- Modify only files needed to fix failures found in this task.

- [ ] **Step 1: Run unit tests**

Run: `bun test`

Expected: all pure logic tests pass.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: no TypeScript errors.

- [ ] **Step 3: Run build**

Run: `bun run build`

Expected: `dist` contains a loadable MV3 extension.

- [ ] **Step 4: Manual Chrome smoke test**

Load `dist` in `chrome://extensions` as an unpacked extension and verify:

- The extension action opens the side panel.
- The Options page opens and connects a local folder.
- A selected text highlight sends a create-record message without console errors.
- Library page opens and shows the three-pane layout.
- Runtime dependency list remains empty in `package.json`.

- [ ] **Step 5: Commit final MVP**

```bash
git status --short
git add package.json tsconfig.json extension src tests
git commit -m "feat: build local-first annotation mvp"
```

## Self-Review

Spec coverage:

- Text and sentence highlight: covered by Tasks 5-7.
- Image selection: covered by Task 12.
- Screenshot highlight/capture: covered by Task 12, including visible-tab capture, content-side crop, IndexedDB asset persistence, and best-effort folder flush.
- Color, note, and tag: color is in Tasks 2, 6, 7, 9, and 10; note/tag persistence is in Tasks 2, 9, and 10.
- Local folder and iCloud Drive sync: covered by Tasks 4 and 13.
- Browser-based local management UI: covered by Tasks 8-10.
- Minimal third-party runtime dependencies: covered by Dependency Guardrails and Task 14.

Implementation risks to verify during execution:

- Some pages prevent safe `Range.surroundContents`; if smoke tests hit this, split text nodes before wrapping.
- Folder handles are stored in IndexedDB metadata; execution must verify structured clone persistence in extension pages.
- Multiple `chrome.runtime.onMessage` listeners must return `false` for unknown messages so handlers do not mask each other.
