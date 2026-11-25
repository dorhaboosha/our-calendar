// Encrypts the Google refresh tokens kept for the export, so a copy of the database
// alone can't be used to reach anyone's Google account. AES-256-GCM, with the key in an
// environment variable (TOKEN_ENCRYPTION_KEY), never in the database.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
/** 96-bit nonce, the size GCM is designed for; a new random one for every encryption. */
const IV_BYTES = 12;
/** The stored format's version, so the scheme can change later without guessing. */
const VERSION = "v1";

/** The key from TOKEN_ENCRYPTION_KEY: 32 bytes, base64-encoded. Throws if it isn't. */
export function encryptionKey(value = process.env.TOKEN_ENCRYPTION_KEY): Buffer {
  const key = Buffer.from(value ?? "", "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64-encoded`);
  }
  return key;
}

/**
 * Encrypts a token for storage. context is bound to it (as GCM's additional data): the
 * id of the user it belongs to, so a token copied to another user's row won't decrypt.
 * Returns "v1.<iv>.<tag>.<ciphertext>", each part base64url.
 */
export function encryptToken(token: string, context: string, key = encryptionKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/**
 * Decrypts a stored token. Throws if it was changed, belongs to another context, or was
 * encrypted with another key; the error never includes the token.
 */
export function decryptToken(stored: string, context: string, key = encryptionKey()): string {
  const [version, iv, tag, ciphertext, ...rest] = stored.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    throw new Error("Stored token has an unknown format");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Stored token could not be decrypted");
  }
}
