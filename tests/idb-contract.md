# IndexedDB Manual Contract

1. Load the unpacked extension from `dist`.
2. Open `chrome-extension://<id>/src/pages/library.html`.
3. Run `await import("../shared/idb.js")` from the page console.
4. Verify that `indexedDB.databases()` contains `omni-annotation`.
5. Add one record through the UI after Task 8 and verify it appears in the `records` object store.
6. Verify the `records` store uses key path `id` and has `pageId`, `domain`, and `updatedAt` indexes.
7. Verify the `meta` store uses key path `key`.
8. Verify the `assets` store uses key path `id` and has `syncStatus` and `folder` indexes.
