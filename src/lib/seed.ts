import { db, uid, type Category, type Product, type Sale, type Staff, type StockMove, type MistakeReport, type StoredImage } from './db';
import { addDays, dayKey, parseDayKey } from './format';
import { logEvent } from './audit';

/**
 * Sample data for trying the app. Every row is tagged `demo: true` so it can be
 * removed later without touching real records.
 */

const CATS = ['เครื่องดื่ม', 'โปรตีน', 'ของว่าง', 'อุปกรณ์', 'เสื้อผ้า', 'บริการ'];

type P = [name: string, cat: number, price: number, cost: number, stock: number, low: number, track?: boolean];
const PRODUCTS: P[] = [
  ['น้ำดื่ม 600 มล.', 0, 15, 6, 96, 24],
  ['เกลือแร่ Electrolyte', 0, 35, 18, 40, 12],
  ['กาแฟดำ Cold Brew', 0, 65, 24, 18, 8],
  ['น้ำมะพร้าว', 0, 45, 22, 6, 8],
  ['เวย์โปรตีน เชค', 1, 120, 52, 30, 10],
  ['Plant Protein เชค', 1, 140, 66, 14, 6],
  ['ครีเอทีน 1 ซอง', 1, 40, 15, 52, 15],
  ['BCAA 1 ซอง', 1, 45, 19, 3, 10],
  ['โปรตีนบาร์ ช็อกโกแลต', 2, 75, 41, 26, 10],
  ['โปรตีนบาร์ พีนัทบัตเตอร์', 2, 75, 41, 21, 10],
  ['กล้วยหอม', 2, 20, 9, 0, 6],
  ['สายรัดข้อมือ Lifting Strap', 3, 390, 160, 9, 3],
  ['ขวดเชค ORBIZ', 3, 290, 110, 12, 4],
  ['ถุงมือเทรน', 3, 450, 210, 5, 2],
  ['เสื้อ ORBIZ Training', 4, 690, 260, 16, 5],
  ['ผ้าเช็ดตัว (เช่า)', 5, 30, 4, 0, 0, false],
];

const STAFF = ['ฝน', 'บอส', 'แพร'];

const PALETTE = ['#A9DDF5', '#D7E8F0', '#E9E4DA', '#DCE8E0', '#ECE1E6', '#E4E4EA'];

/** A clean flat product tile, so sample products don't look empty. */
async function drawProductImage(name: string, cat: number): Promise<Blob> {
  const w = 600;
  const h = 480;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = PALETTE[cat % PALETTE.length];
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(16,17,19,0.88)';
  g.strokeStyle = 'rgba(16,17,19,0.88)';
  g.lineWidth = 14;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const cx = w / 2;
  const cy = h / 2 + 8;
  // Keep the glyph small enough to survive both the 5:4 tile crop and square thumbnails.
  g.translate(cx, cy);
  g.scale(0.62, 0.62);
  g.translate(-cx, -cy);
  const shape = cat;
  g.beginPath();
  if (shape === 0) {
    // bottle
    g.roundRect(cx - 52, cy - 110, 104, 230, 30);
    g.stroke();
    g.beginPath();
    g.roundRect(cx - 26, cy - 150, 52, 40, 10);
    g.fill();
    g.fillRect(cx - 52, cy - 10, 104, 50);
  } else if (shape === 1) {
    // shaker
    g.moveTo(cx - 80, cy - 90);
    g.lineTo(cx - 60, cy + 120);
    g.lineTo(cx + 60, cy + 120);
    g.lineTo(cx + 80, cy - 90);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.roundRect(cx - 90, cy - 140, 180, 46, 14);
    g.fill();
  } else if (shape === 2) {
    // bar
    g.roundRect(cx - 150, cy - 50, 300, 100, 26);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 90, cy - 50);
    g.lineTo(cx - 90, cy + 50);
    g.moveTo(cx + 90, cy - 50);
    g.lineTo(cx + 90, cy + 50);
    g.stroke();
  } else if (shape === 3) {
    // dumbbell
    g.roundRect(cx - 150, cy - 70, 50, 140, 14);
    g.roundRect(cx + 100, cy - 70, 50, 140, 14);
    g.fill();
    g.fillRect(cx - 100, cy - 12, 200, 24);
  } else if (shape === 4) {
    // tee
    g.moveTo(cx - 60, cy - 120);
    g.lineTo(cx - 150, cy - 70);
    g.lineTo(cx - 120, cy - 10);
    g.lineTo(cx - 90, cy - 30);
    g.lineTo(cx - 90, cy + 120);
    g.lineTo(cx + 90, cy + 120);
    g.lineTo(cx + 90, cy - 30);
    g.lineTo(cx + 120, cy - 10);
    g.lineTo(cx + 150, cy - 70);
    g.lineTo(cx + 60, cy - 120);
    g.quadraticCurveTo(cx, cy - 80, cx - 60, cy - 120);
    g.stroke();
  } else {
    // towel
    g.roundRect(cx - 120, cy - 110, 240, 220, 20);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 120, cy + 50);
    g.lineTo(cx + 120, cy + 50);
    g.stroke();
  }
  void name;
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.86));
}

