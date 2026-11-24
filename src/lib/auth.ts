import { getSetting, setSetting, type PinRecord } from './settings';
import { logEvent } from './audit';

const ITERATIONS = 150_000;
export const PIN_LENGTH = 6;
const MAX_FAILS = 5;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

export async function hashSecret(secret: string, iterations = ITERATIONS): Promise<PinRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  return { salt: toHex(salt), hash: await derive(secret, salt, iterations), iterations };
}

export async function verifySecret(secret: string, rec: PinRecord): Promise<boolean> {
  const hash = await derive(secret, fromHex(rec.salt), rec.iterations);
  // constant-time compare
  if (hash.length !== rec.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0;
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/** Pins that are too easy to guess: 000000, 123456, 654321, 111111 … */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const asc = '01234567890';
  const desc = '09876543210';
  return asc.includes(pin) || desc.includes(pin);
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function normalizeRecovery(code: string): string {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}

export async function hasPin(): Promise<boolean> {
  return (await getSetting('pin')) !== null;
}

/** Create the manager PIN and a one-time recovery code. Returns the recovery code to show once. */
export async function setupPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก');
  const recovery = generateRecoveryCode();
  await setSetting('pin', await hashSecret(pin));
  await setSetting('recovery', await hashSecret(recovery));
  await setSetting('pinFails', 0);
  await setSetting('pinLockedUntil', 0);
  await logEvent('system', 'ตั้ง PIN ผู้จัดการ');
  return recovery;
}

export async function changePin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก');
  await setSetting('pin', await hashSecret(pin));
  await logEvent('system', 'เปลี่ยน PIN ผู้จัดการ');
}

export async function regenerateRecovery(): Promise<string> {
  const recovery = generateRecoveryCode();
  await setSetting('recovery', await hashSecret(recovery));
  await logEvent('system', 'สร้างรหัสกู้คืนใหม่');
  return recovery;
}

export type PinResult =
  | { ok: true }
  | { ok: false; locked: boolean; retryAt: number; remaining: number };

function lockDurationMs(fails: number): number {
  // 5 fails → 30 s, 6 → 60 s, 7 → 120 s … capped at 15 min
  const steps = fails - MAX_FAILS;
  return Math.min(30_000 * 2 ** Math.max(0, steps), 15 * 60_000);
}

export async function checkPin(pin: string, now = Date.now()): Promise<PinResult> {
  const rec = await getSetting('pin');
  const lockedUntil = await getSetting('pinLockedUntil');
  const fails = await getSetting('pinFails');
  if (lockedUntil > now) return { ok: false, locked: true, retryAt: lockedUntil, remaining: 0 };
  if (!rec) return { ok: false, locked: false, retryAt: 0, remaining: MAX_FAILS };
  if (await verifySecret(pin, rec)) {
    await setSetting('pinFails', 0);
    await setSetting('pinLockedUntil', 0);
    return { ok: true };
  }
  const nextFails = fails + 1;
  await setSetting('pinFails', nextFails);
  if (nextFails >= MAX_FAILS) {
    const until = now + lockDurationMs(nextFails);
    await setSetting('pinLockedUntil', until);
    await logEvent('system', `ใส่ PIN ผิด ${nextFails} ครั้ง ระบบล็อกชั่วคราว`);
    return { ok: false, locked: true, retryAt: until, remaining: 0 };
  }
  return { ok: false, locked: false, retryAt: 0, remaining: MAX_FAILS - nextFails };
}

/** Re-check the PIN for a sensitive action without touching the lockout counter on success paths. */
export async function confirmPin(pin: string): Promise<boolean> {
  const r = await checkPin(pin);
  return r.ok;
}

export async function resetWithRecovery(code: string, newPin: string): Promise<string | null> {
  const rec = await getSetting('recovery');
  if (!rec) return null;
  if (!(await verifySecret(normalizeRecovery(code), rec))) {
    await logEvent('system', 'ใส่รหัสกู้คืนไม่ถูกต้อง');
    return null;
  }
  await setSetting('pin', await hashSecret(newPin));
  const next = generateRecoveryCode();
  await setSetting('recovery', await hashSecret(next));
  await setSetting('pinFails', 0);
  await setSetting('pinLockedUntil', 0);
  await logEvent('system', 'ตั้ง PIN ใหม่ด้วยรหัสกู้คืน');
  return next;
}
