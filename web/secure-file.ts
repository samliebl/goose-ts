import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Encryption at rest for the data file: AES-256-GCM, so a copy of the file
 * (a backup, a leaked volume snapshot, a path-traversal bug) is unreadable
 * -- and tampering is detected -- without DATA_KEY. Layout:
 * "RGS1" | 12-byte IV | 16-byte auth tag | ciphertext.
 */
const MAGIC = Buffer.from("RGS1");
const keyCache = new Map<string, Buffer>();

export function deriveKey(secret: string): Buffer {
  let key = keyCache.get(secret);
  if (!key) {
    key = scryptSync(secret, "regoose-store-v1", 32);
    keyCache.set(secret, key);
  }
  return key;
}

export function isSealed(blob: Buffer): boolean {
  return blob.length > MAGIC.length && blob.subarray(0, MAGIC.length).equals(MAGIC);
}

export function seal(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

/** Throws if the key is wrong or the data was modified. */
export function open(blob: Buffer, key: Buffer): Buffer {
  if (!isSealed(blob)) throw new Error("Not an encrypted data file.");
  const iv = blob.subarray(4, 16);
  const tag = blob.subarray(16, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]);
}
