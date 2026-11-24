import { db } from './db';

export interface PinRecord {
  salt: string;
  hash: string;
  iterations: number;
}

export interface SettingsShape {
  shopName: string;
  logoImageId: string | null;
  theme: 'system' | 'light' | 'dark';
  autoLockMinutes: number;
  pin: PinRecord | null;
  recovery: PinRecord | null;
  pinFails: number;
  pinLockedUntil: number;
  saleCounter: number;
  lastBackupAt: number | null;
  demoLoaded: boolean;
}

export const DEFAULT_SETTINGS: SettingsShape = {
  shopName: 'ORBIZ SOCIAL CLUB',
  logoImageId: null,
  theme: 'system',
  autoLockMinutes: 5,
  pin: null,
  recovery: null,
  pinFails: 0,
  pinLockedUntil: 0,
  saleCounter: 0,
  lastBackupAt: null,
  demoLoaded: false,
};

export async function getSetting<K extends keyof SettingsShape>(key: K): Promise<SettingsShape[K]> {
  const row = await db.settings.get(key);
  return (row ? row.value : DEFAULT_SETTINGS[key]) as SettingsShape[K];
}

export async function setSetting<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]): Promise<void> {
  await db.settings.put({ key, value });
}

export async function getAllSettings(): Promise<SettingsShape> {
  const rows = await db.settings.toArray();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as SettingsShape;
}
