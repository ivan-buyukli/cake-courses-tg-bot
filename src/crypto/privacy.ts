import {
  encrypt,
  decrypt,
  serializeEncryptedPayload,
  parseEncryptedPayload,
} from "./encryption.js";
import { deriveUserKey } from "./keyDerivation.js";

export async function seal(
  value: unknown,
  scope: string,
  masterKey: string,
): Promise<string> {
  const key = await deriveUserKey(masterKey, `course-bot:${scope}`);
  return serializeEncryptedPayload(await encrypt(JSON.stringify(value), key));
}

export async function open<T>(
  value: string,
  scope: string,
  masterKey: string,
): Promise<T> {
  const key = await deriveUserKey(masterKey, `course-bot:${scope}`);
  return JSON.parse(await decrypt(parseEncryptedPayload(value), key)) as T;
}

export async function equalSecret(
  provided: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const a = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(provided)),
  );
  const b = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  );
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
