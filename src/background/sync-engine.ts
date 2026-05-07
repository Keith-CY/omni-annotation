import { appendEvent, writeAsset } from "../shared/file-store";
import type { RecordEvent } from "../shared/events";
import { createRecordStore, type RecordStore, type StoredAsset } from "../shared/idb";
import type { AnnotationRecord, AnnotationTarget } from "../shared/types";

type FlushEventResult = { ok: true } | { ok: false; reason: string };
type FlushAssetResult = { ok: true; assetPath: string } | { ok: false; reason: string };
type FlushPendingSyncResult = {
  ok: boolean;
  recordsFlushed: number;
  assetsFlushed: number;
  reason?: string;
};
type RootHandleResult =
  | { ok: true; root: FileSystemDirectoryHandle }
  | { ok: false; reason: "folder-not-connected" | "folder-permission-missing" };
type PendingAssetPath = {
  folder: "screenshots" | "images";
  filename: string;
};
type ResolveRecordAssetResult =
  | { ok: true; record: AnnotationRecord; assetsFlushed: number }
  | { ok: false; reason: string };

export const EVENTS_FILE_PATH = "data/events.jsonl";

let rootHandle: FileSystemDirectoryHandle | undefined;

export async function setSyncRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  rootHandle = handle;

  const store = await createRecordStore();
  await store.setMeta("syncRootHandle", handle);
  await store.setMeta("folderName", handle.name);
  await store.setMeta("folderConnectedAt", new Date().toISOString());
  await flushPendingSync();
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

export async function flushPendingSync(): Promise<FlushPendingSyncResult> {
  const root = await getRootHandle();
  if (!root.ok) {
    return {
      ok: false,
      recordsFlushed: 0,
      assetsFlushed: 0,
      reason: root.reason
    };
  }

  const store = await createRecordStore();
  let recordsFlushed = 0;
  let assetsFlushed = 0;
  let reason: string | undefined;

  const pendingAssets = await store.listPendingAssets();
  for (const asset of pendingAssets) {
    const flushed = await flushStoredAsset(root.root, store, asset);
    if (flushed.ok) {
      assetsFlushed += 1;
    } else {
      reason ??= flushed.reason;
    }
  }

  const records = await store.listRecords();
  const assetByPath = createAssetIndex(await store.listAssets());

  for (const record of records) {
    if (record.sync.status !== "pending") {
      continue;
    }

    const resolved = await resolveRecordAsset(root.root, store, assetByPath, record);
    if (!resolved.ok) {
      reason ??= resolved.reason;
      continue;
    }
    assetsFlushed += resolved.assetsFlushed;

    const flushedRecord = withFlushedSync(resolved.record);
    try {
      await appendEvent(root.root, { type: "record.created", record: flushedRecord });
      await store.putRecord(flushedRecord);
      recordsFlushed += 1;
    } catch (error) {
      reason ??= syncErrorReason(error, "unknown-sync-error");
    }
  }

  return {
    ok: reason === undefined,
    recordsFlushed,
    assetsFlushed,
    ...(reason ? { reason } : {})
  };
}

function withFlushedSync(record: AnnotationRecord): AnnotationRecord {
  return {
    ...record,
    sync: { status: "flushed", filePath: EVENTS_FILE_PATH }
  };
}

function createAssetIndex(assets: StoredAsset[]): Map<string, StoredAsset> {
  const index = new Map<string, StoredAsset>();

  for (const asset of assets) {
    index.set(assetKey(asset.folder, asset.filename), asset);
  }

  return index;
}

async function resolveRecordAsset(
  root: FileSystemDirectoryHandle,
  store: RecordStore,
  assetByPath: Map<string, StoredAsset>,
  record: AnnotationRecord
): Promise<ResolveRecordAssetResult> {
  const pendingPath = pendingAssetPath(record.target);
  if (!pendingPath) {
    return { ok: true, record, assetsFlushed: 0 };
  }

  const key = assetKey(pendingPath.folder, pendingPath.filename);
  const asset = assetByPath.get(key);
  if (!asset) {
    return { ok: false, reason: `pending-asset-not-found:${pendingPath.filename}` };
  }

  let assetsFlushed = 0;
  if (asset.syncStatus !== "flushed") {
    const flushed = await flushStoredAsset(root, store, asset);
    if (!flushed.ok) {
      return { ok: false, reason: flushed.reason };
    }
    assetsFlushed = 1;
    assetByPath.set(key, { ...asset, syncStatus: "flushed" });
  }

  const assetPath = `assets/${pendingPath.folder}/${pendingPath.filename}`;
  return {
    ok: true,
    record: {
      ...record,
      target: withResolvedAssetPath(record.target, assetPath)
    },
    assetsFlushed
  };
}

async function flushStoredAsset(
  root: FileSystemDirectoryHandle,
  store: RecordStore,
  asset: StoredAsset
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await writeAsset(root, asset.folder, asset.filename, asset.blob);
    await store.putAsset({ ...asset, syncStatus: "flushed" });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: syncErrorReason(error, "unknown-asset-sync-error") };
  }
}

function pendingAssetPath(target: AnnotationTarget): PendingAssetPath | undefined {
  if ((target.type !== "image" && target.type !== "screenshot") || !target.assetPath) {
    return undefined;
  }

  const match = /^pending\/(screenshots|images)\/([^/]+)$/.exec(target.assetPath);
  if (!match) {
    return undefined;
  }

  return {
    folder: match[1] as "screenshots" | "images",
    filename: match[2] as string
  };
}

function withResolvedAssetPath(target: AnnotationTarget, assetPath: string): AnnotationTarget {
  switch (target.type) {
    case "image":
      return { ...target, assetPath };
    case "screenshot":
      return { ...target, assetPath };
    case "text":
    case "page":
      return target;
  }
}

function assetKey(folder: "screenshots" | "images", filename: string): string {
  return `${folder}/${filename}`;
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
