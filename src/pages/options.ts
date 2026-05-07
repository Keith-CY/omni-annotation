import { createRecordStore, type RecordStore } from "../shared/idb";
import { clear, el } from "../ui/dom";

type FolderMeta = {
  handle?: FileSystemDirectoryHandle;
  folderName?: string;
  connectedAt?: string;
  permission?: FileSystemPermissionState | "unsupported";
};

type SyncReplaySummary = {
  ok: boolean;
  recordsFlushed: number;
  assetsFlushed: number;
  reason?: string;
};

type SyncReplayMessageResponse =
  | { ok: true; replay: SyncReplaySummary }
  | { ok: false; error: string };

const app = document.querySelector<HTMLElement>("#app");
let store: RecordStore;
let statusMessage = "";

void init().catch((error: unknown) => {
  renderError(error);
});

async function init(): Promise<void> {
  if (!app) {
    return;
  }

  store = await createRecordStore();
  await render();
}

async function render(): Promise<void> {
  if (!app) {
    return;
  }

  const meta = await readFolderMeta();
  clear(app);
  app.append(
    el("section", { className: "options-shell" }, [
      el("div", { className: "settings-section" }, [
        el("div", { className: "title-block" }, [
          el("h1", {}, ["Options"]),
          el("p", { className: "subtle" }, ["Local folder connection"])
        ]),
        renderFolderStatus(meta),
        el("button", { type: "button", onclick: () => void connectFolder() }, [
          meta.handle ? "Reconnect iCloud folder" : "Connect iCloud folder"
        ]),
        statusMessage ? el("div", { className: "message" }, [statusMessage]) : undefined
      ])
    ])
  );
}

function renderFolderStatus(meta: FolderMeta): HTMLElement {
  if (!meta.handle) {
    return el("div", { className: "message" }, ["No folder connected."]);
  }

  return el("div", { className: "detail-list" }, [
    detailField("Folder", meta.folderName ?? meta.handle.name),
    detailField("Connected", meta.connectedAt ? formatDate(meta.connectedAt) : "Unknown"),
    detailField("Permission", meta.permission ?? "Unknown")
  ]);
}

async function connectFolder(): Promise<void> {
  if (!window.showDirectoryPicker) {
    statusMessage = "Folder picker is not available in this browser.";
    await render();
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const permission = await requestReadWritePermission(handle);

    if (!canStoreConnectedFolder(permission)) {
      statusMessage = "Folder permission was not granted. Reconnect the folder and allow readwrite access.";
      await render();
      return;
    }

    const connectedAt = new Date().toISOString();
    await store.setMeta("syncRootHandle", handle);
    await store.setMeta("folderName", handle.name);
    await store.setMeta("folderConnectedAt", connectedAt);
    statusMessage = `Folder connected. Permission: ${permission}. ${await replayPendingSyncMessage()}`;
  } catch (error) {
    statusMessage = pickerMessage(error);
  }

  await render();
}

async function readFolderMeta(): Promise<FolderMeta> {
  const handle = await store.getMeta<FileSystemDirectoryHandle>("syncRootHandle");
  const folderName = await store.getMeta<string>("folderName");
  const connectedAt = await store.getMeta<string>("folderConnectedAt");
  const permission = handle ? await queryReadWritePermission(handle) : undefined;

  return {
    ...(handle ? { handle } : {}),
    ...(folderName ? { folderName } : {}),
    ...(connectedAt ? { connectedAt } : {}),
    ...(permission ? { permission } : {})
  };
}

async function queryReadWritePermission(
  handle: FileSystemDirectoryHandle
): Promise<FileSystemPermissionState | "unsupported"> {
  if (typeof handle.queryPermission !== "function") {
    return "unsupported";
  }

  return handle.queryPermission({ mode: "readwrite" });
}

async function requestReadWritePermission(
  handle: FileSystemDirectoryHandle
): Promise<FileSystemPermissionState | "unsupported"> {
  if (typeof handle.requestPermission !== "function") {
    return "unsupported";
  }

  return handle.requestPermission({ mode: "readwrite" });
}

function canStoreConnectedFolder(permission: FileSystemPermissionState | "unsupported"): boolean {
  return permission === "granted" || permission === "unsupported";
}

async function replayPendingSyncMessage(): Promise<string> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "sync.root-connected" });
    if (!isSyncReplayMessageResponse(response)) {
      return "Pending replay could not be confirmed.";
    }

    if (!response.ok) {
      return `Pending replay failed: ${response.error}.`;
    }

    const replay = response.replay;
    if (!replay.ok) {
      return `Pending replay incomplete: ${replay.reason ?? "unknown-error"}.`;
    }

    return `Pending replay flushed ${replay.recordsFlushed} records and ${replay.assetsFlushed} assets.`;
  } catch (error) {
    return `Pending replay failed: ${error instanceof Error ? error.message : "unknown-error"}.`;
  }
}

function isSyncReplayMessageResponse(value: unknown): value is SyncReplayMessageResponse {
  if (!isObject(value) || typeof value.ok !== "boolean") {
    return false;
  }

  if (!value.ok) {
    return typeof value.error === "string";
  }

  return isSyncReplaySummary(value.replay);
}

function isSyncReplaySummary(value: unknown): value is SyncReplaySummary {
  return (
    isObject(value) &&
    typeof value.ok === "boolean" &&
    typeof value.recordsFlushed === "number" &&
    typeof value.assetsFlushed === "number" &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

function detailField(label: string, value: string): HTMLElement {
  return el("div", { className: "detail-field" }, [
    el("label", {}, [label]),
    el("p", {}, [value])
  ]);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function pickerMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Folder connection canceled.";
  }

  return error instanceof Error ? error.message : "Unable to connect folder.";
}

function renderError(error: unknown): void {
  if (!app) {
    return;
  }

  const message = error instanceof Error ? error.message : "Unable to load options.";
  clear(app);
  app.append(
    el("section", { className: "options-shell" }, [
      el("div", { className: "settings-section" }, [
        el("h1", {}, ["Options"]),
        el("div", { className: "message" }, [message])
      ])
    ])
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {};
