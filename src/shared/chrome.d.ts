type ChromeMessageResponse = unknown;

interface ChromeRuntimeInstalledDetails {
  reason: "install" | "update" | "chrome_update" | "shared_module_update";
  previousVersion?: string;
  id?: string;
}

interface ChromeRuntimeMessageSender {
  tab?: ChromeTab;
  frameId?: number;
  id?: string;
  url?: string;
}

interface ChromeEvent<TListener extends (...args: never[]) => unknown> {
  addListener(listener: TListener): void;
  removeListener(listener: TListener): void;
  hasListener(listener: TListener): boolean;
}

interface ChromeTab {
  id?: number;
  index: number;
  windowId: number;
  active: boolean;
  highlighted: boolean;
  selected: boolean;
  pinned: boolean;
  url?: string;
  title?: string;
}

interface ChromeTabsQueryInfo {
  active?: boolean;
  currentWindow?: boolean;
  highlighted?: boolean;
  index?: number;
  pinned?: boolean;
  status?: "loading" | "complete";
  title?: string;
  url?: string | string[];
  windowId?: number;
}

interface ChromeCaptureOptions {
  format?: "jpeg" | "png";
  quality?: number;
}

type FileSystemPermissionMode = "read" | "readwrite";
type FileSystemPermissionState = "granted" | "denied" | "prompt";

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemDirectoryHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<FileSystemPermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<FileSystemPermissionState>;
}

interface DirectoryPickerOptions {
  mode?: FileSystemPermissionMode;
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}

declare const chrome: {
  runtime: {
    onInstalled: ChromeEvent<(details: ChromeRuntimeInstalledDetails) => void>;
    onMessage: ChromeEvent<
      (
        message: unknown,
        sender: ChromeRuntimeMessageSender,
        sendResponse: (response?: ChromeMessageResponse) => void
      ) => boolean | void | Promise<ChromeMessageResponse>
    >;
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<ChromeMessageResponse>;
  };
  sidePanel: {
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  };
  tabs: {
    query(queryInfo: ChromeTabsQueryInfo): Promise<ChromeTab[]>;
    create(createProperties: { url?: string; active?: boolean; windowId?: number }): Promise<ChromeTab>;
    captureVisibleTab(windowId?: number, options?: ChromeCaptureOptions): Promise<string>;
  };
};
