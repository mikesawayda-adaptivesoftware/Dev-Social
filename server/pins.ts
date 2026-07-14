import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const KEY_LEN = 32;
const SALT_LEN = 16;

/**
 * Hash a PIN with scrypt and a per-PIN random salt. Returns `saltHex:hashHex`,
 * which is what gets stored in `players.pin_hash`. Uses only Node built-ins so
 * there's no extra dependency.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = (await scryptAsync(pin, salt, KEY_LEN)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/**
 * Constant-time verification of a PIN against a stored `saltHex:hashHex` value.
 * Returns false on any malformed input rather than throwing.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scryptAsync(pin, salt, expected.length)) as Buffer;
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}
