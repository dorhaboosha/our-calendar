import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, encryptionKey } from "./token-crypto";

const key = randomBytes(32);
const token = "1//0refresh-token-example";
const userId = "user-1";

describe("refresh token encryption", () => {
  it("decrypts what it encrypted, and never stores the token as is", () => {
    const stored = encryptToken(token, userId, key);
    expect(stored).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(stored).not.toContain(token);
    expect(decryptToken(stored, userId, key)).toBe(token);
  });

  it("uses a new nonce every time", () => {
    expect(encryptToken(token, userId, key)).not.toBe(encryptToken(token, userId, key));
  });

  it("refuses a changed token, another user's token, or another key", () => {
    const stored = encryptToken(token, userId, key);
    const [version, iv, tag, ciphertext] = stored.split(".");
    const flipped = Buffer.from(ciphertext, "base64url");
    flipped[0] ^= 1;
    for (const [value, context, withKey] of [
      [[version, iv, tag, flipped.toString("base64url")].join("."), userId, key],
      [stored, "user-2", key],
      [stored, userId, randomBytes(32)],
    ] as const) {
      expect(() => decryptToken(value, context, withKey)).toThrow(
        "Stored token could not be decrypted",
      );
    }
  });

  it("refuses an unknown format, without echoing it", () => {
    for (const value of [token, "v2.a.b.c", "v1.a.b", "v1.a.b.c.d"]) {
      expect(() => decryptToken(value, userId, key)).toThrow("Stored token has an unknown format");
    }
  });

  it("needs a 32-byte base64 key", () => {
    expect(encryptionKey(key.toString("base64"))).toEqual(key);
    for (const value of [undefined, "", "replace-me", randomBytes(16).toString("base64")]) {
      expect(() => encryptionKey(value)).toThrow("TOKEN_ENCRYPTION_KEY must be 32 bytes");
    }
  });
});
