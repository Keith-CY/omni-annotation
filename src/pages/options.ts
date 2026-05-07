import { createRecordStore, type RecordStore } from "../shared/idb";
import { clear, el } from "../ui/dom";

type FolderMeta = {
  handle?: FileSystemDirectoryHandle;
  folderName?: string;
  connectedAt?: string;
  permission?: FileSystemPermissionState | "unsupported";
};

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
    statusMessage = `Folder connected. Permission: ${permission}.`;
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

export {};
