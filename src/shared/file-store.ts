import { serializeEvent, type RecordEvent } from "./events";

let appendQueue: Promise<void> = Promise.resolve();
const BACKUP_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const EVENTS_FILE_NAME = "events.jsonl";
const BACKUP_FILE_NAME = "events.backup.jsonl";

export async function ensureDirectory(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

export async function appendEvent(root: FileSystemDirectoryHandle, event: RecordEvent): Promise<void> {
  const appendOperation = appendQueue.catch(() => undefined).then(() => appendEventUnqueued(root, event));
  appendQueue = appendOperation;
  return appendOperation;
}

async function appendEventUnqueued(root: FileSystemDirectoryHandle, event: RecordEvent): Promise<void> {
  const dataDir = await ensureDirectory(root, "data");
  const file = await dataDir.getFileHandle(EVENTS_FILE_NAME, { create: true });
  const current = await file.getFile();
  const writer = await file.createWritable({ keepExistingData: true });

  try {
    await writer.seek(current.size);
    await writer.write(serializeEvent(event));
    await writer.close();
    await refreshEventBackupIfStale(dataDir, file);
  } catch (error) {
    await abortWriter(writer);
    throw error;
  }
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

  try {
    await writer.write(blob);
    await writer.close();
  } catch (error) {
    await abortWriter(writer);
    throw error;
  }

  return `assets/${folder}/${filename}`;
}

async function abortWriter(writer: FileSystemWritableFileStream): Promise<void> {
  try {
    await writer.abort();
  } catch {
    // Preserve the original write failure.
  }
}

async function refreshEventBackupIfStale(
  dataDir: FileSystemDirectoryHandle,
  primaryHandle: FileSystemFileHandle
): Promise<void> {
  const shouldRefresh = await shouldRefreshBackup(dataDir);
  if (!shouldRefresh) {
    return;
  }

  const primary = await primaryHandle.getFile();
  const backupHandle = await dataDir.getFileHandle(BACKUP_FILE_NAME, { create: true });
  const writer = await backupHandle.createWritable();

  try {
    await writer.write(primary);
    await writer.close();
  } catch (error) {
    await abortWriter(writer);
    throw error;
  }
}

async function shouldRefreshBackup(dataDir: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const backupHandle = await dataDir.getFileHandle(BACKUP_FILE_NAME);
    const backupFile = await backupHandle.getFile();
    const staleSinceMs = Date.now() - backupFile.lastModified;
    return staleSinceMs >= BACKUP_REFRESH_INTERVAL_MS;
  } catch {
    return true;
  }
}
