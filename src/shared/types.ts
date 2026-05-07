export type RecordKind = "text" | "image" | "screenshot" | "page-note";
export type AnnotationColor = "yellow" | "green" | "pink" | "purple" | "cyan";
export type SyncStatus = "local" | "pending" | "flushed" | "conflict";

export type TextTarget = {
  type: "text";
  quote: string;
  prefix: string;
  suffix: string;
  startOffset?: number;
  endOffset?: number;
  cssPath?: string;
  locatorConfidence: "exact" | "context" | "manual";
};

export type ImageTarget = {
  type: "image";
  sourceUrl: string;
  assetPath?: string;
  altText?: string;
  cssPath?: string;
};

export type ScreenshotTarget = {
  type: "screenshot";
  assetPath: string;
  viewportRect: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
  annotations?: ScreenshotAnnotation[];
};

export type PageTarget = { type: "page" };

export type AnnotationTarget = TextTarget | ImageTarget | ScreenshotTarget | PageTarget;

export type ScreenshotAnnotation = {
  type: "highlight";
  color: AnnotationColor;
  note: string;
  rect: { x: number; y: number; width: number; height: number };
};

export type AnnotationRecord = {
  id: string;
  kind: RecordKind;
  pageId: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  domain: string;
  createdAt: string;
  updatedAt: string;
  color?: AnnotationColor;
  note: string;
  tags: string[];
  collectionIds: string[];
  review: { enabled: boolean; dueAt?: string };
  target: AnnotationTarget;
  sync: { status: SyncStatus; filePath?: string };
};
