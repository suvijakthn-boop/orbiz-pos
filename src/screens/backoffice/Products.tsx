import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ChevronDown, ChevronUp, FolderCog, ImagePlus, Package, Pencil, Plus, Trash2, Check } from 'lucide-react';
import { db, type Product } from '../../lib/db';
import { baht, bahtInput, parseBaht, pct } from '../../lib/format';
import { addCategory, createProduct, deleteCategory, moveCategory, renameCategory, updateProduct, validateProduct, type ProductDraft } from '../../lib/inventory';
import { compressImage, storeImage } from '../../lib/images';
import { useAction } from '../../state/app';
import { Empty, SearchField, Seg, Sheet, Thumb, Toggle, useBusy, useFilePicker } from '../../components/ui';
import { PageHead } from './BackOffice';

type Status = 'active' | 'inactive' | 'all';

export function ProductsPage() {
  const products = useLiveQuery(() => db.products.orderBy('sort').toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [status, setStatus] = useState<Status>('active');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [cats, setCats] = useState(false);
  const catName = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c.name])), [categories]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (products ?? []).filter(
      (p) =>
        (status === 'all' || (status === 'active') === p.active) &&
        (cat === 'all' || (cat === 'none' ? !p.categoryId : p.categoryId === cat)) &&
        (!term || p.name.toLowerCase().includes(term)),
    );
  }, [products, q, cat, status]);

  return (
    <div className="page">
      <PageHead title="สินค้า" sub={`${(products ?? []).filter((p) => p.active).length} รายการที่เปิดขาย`}>
        <button className="btn btn-secondary" onClick={() => setCats(true)}>
          <FolderCog size={18} /> หมวดหมู่
        </button>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={18} /> เพิ่มสินค้า
        </button>
      </PageHead>
      <div className="page-body">
        <div className="toolbar">
          <SearchField value={q} onChange={setQ} placeholder="ค้นหาชื่อสินค้า" label="ค้นหาสินค้า" />
          <Seg<Status>
            value={status}
            onChange={setStatus}
            label="สถานะ"
            options={[
              { value: 'active', label: 'เปิดขาย' },
              { value: 'inactive', label: 'ปิดขาย' },
              { value: 'all', label: 'ทั้งหมด' },
            ]}
          />
        </div>
        <div className="chips" style={{ marginBottom: 16 }}>
          <button className="chip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>
            ทุกหมวด
          </button>
          {(categories ?? []).map((c) => (
            <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
          {(products ?? []).some((p) => !p.categoryId) && (
            <button className="chip" aria-pressed={cat === 'none'} onClick={() => setCat('none')}>
              ไม่มีหมวด
            </button>
          )}
        </div>
        <div className="card table-card">
          {products && products.length === 0 ? (
            <Empty
              icon={<Package size={28} />}
              title="ยังไม่มีสินค้า"
              action={
                <button className="btn btn-primary" onClick={() => setEditing('new')}>
                  <Plus size={18} /> เพิ่มสินค้าแรก
                </button>
              }
            >
              เพิ่มสินค้าพร้อมรูป ราคา และต้นทุน แล้วสินค้าจะขึ้นที่หน้าขายทันที
            </Empty>
          ) : list.length === 0 ? (
            <Empty icon={<Package size={28} />} title="ไม่พบสินค้า">
              ลองเปลี่ยนคำค้นหรือตัวกรอง
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>สินค้า</th>
                  <th className="r">ราคาขาย</th>
                  <th className="r">ต้นทุน</th>
                  <th className="r hide-narrow">กำไร</th>
                  <th className="r">คงเหลือ</th>
                  <th className="r hide-narrow">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const margin = p.price > 0 ? (p.price - p.cost) / p.price : NaN;
                  return (
                    <tr key={p.id} className="clickable" onClick={() => setEditing(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEditing(p)}>
                      <td>
                        <div className="row" style={{ gap: 12 }}>
                          <Thumb imageId={p.imageId} name={p.name} />
                          <div className="stack" style={{ minWidth: 0 }}>
                            <span className="t-strong ellipsis">{p.name}</span>
                            <span className="t-sm muted">{p.categoryId ? catName.get(p.categoryId) : 'ไม่มีหมวด'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="r num t-strong">{baht(p.price)}</td>
                      <td className="r num">{baht(p.cost)}</td>
                      <td className={`r num hide-narrow ${p.cost > p.price ? 'diff-neg' : ''}`}>{pct(margin)}</td>
                      <td className="r num">{p.trackStock ? (p.stock <= 0 ? <span className="badge danger">หมด</span> : p.stock <= p.lowStock ? <span className="badge warning">{p.stock}</span> : p.stock) : <span className="muted">ไม่นับ</span>}</td>
                      <td className="r hide-narrow">{p.active ? <span className="badge success">เปิดขาย</span> : <span className="badge">ปิดขาย</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {editing && <ProductEditor product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <CategoriesSheet open={cats} onClose={() => setCats(false)} />
    </div>
  );
}

/* ---------------- editor ---------------- */

function ProductEditor({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []);
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(product?.categoryId ?? null);
  const [price, setPrice] = useState(product ? bahtInput(product.price) : '');
  const [cost, setCost] = useState(product ? bahtInput(product.cost) : '');
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? true);
  const [lowStock, setLowStock] = useState(String(product?.lowStock ?? 5));
  const [initialStock, setInitialStock] = useState('0');
  const [active, setActive] = useState(product?.active ?? true);
  const [imageId, setImageId] = useState<string | null>(product?.imageId ?? null);
  const [shown, setShown] = useState(false);
  const act = useAction();
  const [busy, run] = useBusy();
  const [imgBusy, setImgBusy] = useState(false);

  const original = product?.imageId ?? null;
  const replaceImage = (next: string | null) => {
    // A photo picked in this editor and then replaced was never saved: drop it.
    if (imageId && imageId !== original) db.images.delete(imageId);
    setImageId(next);
  };
  const onImage = async (f: File) => {
    setImgBusy(true);
    const id = await act(async () => storeImage(await compressImage(f, 'product'), 'product'));
    if (id) replaceImage(id);
    setImgBusy(false);
  };
  const camera = useFilePicker(onImage, { capture: true });
  const library = useFilePicker(onImage);

  const draft: ProductDraft = {
    name,
    categoryId,
    price: parseBaht(price) ?? -1,
    cost: parseBaht(cost) ?? -1,
    trackStock,
    lowStock: /^\d+$/.test(lowStock) ? Number(lowStock) : -1,
    active,
    imageId,
    initialStock: product ? undefined : /^\d+$/.test(initialStock) ? Number(initialStock) : -1,
  };
  const errors = validateProduct(draft);
  const show = (k: string) => (shown ? errors[k] : undefined);
  const profit = draft.price >= 0 && draft.cost >= 0 ? draft.price - draft.cost : null;

  const close = () => {
    // Discard a newly picked photo that was never saved.
    if (imageId && imageId !== original) db.images.delete(imageId);
    onClose();
  };

  const save = () =>
    run(async () => {
      setShown(true);
      if (Object.keys(errors).length) return;
      const ok = await act(async () => {
        if (product) await updateProduct(product.id, draft);
        else await createProduct(draft);
        if (product?.imageId && product.imageId !== imageId) await db.images.delete(product.imageId);
        return true;
      }, product ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มสินค้าแล้ว');
      if (ok) onClose();
    });

  return (
    <Sheet
      open
      variant="side"
      onClose={close}
      title={product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}
      footer={
        <>
          <button className="btn btn-secondary btn-lg" onClick={close}>
            ยกเลิก
          </button>
          <button className="btn btn-primary btn-lg" onClick={save} disabled={busy || imgBusy}>
            {product ? 'บันทึก' : 'เพิ่มสินค้า'}
          </button>
        </>
      }
    >
      <div className="img-picker">
        <Thumb imageId={imageId} name={name || '?'} />
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <button className="btn btn-secondary btn-sm" onClick={camera.open} disabled={imgBusy}>
              <Camera size={16} /> ถ่ายรูป
            </button>
            <button className="btn btn-secondary btn-sm" onClick={library.open} disabled={imgBusy}>
              <ImagePlus size={16} /> เลือกรูป
            </button>
          </div>
          {imageId && (
            <button className="btn btn-danger-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => replaceImage(null)}>
              <Trash2 size={16} /> เอารูปออก
            </button>
          )}
          {imgBusy && <span className="help">กำลังเตรียมรูป…</span>}
        </div>
        {camera.input}
        {library.input}
      </div>

      <div className="field">
        <label className="label" htmlFor="p-name">
          ชื่อสินค้า
        </label>
        <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!show('name')} maxLength={60} placeholder="เช่น เวย์โปรตีน เชค" />
        {show('name') && <span className="error-text">{show('name')}</span>}
      </div>

      <div className="field">
        <span className="label">หมวดหมู่</span>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="chip" aria-pressed={categoryId === null} onClick={() => setCategoryId(null)}>
            ไม่มีหมวด
          </button>
          {(categories ?? []).map((c) => (
            <button key={c.id} className="chip" aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="p-price">
            ราคาขาย
          </label>
          <div className="input-affix">
            <span className="affix">฿</span>
            <input id="p-price" className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={!!show('price')} placeholder="0" />
          </div>
          {show('price') && <span className="error-text">{show('price')}</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="p-cost">
            ต้นทุน
          </label>
          <div className="input-affix">
            <span className="affix">฿</span>
            <input id="p-cost" className="input num" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} aria-invalid={!!show('cost')} placeholder="0" />
          </div>
          {show('cost') && <span className="error-text">{show('cost')}</span>}
        </div>
      </div>
      {profit !== null && draft.price > 0 && (
        <div className={`notice ${profit < 0 ? 'warning' : ''}`}>
          {profit < 0 ? `ราคาขายต่ำกว่าต้นทุน ขาดทุน ${baht(-profit)} ต่อชิ้น` : `กำไร ${baht(profit)} ต่อชิ้น · ${pct(profit / draft.price)}`}
        </div>
      )}
      <p className="help" style={{ marginTop: -8 }}>
        พนักงานเห็นเฉพาะราคาขาย ไม่เห็นต้นทุนและกำไร
      </p>

      <div className="card" style={{ padding: '0 16px' }}>
        <div className="toggle-row">
          <div className="stack" style={{ flex: 1 }}>
            <span className="t-strong">นับสต็อก</span>
            <span className="help">ปิดสำหรับบริการหรือของที่ไม่ต้องนับ เช่น ค่าเช่าผ้า</span>
          </div>
          <Toggle checked={trackStock} onChange={setTrackStock} label="นับสต็อก" />
        </div>
        <hr className="divider" />
        <div className="toggle-row">
          <div className="stack" style={{ flex: 1 }}>
            <span className="t-strong">เปิดขาย</span>
            <span className="help">ปิดแล้วสินค้าจะไม่ขึ้นที่หน้าขาย ประวัติการขายยังอยู่ครบ</span>
          </div>
          <Toggle checked={active} onChange={setActive} label="เปิดขาย" />
        </div>
      </div>

      {trackStock && (
        <div className="form-grid">
          {!product && (
            <div className="field">
              <label className="label" htmlFor="p-init">
                สต็อกเริ่มต้น
              </label>
              <input id="p-init" className="input num" inputMode="numeric" value={initialStock} onChange={(e) => setInitialStock(e.target.value.replace(/\D/g, ''))} aria-invalid={!!show('initialStock')} />
              {show('initialStock') && <span className="error-text">{show('initialStock')}</span>}
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="p-low">
              แจ้งใกล้หมดเมื่อเหลือ
            </label>
            <input id="p-low" className="input num" inputMode="numeric" value={lowStock} onChange={(e) => setLowStock(e.target.value.replace(/\D/g, ''))} aria-invalid={!!show('lowStock')} />
            {show('lowStock') && <span className="error-text">{show('lowStock')}</span>}
          </div>
        </div>
      )}
      {product?.trackStock && (
        <p className="help">
          คงเหลือตอนนี้ <b className="num">{product.stock}</b> ชิ้น · รับของเข้าหรือปรับยอดได้ที่หน้า สต็อก
        </p>
      )}
    </Sheet>
  );
}

/* ---------------- categories ---------------- */

function CategoriesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const categories = useLiveQuery(() => db.categories.orderBy('sort').toArray(), []);
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const p of await db.products.toArray()) if (p.categoryId) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1);
    return m;
  }, []);
  const [name, setName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const act = useAction();
  useEffect(() => {
    if (!open) {
      setEditId(null);
      setName('');
    }
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="หมวดหมู่สินค้า" variant="side">
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act(() => addCategory(name), 'เพิ่มหมวดหมู่แล้ว')) setName('');
        }}
      >
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อหมวดหมู่ใหม่" aria-label="ชื่อหมวดหมู่ใหม่" maxLength={30} />
        <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
          เพิ่ม
        </button>
      </form>
      <div className="card">
        {(categories ?? []).length === 0 && <p className="muted" style={{ padding: 20 }}>ยังไม่มีหมวดหมู่</p>}
        {(categories ?? []).map((c, i, arr) => {
          const used = counts?.get(c.id) ?? 0;
          return (
            <div key={c.id} className="list-row" style={{ gap: 4, paddingRight: 8 }}>
              {editId === c.id ? (
                <form
                  className="row"
                  style={{ flex: 1 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await act(() => renameCategory(c.id, editName));
                    setEditId(null);
                  }}
                >
                  <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="ชื่อหมวดหมู่" autoFocus maxLength={30} />
                  <button className="icon-btn" type="submit" aria-label="บันทึกชื่อ">
                    <Check size={20} />
                  </button>
                </form>
              ) : (
                <>
                  <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                    <span className="t-strong ellipsis">{c.name}</span>
                    <span className="t-sm muted num">{used} สินค้า</span>
                  </div>
                  <button className="icon-btn" aria-label={`ย้าย ${c.name} ขึ้น`} disabled={i === 0} onClick={() => moveCategory(c.id, -1)}>
                    <ChevronUp size={20} />
                  </button>
                  <button className="icon-btn" aria-label={`ย้าย ${c.name} ลง`} disabled={i === arr.length - 1} onClick={() => moveCategory(c.id, 1)}>
                    <ChevronDown size={20} />
                  </button>
                  <button className="icon-btn" aria-label={`เปลี่ยนชื่อ ${c.name}`} onClick={() => (setEditId(c.id), setEditName(c.name))}>
                    <Pencil size={18} />
                  </button>
                  <button
                    className="icon-btn"
                    style={{ color: used ? undefined : 'var(--danger)' }}
                    aria-label={`ลบ ${c.name}`}
                    disabled={used > 0}
                    title={used ? 'ย้ายสินค้าออกก่อนจึงลบได้' : undefined}
                    onClick={() => act(() => deleteCategory(c.id), 'ลบหมวดหมู่แล้ว')}
                  >
                    <Trash2 size={18} />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="help">ลำดับหมวดหมู่ที่นี่คือลำดับที่พนักงานเห็นในหน้าขาย หมวดที่ยังมีสินค้าลบไม่ได้</p>
    </Sheet>
  );
}
