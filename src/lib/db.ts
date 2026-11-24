import Dexie, { type Table } from 'dexie';

/** All money values are stored as integer satang (1 baht = 100 satang). */
export type Satang = number;

export interface Category {
  id: string;
  name: string;
  sort: number;
  demo?: boolean;
}

export interface Product {
  id: string;
  name: string;
  categoryId: string | null;
  price: Satang;
  cost: Satang;
  stock: number;
  trackStock: boolean;
  lowStock: number;
  imageId: string | null;
  active: boolean;
  sort: number;
  createdAt: number;
  updatedAt: number;
  demo?: boolean;
}

export interface Staff {
  id: string;
  name: string;
  active: boolean;
  createdAt: number;
  demo?: boolean;
}

export type PaymentMethod = 'cash' | 'transfer';
export type SlipStatus = 'pending' | 'verified' | 'flagged';

export interface SaleItem {
  productId: string;
  name: string;
  price: Satang;
  cost: Satang;
  qty: number;
}

export interface Sale {
  id: string;
  number: number;
  createdAt: number;
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  staffId: string;
  staffName: string;
  items: SaleItem[];
  total: Satang;
  costTotal: Satang;
  payment: PaymentMethod;
  slipImageId: string | null;
  slipStatus: SlipStatus | null;
  slipNote?: string;
  slipCheckedAt?: number;
  status: 'completed' | 'voided';
  voidReason?: string;
  voidedAt?: number;
  demo?: boolean;
}

export interface MistakeReport {
  id: string;
  saleId: string;
  saleNumber: number;
  staffName: string;
  reason: string;
  note: string;
  createdAt: number;
  status: 'open' | 'resolved';
  resolution?: string;
  resolvedAt?: number;
  demo?: boolean;
}

export type ImageKind = 'product' | 'slip' | 'logo';

export interface StoredImage {
  id: string;
  kind: ImageKind;
  blob: Blob;
  createdAt: number;
  demo?: boolean;
}

export type StockReason = 'sale' | 'void' | 'receive' | 'adjust' | 'count' | 'initial';

export interface StockMove {
  id: string;
  productId: string;
  productName: string;
  delta: number;
  balanceAfter: number;
  reason: StockReason;
  refId?: string;
  note?: string;
  at: number;
  demo?: boolean;
}

export interface CountSnapshotLine {
  productId: string;
  name: string;
  expected: number;
  counted: number;
  cost: Satang;
}

export interface StockCount {
  id: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  staffName: string;
  startedAt: number;
  updatedAt: number;
  /** productId -> counted quantity, while counting. */
  counts: Record<string, number>;
  submittedAt?: number;
  /** Frozen at submit time: system quantity vs counted quantity. */
  lines?: CountSnapshotLine[];
  reviewedAt?: number;
  reviewNote?: string;
  demo?: boolean;
}

export interface LogEntry {
  id: string;
  at: number;
  actor: string;
  area: 'sale' | 'product' | 'stock' | 'staff' | 'system';
  action: string;
  detail?: string;
  demo?: boolean;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class PosDB extends Dexie {
  categories!: Table<Category, string>;
  products!: Table<Product, string>;
  staff!: Table<Staff, string>;
  sales!: Table<Sale, string>;
  reports!: Table<MistakeReport, string>;
  images!: Table<StoredImage, string>;
  moves!: Table<StockMove, string>;
  counts!: Table<StockCount, string>;
  log!: Table<LogEntry, string>;
  settings!: Table<Setting, string>;

  constructor(name = 'orbiz-pos') {
    super(name);
    this.version(1).stores({
      categories: 'id, sort',
      products: 'id, categoryId, sort, name',
      staff: 'id, name',
      sales: 'id, &number, createdAt, day, payment, slipStatus, status',
      reports: 'id, saleId, status, createdAt',
      images: 'id, kind',
      moves: 'id, productId, at',
      counts: 'id, status, startedAt',
      log: 'id, at, area',
      settings: 'key',
    });
  }
}

export let db = new PosDB();

/** Test hook: point the module at a fresh database. */
export function useDatabase(next: PosDB) {
  db = next;
}

export const ALL_TABLES = [
  'categories',
  'products',
  'staff',
  'sales',
  'reports',
  'images',
  'moves',
  'counts',
  'log',
  'settings',
] as const;

export type TableName = (typeof ALL_TABLES)[number];

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
