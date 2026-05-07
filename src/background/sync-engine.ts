import { appendEvent, writeAsset } from "../shared/file-store";
import type { RecordEvent } from "../shared/events";
import { createRecordStore } from "../shared/idb";

type FlushEventResult = { ok: true } | { ok: false; reason: string };
type FlushAssetResult = { ok: true; assetPath: string } | { ok: false; reason: string };

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
  if (!root) {
    return { ok: false, reason: "folder-not-connected" };
  }

  try {
    await appendEvent(root, event);
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
  if (!root) {
    return { ok: false, reason: "folder-not-connected" };
  }

  try {
    const assetPath = await writeAsset(root, folder, filename, blob);
    return { ok: true, assetPath };
  } catch (error) {
    return { ok: false, reason: syncErrorReason(error, "unknown-asset-sync-error") };
  }
}

async function getRootHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  if (rootHandle) {
    return rootHandle;
  }

  const store = await createRecordStore();
  rootHandle = await store.getMeta<FileSystemDirectoryHandle>("syncRootHandle");
  return rootHandle;
}

function syncErrorReason(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
