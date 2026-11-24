import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, Camera, Check, ChevronDown, Minus, Plus, QrCode, RefreshCcw, ShoppingBag, Trash2, PackageOpen, UserRound } from 'lucide-react';
import { db, uid, type PaymentMethod, type Product } from '../../lib/db';
import { baht, saleNo, fmtTime } from '../../lib/format';
import { completeSale, type CartLine } from '../../lib/sales';
import { compressImage, useBlobUrl } from '../../lib/images';
import { useCurrentStaff, useToast, useAction } from '../../state/app';
import { Empty, ProductImage, SearchField, useBusy, useFilePicker, Avatar } from '../../components/ui';
import { ImageViewer } from '../../components/ImageViewer';
import { StaffPicker } from './StaffPicker';

/* ---------------- cart state (survives tab switches and app restarts) ---------------- */

interface Cart {
  orderId: string;
  lines: CartLine[];
  payment: PaymentMethod | null;
}

const CART_KEY = 'orbiz-pos.cart';
const newCart = (): Cart => ({ orderId: uid(), lines: [], payment: null });

function loadCart(): Cart {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) {
      const c = JSON.parse(raw) as Cart;
      if (c && Array.isArray(c.lines) && typeof c.orderId === 'string') return c;
    }
  } catch {
    /* ignore */
  }
  return newCart();
}

let memoryCart: Cart | null = null;
let memorySlip: Blob | null = null;

