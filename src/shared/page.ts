export function pageIdForUrl(url: string): string {
  const normalized = normalizeUrl(url);
  const { hostname } = new URL(normalized);
  return `page_${hostname}_${hashString(normalized)}`;
}

export function domainForUrl(url: string): string {
  return new URL(url).hostname;
}

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
