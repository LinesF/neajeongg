/**
 * Workers Web Crypto 기반 비밀번호 해싱.
 * PBKDF2-SHA256, 210,000 iterations (OWASP 권장) + 랜덤 salt.
 * D1에 저장되는 값은 `${iterations}:${saltB64}:${hashB64}` 형태.
 */
const ITERATIONS = 210_000;
const KEY_LENGTH_BITS = 256;

export interface StoredPassword {
  iterations: number;
  salt: string;
  hash: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<StoredPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return {
    iterations: ITERATIONS,
    salt: toBase64(salt),
    hash: toBase64(hash),
  };
}

export async function verifyPassword(
  password: string,
  stored: StoredPassword,
): Promise<boolean> {
  const salt = fromBase64(stored.salt);
  const expected = fromBase64(stored.hash);
  const actual = await derive(password, salt, stored.iterations);
  if (actual.length !== expected.length) return false;
  // timing-safe 비교
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export function serializePassword(stored: StoredPassword): string {
  return `${stored.iterations}:${stored.salt}:${stored.hash}`;
}

export function deserializePassword(value: string): StoredPassword | null {
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const iterations = Number(parts[0]);
  if (!Number.isInteger(iterations) || iterations <= 0) return null;
  return { iterations, salt: parts[1], hash: parts[2] };
}

/** 세션 토큰: 32바이트 랜덤. DB에는 sha256 해시만 저장한다. */
export function generateSessionToken(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toBase64(new Uint8Array(digest));
}
