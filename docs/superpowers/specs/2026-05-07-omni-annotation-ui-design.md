# Omni Annotation UI Design

## Goal

Build a Chrome extension for local-first web annotation and browser-based record management. The extension lets users highlight text and sentences, select images, create screenshot annotations, attach colors, notes, and tags, then save the structured records into a user-authorized iCloud Drive folder while keeping a fast local IndexedDB index for the extension UI.

## Dependency Policy

The MVP should minimize shipped third-party code.

- Runtime dependencies: none by default.
- UI framework: none. Use vanilla TypeScript, DOM templates, Shadow DOM, CSS custom properties, and browser-native controls where possible.
- Styling dependencies: no Tailwind, Radix, icon package, animation package, or component library.
- Data dependencies: no Dexie, MiniSearch, SQLite, or ORM in MVP. Use a small IndexedDB wrapper and a simple local inverted index written in TypeScript.
- Canvas dependencies: no Konva or Fabric in MVP. Use native Canvas 2D and DOM overlays.
- Build dependencies: Bun and TypeScript only where possible. Use local minimal Chrome API declarations first; add `@types/chrome` only after a specific type-maintenance problem is proven.
- Test dependencies: prefer `bun test` for pure logic. Add Playwright only when browser automation becomes necessary for extension UI regression tests.

Any new third-party runtime dependency must meet all of these conditions:

- It replaces at least 300 lines of fragile code or a security-sensitive implementation.
- It has a small bundled footprint.
- It is actively maintained.
- It does not take ownership of user data or require a hosted account.

## Product Positioning

Omni Annotation is a local browser knowledge library, not a cloud bookmark service. Diigo-like capture is the input surface; the main value is the extension's own local library for organizing, searching, reviewing, and exporting saved evidence.

## Primary Surfaces

### 1. In-Page Annotation Layer

Purpose: capture evidence without leaving the webpage.

Functions:

- Highlight selected text or full sentences.
- Attach color, note, and tags from a compact floating toolbar.
- Re-render saved highlights when the page is revisited.
- Enter image-pick mode and save the selected image with page context.
- Enter screenshot mode and drag-select a visible page region.
- Keep all injected UI inside Shadow DOM so host page CSS does not leak into the extension UI.

Design:

- Floating toolbar appears near selection and stays compact.
- Color choices are swatches, not text buttons.
- Note entry opens an inline popover with a single textarea and Save/Cancel actions.
- Image-pick mode uses a thin outline on hover and a small capture chip over the image.
- Screenshot mode uses a dim page overlay, a selection rectangle, and an annotation popover after capture.

### 2. Side Panel

Purpose: manage the current page and quick capture state.

Recommended width: 360-420px.

Layout:

- Header: page title, domain, sync indicator.
- Current Page tab: list of highlights, notes, images, and screenshots from this page.
- Inbox tab: recently captured records that need tags or collection assignment.
- Search tab: fast local search across saved records.
- Settings shortcut: folder connection and capture preferences.

Behavior:

- Selecting a record scrolls the webpage to its anchor when possible.
- Editing note, color, or tags updates IndexedDB immediately and queues a file flush.
- Sync indicator shows `Saved`, `Pending`, `Folder missing`, or `Conflict`.

### 3. Library Page

Purpose: the full local record manager inside the extension.

URL shape: `chrome-extension://<id>/library.html`

Layout:

```text
+------------------+------------------------------+------------------------------+
| Sidebar          | Record List                  | Detail Inspector             |
|                  |                              |                              |
| Inbox            | Search bar + filters         | Page / annotation detail     |
| All Records      |                              | Note editor                  |
| Pages            | Rows grouped by page/date    | Tags and collection          |
| Collections      |                              | Screenshot/image preview     |
| Gallery          |                              | Source context               |
| Review           |                              | File/sync metadata           |
| Sync             |                              |                              |
| Settings         |                              |                              |
+------------------+------------------------------+------------------------------+
```