function useCart() {
  const [cart, setCartState] = useState<Cart>(() => memoryCart ?? loadCart());
  const [slip, setSlipState] = useState<Blob | null>(memorySlip);
  const setCart = useCallback((fn: (c: Cart) => Cart) => {
    setCartState((c) => {
      const next = fn(c);
      memoryCart = next;
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const setSlip = useCallback((b: Blob | null) => {
    memorySlip = b;
    setSlipState(b);
  }, []);
  return { cart, setCart, slip, setSlip };
}

/* ---------------- screen ---------------- */

interface Done {
  number: number;
  total: number;
  payment: PaymentMethod;
  at: number;
  staffName: string;
}

export function PosScreen({ onGoBackOffice }: { onGoBackOffice: () => void }) {
  const products = useLiveQuery(() => db.products.orderBy('sort').toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []);
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const { cart, setCart, slip, setSlip } = useCart();
  const [done, setDone] = useState<Done | null>(null);
  const toast = useToast();

  const active = useMemo(() => (products ?? []).filter((p) => p.active), [products]);
  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const qtyOf = (id: string) => cart.lines.find((l) => l.productId === id)?.qty ?? 0;

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return active.filter((p) => (cat === 'all' || p.categoryId === cat) && (!term || p.name.toLowerCase().includes(term)));
  }, [active, cat, q]);

  const usedCats = useMemo(() => (categories ?? []).filter((c) => active.some((p) => p.categoryId === c.id)), [categories, active]);

  const add = (p: Product) => {
    const inCart = qtyOf(p.id);
    if (p.trackStock && inCart >= p.stock) {
      toast({ text: p.stock === 0 ? `${p.name} หมดสต็อก` : `${p.name} เหลือ ${p.stock} ชิ้น`, tone: 'error' });
      return;
    }
    setCart((c) => {
      const exists = c.lines.some((l) => l.productId === p.id);
      return {
        ...c,
        lines: exists ? c.lines.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...c.lines, { productId: p.id, qty: 1 }],
      };
    });
  };

  if (products === undefined) return <div className="catalog" />;

  return (
    <>
      <section className="catalog" aria-label="สินค้า">
        <div className="catalog-head">
          <SearchField value={q} onChange={setQ} placeholder="ค้นหาสินค้า" label="ค้นหาสินค้า" />
          {usedCats.length > 0 && (
            <div className="chips" role="tablist" aria-label="หมวดหมู่">
              <button className="chip" role="tab" aria-selected={cat === 'all'} onClick={() => setCat('all')}>
                ทั้งหมด
              </button>
              {usedCats.map((c) => (
                <button key={c.id} className="chip" role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {active.length === 0 ? (
          <Empty
            icon={<PackageOpen size={30} />}
            title="ยังไม่มีสินค้าให้ขาย"
            action={
              <button className="btn btn-secondary" onClick={onGoBackOffice}>
                ไปที่ระบบจัดการ
              </button>
            }
          >
            ผู้จัดการเพิ่มสินค้าได้ที่ ระบบจัดการ → สินค้า
          </Empty>
        ) : visible.length === 0 ? (
          <Empty icon={<PackageOpen size={30} />} title="ไม่พบสินค้า">
            {q ? `ไม่มีสินค้าที่ชื่อมีคำว่า “${q}”` : 'หมวดนี้ยังไม่มีสินค้า'}
          </Empty>
        ) : (
          <div className="catalog-grid">
            {visible.map((p) => (
              <ProductTile key={p.id} p={p} qty={qtyOf(p.id)} onAdd={() => add(p)} />
            ))}
          </div>
        )}
      </section>
      <CartPanel
        cart={cart}
        setCart={setCart}
        slip={slip}
        setSlip={setSlip}
        byId={byId}
        onDone={(d) => {
          setDone(d);
          setSlip(null);
          setCart(() => newCart());
        }}
      />
      {done && <SuccessScreen done={done} onNew={() => setDone(null)} />}
    </>
  );
}

function ProductTile({ p, qty, onAdd }: { p: Product; qty: number; onAdd: () => void }) {
  const left = p.stock - qty;
  const out = p.trackStock && p.stock <= 0;
  const low = p.trackStock && !out && p.stock <= p.lowStock;
  return (
    <button
      className={`tile ${qty > 0 ? 'in-cart' : ''}`}
      onClick={onAdd}
      disabled={out}
      aria-label={`${p.name} ${baht(p.price)}${out ? ' หมด' : ''}${qty ? ` ในรายการ ${qty}` : ''}`}
    >
      <div className="tile-img">
        <ProductImage imageId={p.imageId} name={p.name} />
        {qty > 0 && (
          <span key={qty} className="tile-qty num">
            {qty}
          </span>
        )}
        {out && <span className="badge tile-out">หมด</span>}
      </div>
      <div className="tile-body">
        <span className="tile-name clamp-2">{p.name}</span>
        <div className="tile-meta">
          <span className="tile-price num">{baht(p.price)}</span>
          {p.trackStock && !out && <span className={`tile-stock num ${low ? 'low' : ''}`}>เหลือ {Math.max(0, left)}</span>}
        </div>
      </div>
    </button>
  );
}

/* ---------------- cart ---------------- */

function CartPanel({
  cart,
  setCart,
  slip,
  setSlip,
  byId,
  onDone,
}: {
  cart: Cart;
  setCart: (fn: (c: Cart) => Cart) => void;
  slip: Blob | null;
  setSlip: (b: Blob | null) => void;
  byId: Map<string, Product>;
  onDone: (d: Done) => void;
}) {
  const { staff, setStaffId } = useCurrentStaff();
  const [pickStaff, setPickStaff] = useState(false);
  const [viewSlip, setViewSlip] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [busy, runBusy] = useBusy();
  const toast = useToast();
  const act = useAction();
  const slipUrl = useBlobUrl(slip);

  const camera = useFilePicker(
    async (f) => {
      setProcessing(true);
      await act(async () => setSlip(await compressImage(f, 'slip')));
      setProcessing(false);
    },
    { capture: true },
  );

  const lines = cart.lines.map((l) => ({ ...l, product: byId.get(l.productId) }));
  const total = lines.reduce((s, l) => s + (l.product?.price ?? 0) * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const hasInvalid = lines.some((l) => !l.product || !l.product.active);

  const setQty = (id: string, qty: number) =>
    setCart((c) => ({ ...c, lines: qty <= 0 ? c.lines.filter((l) => l.productId !== id) : c.lines.map((l) => (l.productId === id ? { ...l, qty } : l)) }));

  const clear = () => {
    const snapshot = cart;
    const snapSlip = slip;
    setCart((c) => ({ ...c, lines: [], payment: null }));
    setSlip(null);
    toast({ text: 'ล้างรายการแล้ว', action: { label: 'เลิกทำ', run: () => (setCart(() => snapshot), setSlip(snapSlip)) } });
  };

  const setPayment = (p: PaymentMethod) => {
    setCart((c) => ({ ...c, payment: p }));
    // Open the camera inside the same tap, so iPad Safari allows it.
    if (p === 'transfer' && !slip && cart.payment !== 'transfer') camera.open();
  };

  const step: 'empty' | 'staff' | 'payment' | 'slip' | 'ready' =
    lines.length === 0 ? 'empty' : !staff ? 'staff' : !cart.payment ? 'payment' : cart.payment === 'transfer' && !slip ? 'slip' : 'ready';

  const submit = () =>
    runBusy(async () => {
      if (!staff || !cart.payment) return;
      const sale = await act(() =>
        completeSale({ orderId: cart.orderId, lines: cart.lines, staffId: staff.id, payment: cart.payment!, slip: cart.payment === 'transfer' ? slip : null }),
      );
      if (sale) onDone({ number: sale.number, total: sale.total, payment: sale.payment, at: sale.createdAt, staffName: sale.staffName });
    });

  return (
    <aside className="cart" aria-label="รายการขาย">
      <div className="cart-head">
        <h2>รายการขาย</h2>
        {count > 0 && <span className="badge num">{count} ชิ้น</span>}
        <span className="spacer" />
        {lines.length > 0 && (
          <button className="icon-btn" onClick={clear} aria-label="ล้างรายการทั้งหมด">
            <Trash2 size={20} />
          </button>
        )}
      </div>
      <div style={{ padding: '0 16px 8px 20px' }}>
        <button className={`staff-btn ${staff ? '' : 'missing'}`} onClick={() => setPickStaff(true)} aria-label={staff ? `พนักงาน ${staff.name} แตะเพื่อเปลี่ยน` : 'เลือกชื่อพนักงาน'}>
          {staff ? <Avatar name={staff.name} size={32} /> : <UserRound size={18} />}
          <span className="ellipsis">{staff ? staff.name : 'เลือกชื่อพนักงาน'}</span>
          <ChevronDown size={16} />
        </button>
      </div>

      {lines.length === 0 ? (
        <div className="cart-empty">
          <div className="ring">
            <ShoppingBag size={28} />
          </div>
          <strong style={{ color: 'var(--text)' }}>ยังไม่มีสินค้า</strong>
          <span className="t-sm">แตะสินค้าทางซ้ายเพื่อเพิ่มในรายการ</span>
        </div>
      ) : (
        <div className="cart-lines" role="list">
          {lines.map((l) => {
            const p = l.product;
            const maxed = !!p && p.trackStock && l.qty >= p.stock;
            return (
              <div className="line" role="listitem" key={l.productId}>
                <span className="line-name">{p ? p.name : 'สินค้านี้ถูกลบแล้ว'}{p && !p.active && <span className="error-text"> · ปิดการขายแล้ว</span>}</span>
                <span className="line-total num">{baht((p?.price ?? 0) * l.qty)}</span>
                <div className="stepper" role="group" aria-label={`จำนวน ${p?.name ?? ''}`}>
                  <button className={l.qty === 1 ? 'remove' : ''} onClick={() => setQty(l.productId, l.qty - 1)} aria-label={l.qty === 1 ? 'เอาออกจากรายการ' : 'ลดจำนวน'}>
                    {l.qty === 1 ? <Trash2 size={18} /> : <Minus size={18} />}
                  </button>
                  <output className="num" aria-live="polite">
                    {l.qty}
                  </output>
                  <button onClick={() => setQty(l.productId, l.qty + 1)} disabled={!p || maxed} aria-label="เพิ่มจำนวน">
                    <Plus size={18} />
                  </button>
                </div>
                <span className="line-unit num">{p ? `${baht(p.price)} / ชิ้น` : ''}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="cart-foot">
        <div className="total-row">
          <span className="label">ยอดรวม</span>
          <span className="total-amount num" aria-live="polite">
            {baht(total)}
          </span>
        </div>
        <div className="pay-methods" role="group" aria-label="วิธีชำระเงิน">
          <button className="pay-method" aria-pressed={cart.payment === 'cash'} disabled={lines.length === 0} onClick={() => setPayment('cash')}>
            <Banknote size={22} /> เงินสด
          </button>
          <button className="pay-method" aria-pressed={cart.payment === 'transfer'} disabled={lines.length === 0} onClick={() => setPayment('transfer')}>
            <QrCode size={22} /> โอนเงิน
          </button>
        </div>
        {cart.payment === 'transfer' && lines.length > 0 && (
          slip && slipUrl ? (
            <div className="slip-preview">
              <button className="slip-thumb" onClick={() => setViewSlip(true)} aria-label="ดูรูปสลิปเต็มจอ">
                <img src={slipUrl} alt="" />
              </button>
              <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                <span className="t-sm t-strong row" style={{ gap: 6 }}>
                  <Check size={16} color="var(--success)" /> ถ่ายรูปสลิปแล้ว
                </span>
                <span className="t-xs muted">แตะรูปเพื่อตรวจให้ชัด</span>
              </div>
              <button className="icon-btn" onClick={camera.open} aria-label="ถ่ายรูปสลิปใหม่">
                <RefreshCcw size={20} />
              </button>
              <button className="icon-btn" onClick={() => setSlip(null)} aria-label="ลบรูปสลิป">
                <Trash2 size={20} />
              </button>
            </div>
          ) : (
            <button className="slip-capture" onClick={camera.open} disabled={processing}>
              <Camera size={22} /> {processing ? 'กำลังเตรียมรูป…' : 'ถ่ายรูปสลิป'}
            </button>
          )
        )}
        {camera.input}
        {step === 'staff' ? (
          <button className="btn btn-secondary btn-lg btn-block" onClick={() => setPickStaff(true)}>
            <UserRound size={20} /> เลือกชื่อพนักงานก่อนบันทึก
          </button>
        ) : step === 'slip' ? (
          <button className="btn btn-primary btn-lg btn-block" onClick={camera.open} disabled={processing}>
            <Camera size={20} /> ถ่ายรูปสลิป
          </button>
        ) : (
          <button className="btn btn-primary btn-lg btn-block" disabled={step !== 'ready' || busy || hasInvalid} onClick={submit} data-testid="complete-sale">
            {busy ? 'กำลังบันทึก…' : `บันทึกการขาย${lines.length ? ` · ${baht(total)}` : ''}`}
          </button>
        )}
        <p className="checkout-hint">
          {hasInvalid ? 'เอาสินค้าที่ปิดการขายออกก่อน' : step === 'payment' ? 'เลือกวิธีชำระเงิน' : step === 'slip' ? 'ลูกค้าโอนแล้ว ถ่ายรูปสลิปเก็บไว้' : ' '}
        </p>
      </div>

      <StaffPicker open={pickStaff} onClose={() => setPickStaff(false)} current={staff?.id ?? null} onPick={(id) => (setStaffId(id), setPickStaff(false))} />
      {viewSlip && slipUrl && <ImageViewer url={slipUrl} onClose={() => setViewSlip(false)} title="ตรวจรูปสลิป" />}
    </aside>
  );
}

/* ---------------- success ---------------- */

function SuccessScreen({ done, onNew }: { done: Done; onNew: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') onNew();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNew]);
  return (
    <div className="success-screen" role="alertdialog" aria-modal="true" aria-labelledby="success-title">
      <div className="success-check">
        <Check size={52} strokeWidth={2.6} />
      </div>
      <h1 id="success-title">บันทึกการขายแล้ว</h1>
      <div className="success-amount num">{baht(done.total)}</div>
      <div className="success-meta num">
        <span>
          เลขที่ <b>{saleNo(done.number)}</b>
        </span>
        <span>·</span>
        <span>{done.payment === 'cash' ? 'เงินสด' : 'โอนเงิน'}</span>
        <span>·</span>
        <span>{fmtTime(done.at)}</span>
        <span>·</span>
        <span>{done.staffName}</span>
      </div>
      <button className="btn btn-lg" onClick={onNew} autoFocus>
        <Plus size={20} /> รายการใหม่
      </button>
    </div>
  );
}
