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

export function pageIdCandidatesForUrl(url: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const candidateUrl of lookupUrlVariants(url)) {
    const candidateId = pageIdForUrl(candidateUrl);
    if (seen.has(candidateId)) {
      continue;
    }
    seen.add(candidateId);
    ids.push(candidateId);
  }

  return ids;
}

function lookupUrlVariants(url: string): string[] {
  const normalized = normalizeUrl(url);
  const base = new URL(normalized);
  const variants = new Set<string>();

  const protocols = lookupProtocolVariants(base.protocol);
  const hostnames = lookupHostnameVariants(base.hostname);
  const pathnames = lookupPathnameVariants(base.pathname);
  const searches = lookupSearchVariants(base.search);

  for (const protocol of protocols) {
    for (const hostname of hostnames) {
      for (const pathname of pathnames) {
        for (const search of searches) {
          const candidate = new URL(normalized);
          candidate.protocol = protocol;
          candidate.hostname = hostname;
          candidate.pathname = pathname;
          candidate.search = search;
          candidate.hash = "";
          variants.add(candidate.toString());
        }
      }
    }
  }

  return Array.from(variants);
}

function lookupProtocolVariants(protocol: string): string[] {
  if (protocol === "http:") {
    return ["http:", "https:"];
  }
  if (protocol === "https:") {
    return ["https:", "http:"];
  }
  return [protocol];
}

function lookupHostnameVariants(hostname: string): string[] {
  const variants = [hostname];
  if (!canToggleWww(hostname)) {
    return variants;
  }

  if (hostname.startsWith("www.")) {
    variants.push(hostname.slice(4));
  } else {
    variants.push(`www.${hostname}`);
  }

  return variants;
}

function lookupPathnameVariants(pathname: string): string[] {
  if (pathname === "/") {
    return ["/"];
  }

  if (pathname.endsWith("/")) {
    const withoutSlash = pathname.replace(/\/+$/g, "") || "/";
    return [pathname, withoutSlash];
  }

  return [pathname, `${pathname}/`];
}

function lookupSearchVariants(search: string): string[] {
  if (!search) {
    return [""];
  }
  return [search, ""];
}

function canToggleWww(hostname: string): boolean {
  if (hostname === "localhost") {
    return false;
  }

  if (!/[a-z]/i.test(hostname)) {
    return false;
  }

  return hostname.includes(".");
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