/** Clearly marked placeholder in place of a real bank slip. */
async function drawSampleSlip(amount: number, when: number): Promise<Blob> {
  const w = 600;
  const h = 900;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#E6F5FC';
  g.fillRect(0, 0, w, 160);
  g.fillStyle = '#101113';
  g.font = '600 34px "Noto Sans Thai", sans-serif';
  g.fillText('สลิปตัวอย่าง', 48, 96);
  g.font = '400 24px "Noto Sans Thai", sans-serif';
  g.fillStyle = '#5E6066';
  g.fillText('ข้อมูลทดสอบ ไม่ใช่การโอนเงินจริง', 48, 136);
  g.fillStyle = '#5E6066';
  g.fillText('จำนวนเงิน', 48, 280);
  g.fillStyle = '#101113';
  g.font = '700 72px Inter, sans-serif';
  g.fillText(`฿${(amount / 100).toLocaleString('th-TH')}`, 48, 360);
  g.font = '400 26px "Noto Sans Thai", sans-serif';
  g.fillStyle = '#5E6066';
  g.fillText(new Date(when).toLocaleString('th-TH'), 48, 430);
  g.strokeStyle = '#E5E5EA';
  g.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(48, 520 + i * 70);
    g.lineTo(w - 48, 520 + i * 70);
    g.stroke();
  }
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.8));
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export async function loadDemoData(today = dayKey()): Promise<void> {
  if ((await db.products.count()) > 0 || (await db.sales.count()) > 0) {
    throw new Error('มีข้อมูลอยู่แล้ว ใส่ข้อมูลตัวอย่างได้เฉพาะเครื่องที่ยังว่าง');
  }
  const now = Date.now();
  const cats: Category[] = CATS.map((name, i) => ({ id: uid(), name, sort: i + 1, demo: true }));
  const staff: Staff[] = STAFF.map((name) => ({ id: uid(), name, active: true, createdAt: now, demo: true }));
  const images: StoredImage[] = [];
  const products: Product[] = [];
  for (const [i, [name, cat, price, cost, stock, low, track = true]] of PRODUCTS.entries()) {
    const imageId = uid();
    images.push({ id: imageId, kind: 'product', blob: await drawProductImage(name, cat), createdAt: now, demo: true });
    products.push({
      id: uid(),
      name,
      categoryId: cats[cat].id,
      price: price * 100,
      cost: cost * 100,
      stock: track ? stock : 0,
      trackStock: track,
      lowStock: low,
      imageId,
      active: true,
      sort: i + 1,
      createdAt: now,
      updatedAt: now,
      demo: true,
    });
  }

  // Two weeks of sales history. Stock above is the *current* balance, so history doesn't change it.
  const rand = rng(20261124);
  const sales: Sale[] = [];
  const moves: StockMove[] = [];
  let number = 0;
  const popular = products.filter((p) => p.price <= 14000);
  for (let d = -13; d <= 0; d++) {
    const day = addDays(today, d);
    const base = parseDayKey(day).getTime();
    const isToday = d === 0;
    const bills = isToday ? 9 : 10 + Math.floor(rand() * 12);
    const nowHour = new Date().getHours();
    for (let b = 0; b < bills; b++) {
      const hour = isToday ? Math.min(nowHour, 7 + Math.floor((b / bills) * Math.max(1, nowHour - 7))) : 6 + Math.floor(rand() * 15);
      const at = base + hour * 3600_000 + Math.floor(rand() * 59) * 60_000;
      if (at > now) continue;
      const lines = 1 + Math.floor(rand() * 2.4);
      const items = new Map<string, number>();
      for (let l = 0; l < lines; l++) {
        const pool = rand() < 0.85 ? popular : products;
        const p = pool[Math.floor(rand() * pool.length)];
        items.set(p.id, (items.get(p.id) ?? 0) + (rand() < 0.2 ? 2 : 1));
      }
      const saleItems = [...items].map(([pid, qty]) => {
        const p = products.find((x) => x.id === pid)!;
        return { productId: pid, name: p.name, price: p.price, cost: p.cost, qty };
      });
      const total = saleItems.reduce((s, i) => s + i.price * i.qty, 0);
      const transfer = rand() < 0.62;
      const s = staff[Math.floor(rand() * staff.length)];
      number += 1;
      const id = uid();
      let slipImageId: string | null = null;
      if (transfer) {
        slipImageId = uid();
        images.push({ id: slipImageId, kind: 'slip', blob: await drawSampleSlip(total, at), createdAt: at, demo: true });
      }
      const recent = d >= -1;
      sales.push({
        id,
        number,
        createdAt: at,
        day,
        staffId: s.id,
        staffName: s.name,
        items: saleItems,
        total,
        costTotal: saleItems.reduce((a, i) => a + i.cost * i.qty, 0),
        payment: transfer ? 'transfer' : 'cash',
        slipImageId,
        slipStatus: transfer ? (recent && rand() < 0.75 ? 'pending' : 'verified') : null,
        status: 'completed',
        demo: true,
      });
      for (const it of saleItems) {
        const p = products.find((x) => x.id === it.productId)!;
        if (p.trackStock) moves.push({ id: uid(), productId: p.id, productName: p.name, delta: -it.qty, balanceAfter: p.stock, reason: 'sale', refId: id, at, demo: true });
      }
    }
  }
  sales.sort((a, b) => a.createdAt - b.createdAt).forEach((s, i) => (s.number = i + 1));

  const reports: MistakeReport[] = [];
  const todays = sales.filter((s) => s.day === today);
  if (todays.length > 2) {
    const s = todays[1];
    reports.push({ id: uid(), saleId: s.id, saleNumber: s.number, staffName: s.staffName, reason: 'จำนวนไม่ถูกต้อง', note: 'ลูกค้าซื้อ 1 ชิ้น กดไป 2', createdAt: s.createdAt + 120_000, status: 'open', demo: true });
  }

  await db.transaction('rw', [db.categories, db.products, db.staff, db.sales, db.images, db.moves, db.reports, db.settings, db.log], async () => {
    await db.categories.bulkAdd(cats);
    await db.staff.bulkAdd(staff);
    await db.images.bulkAdd(images);
    await db.products.bulkAdd(products);
    await db.sales.bulkAdd(sales);
    await db.moves.bulkAdd(moves);
    await db.reports.bulkAdd(reports);
    const counter = (await db.settings.get('saleCounter'))?.value as number | undefined;
    await db.settings.put({ key: 'saleCounter', value: Math.max(counter ?? 0, sales.length) });
    await db.settings.put({ key: 'demoLoaded', value: true });
    await logEvent('system', 'ใส่ข้อมูลตัวอย่าง', `${products.length} สินค้า · ${sales.length} รายการขาย`);
  });
}

export async function removeDemoData(): Promise<void> {
  await db.transaction('rw', [db.categories, db.products, db.staff, db.sales, db.images, db.moves, db.reports, db.counts, db.log, db.settings], async () => {
    for (const t of [db.categories, db.products, db.staff, db.sales, db.images, db.moves, db.reports, db.counts] as const) {
      await (t as unknown as import('dexie').Table<{ demo?: boolean }, string>).filter((r) => r.demo === true).delete();
    }
    const last = await db.sales.orderBy('number').last();
    await db.settings.put({ key: 'saleCounter', value: last?.number ?? 0 });
    await db.settings.put({ key: 'demoLoaded', value: false });
    await logEvent('system', 'ลบข้อมูลตัวอย่าง');
  });
}
