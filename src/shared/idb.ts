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

export async function createRecordStore(): Promise<RecordStore> {
  const db = await openDatabase();

  return {
    async putRecord(record) {
      const tx = db.transaction(RECORD_STORE, "readwrite");
      tx.objectStore(RECORD_STORE).put(record);
      await transactionDone(tx, `put record ${record.id}`);
    },

    async getRecord(id) {
      const tx = db.transaction(RECORD_STORE, "readonly");
      return requestToPromise<AnnotationRecord | undefined>(
        tx.objectStore(RECORD_STORE).get(id),
        `get record ${id}`
      );
    },

    async listRecords() {
      const tx = db.transaction(RECORD_STORE, "readonly");
      return requestToPromise<AnnotationRecord[]>(
        tx.objectStore(RECORD_STORE).getAll(),
        "list records"
      );
    },

    async listRecordsByPage(pageId) {
      const tx = db.transaction(RECORD_STORE, "readonly");
      const index = tx.objectStore(RECORD_STORE).index("pageId");
      return requestToPromise<AnnotationRecord[]>(index.getAll(pageId), `list records for page ${pageId}`);
    },

    async deleteRecord(id) {
      const tx = db.transaction(RECORD_STORE, "readwrite");
      tx.objectStore(RECORD_STORE).delete(id);
      await transactionDone(tx, `delete record ${id}`);
    },

    async putAsset(asset) {
      const tx = db.transaction(ASSET_STORE, "readwrite");
      tx.objectStore(ASSET_STORE).put(asset);
      await transactionDone(tx, `put asset ${asset.id}`);
    },

    async getAsset(id) {
      const tx = db.transaction(ASSET_STORE, "readonly");
      return requestToPromise<StoredAsset | undefined>(
        tx.objectStore(ASSET_STORE).get(id),
        `get asset ${id}`
      );
    },

    async listPendingAssets() {
      const tx = db.transaction(ASSET_STORE, "readonly");
      const index = tx.objectStore(ASSET_STORE).index("syncStatus");
      return requestToPromise<StoredAsset[]>(index.getAll("pending"), "list pending assets");
    },

    async setMeta(key, value) {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put({ key, value });
      await transactionDone(tx, `set meta ${key}`);
    },

    async getMeta<T>(key: string) {
      const tx = db.transaction(META_STORE, "readonly");
      const result = await requestToPromise<StoredMeta | undefined>(
        tx.objectStore(META_STORE).get(key),
        `get meta ${key}`
      );
      return result?.value as T | undefined;
    }
  };
}

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
    request.onerror = () => reject(idbError("open database", request.error));
    request.onblocked = () => reject(new Error("IndexedDB open database blocked by another connection"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(idbError(operation, request.error));
  });
}

function transactionDone(tx: IDBTransaction, operation: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(idbError(operation, tx.error));
    tx.onabort = () => reject(idbError(operation, tx.error));
  });
}

function idbError(operation: string, error: DOMException | null): Error {
  const message = error ? `${error.name}: ${error.message}` : "unknown IndexedDB error";
  return new Error(`IndexedDB ${operation} failed: ${message}`);
}