Navigation modules:

- Inbox: records missing tags, note, or collection.
- All Records: dense table/list with filters.
- Pages: page-centric view showing all records saved from a URL.
- Collections: project folders such as research topics or product tasks.
- Gallery: images and screenshots.
- Review: saved items marked for revisit.
- Sync: iCloud folder status, pending writes, conflicts, backups.
- Settings: directory permission, shortcuts, excluded sites, export options.

Record list:

- Supports list density control: comfortable and compact.
- Filter chips: type, color, tag, collection, domain, date range, status.
- Rows show color marker, record type, quote or title, page title, tags, and saved time.

Detail inspector:

- Shows source URL, domain, page title, capture time, and locator confidence.
- Shows quote context for text highlights.
- Shows preview for images and screenshots.
- Provides note editor, tag editor, color swatches, collection picker, review toggle, and delete action.

### 4. Options Page

Purpose: configuration that does not belong in the daily workflow.

Sections:

- Storage: connect iCloud Drive folder, re-authorize folder, rebuild index from files.
- Capture: default highlight color, sentence expansion behavior, screenshot format.
- Privacy: excluded domains, private-window behavior, local encryption switch.
- Export: JSONL, Markdown, HTML bundle.
- Maintenance: backup now, compact event log, diagnostics export.

## Visual System

Principles:

- Quiet, utilitarian, and scan-friendly.
- Neutral background with annotation colors used as meaningful status, not decoration.
- No large marketing hero, no gradient backgrounds, no nested cards.
- Dense data views should remain readable at side-panel width.

Palette:

- Background: `#f7f7f5`
- Surface: `#ffffff`
- Text primary: `#1f2328`
- Text secondary: `#6b7280`
- Border: `#d8dbe0`
- Accent blue: `#2563eb`
- Highlight yellow: `#ffe066`
- Highlight green: `#a7f3d0`
- Highlight pink: `#fbcfe8`
- Highlight purple: `#ddd6fe`
- Highlight cyan: `#a5f3fc`

Typography:

- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Library page base font: 14px.
- Side panel base font: 13px.
- No viewport-scaled font sizes.
- Letter spacing: 0.

Controls:

- Use native buttons styled with CSS.
- Use color swatches for annotation color.
- Use segmented controls for record type filters.
- Use toggles or checkboxes for binary settings.
- Use native select or custom lightweight popover for collection choice.
- Prefer clear text buttons for destructive or high-risk actions.
- Icon-only controls may use small CSS-drawn symbols with visible tooltip labels; no external icon library in MVP.

## Data Model

The file layer is append-friendly and readable. IndexedDB is the query cache.

Core entities:

```ts
type RecordKind = "text" | "image" | "screenshot" | "page-note";

type AnnotationRecord = {
  id: string;
  kind: RecordKind;
  pageId: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  domain: string;
  createdAt: string;
  updatedAt: string;
  color?: "yellow" | "green" | "pink" | "purple" | "cyan";
  note: string;
  tags: string[];
  collectionIds: string[];
  review: {
    enabled: boolean;
    dueAt?: string;
  };
  target: TextTarget | ImageTarget | ScreenshotTarget | PageTarget;
  sync: {
    status: "local" | "pending" | "flushed" | "conflict";
    filePath?: string;
  };
};
```

Text target:

```ts
type TextTarget = {
  type: "text";
  quote: string;
  prefix: string;
  suffix: string;
  startOffset?: number;
  endOffset?: number;
  cssPath?: string;
  locatorConfidence: "exact" | "context" | "manual";
};
```

Asset targets:

```ts
type ImageTarget = {
  type: "image";
  sourceUrl: string;
  assetPath?: string;
  altText?: string;
  cssPath?: string;
};

type ScreenshotTarget = {
  type: "screenshot";
  assetPath: string;
  viewportRect: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
};

type PageTarget = {
  type: "page";
};
```

## Storage Design

Recommended iCloud directory:

```text
OmniAnnotation/
  data/
    events.jsonl
    annotations.jsonl
    pages.jsonl
    collections.jsonl
  assets/
    screenshots/
    images/
  backups/
    YYYY-MM-DD/
```

Write model:

- UI writes to IndexedDB first.
- A sync queue appends normalized events to `data/events.jsonl`.
- Periodic compaction rewrites `annotations.jsonl`, `pages.jsonl`, and `collections.jsonl`.
- Assets are written once with content-addressed names when feasible.
- If folder permission is lost, records remain in IndexedDB with `pending` sync status.

Conflict model:

- The event log uses stable ids and `updatedAt`.
- If two devices edit the same record, keep both versions and surface a conflict in the Sync view.
- The first MVP conflict UI can choose one version, merge note text manually, or duplicate the record.

## Key Flows

### Text Highlight

1. User selects text.
2. Floating toolbar appears.
3. User chooses color.
4. Extension creates `TextTarget` with quote, prefix, suffix, offsets, and CSS path.
5. Highlight appears immediately.
6. Record is saved to IndexedDB and queued for file sync.

### Note on Highlight

1. User selects an existing highlight.
2. Popover opens with note textarea, tags field, and collection field.
3. Save updates the record.
4. Side panel and library list update through a shared store event.

### Image Capture

1. User activates image-pick mode from toolbar or side panel.
2. Hovered images show an outline.
3. User clicks an image.
4. Extension stores source URL and page context.
5. If the image can be fetched safely, save an asset copy; otherwise save only the reference and a warning state.

### Screenshot Capture

1. User activates screenshot mode.
2. Page overlay appears.
3. User drag-selects a visible region.
4. Background calls `chrome.tabs.captureVisibleTab`.
5. Canvas crops the selected rectangle.
6. Asset is saved and a note popover opens.

### Library Search

1. User types in the search field.
2. Query is matched against title, URL, quote, note, tags, domain, and OCR text when available.
3. Results update locally without network calls.
4. Selecting a result opens the detail inspector.

## Error Handling

- Folder not connected: show records locally and display a Connect Folder action in Sync and Settings.
- Folder permission revoked: keep captures in IndexedDB, mark sync status as `pending`, and ask for re-authorization.
- Page locator failed: keep record in the library and show locator confidence as `manual`; allow user to copy quote or open source URL.
- Image fetch blocked by CORS: save source URL and visible metadata; do not block the record.
- Screenshot capture denied: show a short error and keep the user in screenshot mode until canceled.
- Event log parse error: stop importing at the invalid line, keep a diagnostic entry, and offer backup export.

## MVP Scope

Included:

- Manifest V3 extension.
- Content script for text selection, highlight rendering, image pick mode, and screenshot overlay.
- Background service worker for screenshot capture and sync messages.
- Side panel for current page records.
- Library page for Inbox, All Records, Pages, Gallery, Sync, and Settings.
- IndexedDB storage.
- User-authorized iCloud Drive folder sync through File System Access API.
- JSONL data files and asset folders.
- Local search over title, URL, quote, note, tags, and domain.
- Basic import/rebuild from data files.

Not included in MVP:

- Hosted accounts.
- Collaboration.
- Obsidian dependency.
- AI summary.
- OCR.
- End-to-end encryption.
- Native Messaging macOS helper.
- Full-page scrolling screenshot stitching.

## Acceptance Criteria

- A user can install the unpacked extension and connect an iCloud Drive folder.
- A user can highlight selected webpage text with a chosen color and note.
- Saved highlights reappear on page reload when the quote can be relocated.
- A user can save an image reference from a webpage.
- A user can crop a visible screenshot region and save it with a note.
- The side panel shows current-page records and allows editing note, color, and tags.
- The library page can search and filter all local records.
- Records are written to IndexedDB first and flushed to the selected local folder.
- The extension continues capturing when iCloud permission is missing, then flushes after reconnection.
- No runtime third-party dependency is bundled in the MVP.
