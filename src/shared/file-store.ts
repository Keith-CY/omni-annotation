import { serializeEvent, type RecordEvent } from "./events";

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
