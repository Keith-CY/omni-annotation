export function createId(prefix: string): string {
  const bytes = new Uint8Array(12);
  getCrypto().getRandomValues(bytes);
  const body = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${body}`;
}

function getCrypto(): Crypto {
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    return globalThis.crypto;
  }

  throw new Error("crypto.getRandomValues is not available");
}
