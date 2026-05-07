import { appendEvent, writeAsset } from "../shared/file-store";
import type { RecordEvent } from "../shared/events";
import { createRecordStore } from "../shared/idb";

type FlushEventResult = { ok: true } | { ok: false; reason: string };
type FlushAssetResult = { ok: true; assetPath: string } | { ok: false; reason: string };
type RootHandleResult =
  | { ok: true; root: FileSystemDirectoryHandle }
  | { ok: false; reason: "folder-not-connected" | "folder-permission-missing" };

let rootHandle: FileSystemDirectoryHandle | undefined;

export async function setSyncRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  rootHandle = handle;

  const store = await createRecordStore();
  await store.setMeta("syncRootHandle", handle);
  await store.setMeta("folderName", handle.name);
  await store.setMeta("folderConnectedAt", new Date().toISOString());
}

export async function flushEvent(event: RecordEvent): Promise<FlushEventResult> {
  const root = await getRootHandle();
  if (!root.ok) {
    return { ok: false, reason: root.reason };
  }

  try {
    await appendEvent(root.root, event);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: syncErrorReason(error, "unknown-sync-error") };
  }
}

export async function flushAsset(
  folder: "screenshots" | "images",
  filename: string,
  blob: Blob
): Promise<FlushAssetResult> {
  const root = await getRootHandle();
  if (!root.ok) {
    return { ok: false, reason: root.reason };
  }

  try {
    const assetPath = await writeAsset(root.root, folder, filename, blob);
    return { ok: true, assetPath };
  } catch (error) {
    return { ok: false, reason: syncErrorReason(error, "unknown-asset-sync-error") };
  }
}

async function getRootHandle(): Promise<RootHandleResult> {
  const handle = rootHandle ?? (await restoreRootHandle());
  if (!handle) {
    return { ok: false, reason: "folder-not-connected" };
  }

  if (!(await hasReadWritePermission(handle))) {
    return { ok: false, reason: "folder-permission-missing" };
  }

  rootHandle = handle;
  return { ok: true, root: handle };
}

async function restoreRootHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const store = await createRecordStore();
  return store.getMeta<FileSystemDirectoryHandle>("syncRootHandle");
}

async function hasReadWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (typeof handle.queryPermission !== "function") {
    return true;
  }

  return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
}

function syncErrorReason(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
