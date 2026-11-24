import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck, ClipboardList, Minus, Plus, ArrowRight, PackageOpen, UserRound } from 'lucide-react';
import { db, type Product, type StockCount } from '../../lib/db';
import { fmtDateTime, ago } from '../../lib/format';
import { discardCount, saveCountDraft, startCount, submitCount } from '../../lib/inventory';
import { useAction, useCurrentStaff } from '../../state/app';
import { Empty, Keypad, SearchField, Seg, Sheet, Thumb, useBusy } from '../../components/ui';
import { StaffPicker } from './StaffPicker';

export function StockCountScreen() {
  const draft = useLiveQuery(async () => (await db.counts.where('status').equals('draft').first()) ?? null, []);
  const last = useLiveQuery(async () => (await db.counts.orderBy('startedAt').reverse().filter((c) => c.status !== 'draft').first()) ?? null, []);
  if (draft === undefined || last === undefined) return <div className="page" />;
  if (draft) return <Counting count={draft} />;
  return <StartCount last={last} />;
}

function StartCount({ last }: { last: StockCount | null }) {
  const { staff, setStaffId } = useCurrentStaff();
  const [pick, setPick] = useState(false);
  const act = useAction();
  const [busy, run] = useBusy();
  const tracked = useLiveQuery(async () => (await db.products.toArray()).filter((p) => p.active && p.trackStock).length, []);
  return (
    <section className="page">
      <header className="page-head">
        <h1>ตรวจนับสต็อก</h1>
      </header>
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div className="card card-pad stack" style={{ gap: 20, maxWidth: 560, width: '100%', marginTop: 24 }}>
          {last?.status === 'submitted' && (
            <div className="notice accent">
              <ClipboardCheck size={20} />
              <div>
                <div className="t-strong">ส่งผลตรวจนับแล้ว รอผู้จัดการตรวจ</div>
                <div>
                  {last.staffName} · {fmtDateTime(last.submittedAt ?? last.updatedAt)}
                </div>
              </div>
            </div>
          )}
          {last?.status === 'rejected' && (
            <div className="notice warning">
              <ClipboardList size={20} />
              <div>
                <div className="t-strong">ผู้จัดการขอให้นับใหม่</div>
                <div>{last.reviewNote}</div>
              </div>
            </div>
          )}
          {last?.status === 'approved' && (
            <div className="notice success">
              <ClipboardCheck size={20} />
              <div>
                <div className="t-strong">รอบล่าสุดผู้จัดการอนุมัติแล้ว</div>
                <div>{ago(last.reviewedAt ?? last.updatedAt)}</div>
              </div>
            </div>
          )}
          <div className="stack" style={{ gap: 8 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700 }}>เริ่มรอบตรวจนับใหม่</h2>
            <p className="muted">นับของจริงบนชั้นทีละรายการ แล้วใส่จำนวนที่นับได้ บันทึกร่างไว้ได้ระหว่างนับ เมื่อนับครบให้กดส่ง ผู้จัดการจะเป็นคนตรวจและปรับยอดสต็อก</p>
            <p className="t-sm muted">สินค้าที่ต้องนับ {tracked ?? 0} รายการ</p>
          </div>
          {staff ? (
            <div className="row">
              <span className="muted">ผู้นับ</span>
              <button className="staff-btn" onClick={() => setPick(true)}>
                <UserRound size={18} /> {staff.name}
              </button>
            </div>
          ) : null}
          <button
            className="btn btn-primary btn-lg btn-block"
            disabled={busy || tracked === 0}
            onClick={() => (staff ? run(() => act(() => startCount(staff.name))) : setPick(true))}
          >
            {staff ? 'เริ่มตรวจนับ' : 'เลือกชื่อผู้นับก่อนเริ่ม'}
          </button>
          {tracked === 0 && <p className="help">ยังไม่มีสินค้าที่นับสต็อก ผู้จัดการเพิ่มได้ในระบบจัดการ</p>}
        </div>
      </div>
      <StaffPicker open={pick} onClose={() => setPick(false)} current={staff?.id ?? null} onPick={(id) => (setStaffId(id), setPick(false))} />
    </section>
  );
}

type Filter = 'all' | 'todo' | 'done';

function Counting({ count }: { count: StockCount }) {
  const products = useLiveQuery(() => db.products.orderBy('sort').toArray(), []);
  const categories = useLiveQuery(() => db.categories.toArray(), []);
  const [counts, setCounts] = useState<Record<string, number>>(count.counts);
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [confirm, setConfirm] = useState<'submit' | 'discard' | null>(null);
  const [savedAt, setSavedAt] = useState<number>(count.updatedAt);
  const { staff } = useCurrentStaff();
  const act = useAction();
  const [busy, run] = useBusy();
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => (products ?? []).filter((p) => p.active && p.trackStock), [products]);
  const catName = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c.name])), [categories]);
  const doneCount = items.filter((p) => counts[p.id] !== undefined).length;

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter(
      (p) => (!term || p.name.toLowerCase().includes(term)) && (filter === 'all' || (filter === 'done') === (counts[p.id] !== undefined)),
    );
  }, [items, q, filter, counts]);

  useEffect(() => {
    if (!selected && items.length) setSelected(items.find((p) => counts[p.id] === undefined)?.id ?? items[0].id);
  }, [items, selected, counts]);

  // Autosave shortly after each change.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      saveCountDraft(count.id, counts).then(() => setSavedAt(Date.now())).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [counts, count.id]);

  const sel = items.find((p) => p.id === selected) ?? null;
  const value = sel ? counts[sel.id] : undefined;

  const setValue = (v: number | undefined) => {
    if (!sel) return;
    setCounts((c) => {
      const next = { ...c };
      if (v === undefined) delete next[sel.id];
      else next[sel.id] = Math.max(0, Math.min(99999, v));
      return next;
    });
  };

  const select = (id: string) => {
    setSelected(id);
    setFresh(true);
  };

  const next = () => {
    if (!sel) return;
    const order = visible.length ? visible : items;
    const i = order.findIndex((p) => p.id === sel.id);
    const after = [...order.slice(i + 1), ...order.slice(0, i)];
    const target = after.find((p) => counts[p.id] === undefined) ?? after[0];
    if (target) {
      select(target.id);
      requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${target.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  };

  const doSubmit = () =>
    run(async () => {
      const r = await act(() => submitCount(count.id, counts, staff?.name ?? count.staffName), 'ส่งผลตรวจนับให้ผู้จัดการแล้ว');
      if (r) setConfirm(null);
    });

  if (!products) return <div className="page" />;

  return (
    <>
      <section className="page">
        <header className="page-head">
          <div className="stack">
            <h1>ตรวจนับสต็อก</h1>
            <span className="sub">
              {count.staffName} · บันทึกร่างอัตโนมัติ {ago(savedAt)}
            </span>
          </div>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={() => setConfirm('discard')}>
            ยกเลิกรอบนี้
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => run(() => act(async () => (await saveCountDraft(count.id, counts), setSavedAt(Date.now())), 'บันทึกร่างแล้ว'))}
          >
            บันทึกร่าง
          </button>
          <button className="btn btn-primary" disabled={doneCount === 0 || busy} onClick={() => (doneCount < items.length ? setConfirm('submit') : doSubmit())}>
            ส่งผลตรวจนับ
          </button>
        </header>
        <div style={{ padding: '0 24px 16px' }} className="stack">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="t-sm t-strong num">
              นับแล้ว {doneCount} จาก {items.length} รายการ
            </span>
            <span className="t-sm muted num">{items.length ? Math.round((doneCount / items.length) * 100) : 0}%</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={doneCount} aria-label="ความคืบหน้าการนับ">
            <span style={{ width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }} />
          </div>
          <div className="row" style={{ marginTop: 16, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <SearchField value={q} onChange={setQ} placeholder="ค้นหาสินค้า" label="ค้นหาสินค้าที่จะนับ" />
            </div>
            <Seg<Filter>
              value={filter}
              onChange={setFilter}
              label="กรองรายการ"
              options={[
                { value: 'all', label: 'ทั้งหมด' },
                { value: 'todo', label: 'ยังไม่นับ' },
                { value: 'done', label: 'นับแล้ว' },
              ]}
            />
          </div>
        </div>
        <div className="count-list" ref={listRef} role="listbox" aria-label="สินค้าที่ต้องนับ">
          {items.length === 0 ? (
            <Empty icon={<PackageOpen size={28} />} title="ไม่มีสินค้าที่ต้องนับ" />
          ) : visible.length === 0 ? (
            <Empty icon={<ClipboardCheck size={28} />} title={filter === 'todo' ? 'นับครบทุกรายการแล้ว' : 'ไม่พบสินค้า'}>
              {filter === 'todo' ? 'กด ส่งผลตรวจนับ เพื่อส่งให้ผู้จัดการ' : undefined}
            </Empty>
          ) : (
            visible.map((p) => <CountRow key={p.id} p={p} cat={p.categoryId ? catName.get(p.categoryId) : undefined} value={counts[p.id]} selected={p.id === selected} onSelect={() => select(p.id)} />)
          )}
        </div>
      </section>

      <aside className="count-pad" aria-label="ใส่จำนวนที่นับได้">
        {sel ? (
          <>
            <div className="row" style={{ gap: 16 }}>
              <Thumb imageId={sel.imageId} name={sel.name} size={72} />
              <div className="stack" style={{ minWidth: 0 }}>
                <span className="t-sm muted">{sel.categoryId ? catName.get(sel.categoryId) : 'ไม่มีหมวด'}</span>
                <span style={{ fontSize: 20, fontWeight: 700, lineHeight: '26px' }} className="clamp-2">
                  {sel.name}
                </span>
              </div>
            </div>
            <span className="label">จำนวนที่นับได้</span>
            <div className="count-display">
              <button className="icon-btn" aria-label="ลดหนึ่ง" onClick={() => (setValue((value ?? 0) - 1), setFresh(false))} disabled={!value}>
                <Minus size={24} />
              </button>
              <output className="num" aria-live="polite" data-testid="count-output" style={{ color: value === undefined ? 'var(--text-3)' : undefined }}>
                {value ?? '–'}
              </output>
              <button className="icon-btn" aria-label="เพิ่มหนึ่ง" onClick={() => (setValue((value ?? 0) + 1), setFresh(false))}>
                <Plus size={24} />
              </button>
            </div>
            <Keypad
              onDigit={(d) => {
                const base = fresh || value === undefined ? '' : String(value);
                setValue(Number((base + d).slice(0, 5)));
                setFresh(false);
              }}
              onBack={() => {
                const s = value === undefined ? '' : String(value).slice(0, -1);
                setValue(s === '' ? undefined : Number(s));
                setFresh(false);
              }}
              left={
                <button className="key fn" onClick={() => (setValue(0), setFresh(false))} aria-label="ไม่มีของ ใส่ศูนย์">
                  ไม่มีของ
                </button>
              }
            />
            <button className="btn btn-primary btn-lg btn-block" onClick={next} style={{ marginTop: 'auto' }}>
              รายการถัดไป <ArrowRight size={20} />
            </button>
          </>
        ) : (
          <Empty icon={<ClipboardList size={28} />} title="เลือกสินค้าทางซ้าย" />
        )}
      </aside>

      <Sheet
        open={confirm === 'submit'}
        onClose={() => setConfirm(null)}
        title="ยังนับไม่ครบ"
        footer={
          <>
            <button className="btn btn-secondary btn-lg" onClick={() => (setConfirm(null), setFilter('todo'))}>
              นับต่อ
            </button>
            <button className="btn btn-primary btn-lg" onClick={doSubmit} disabled={busy}>
              ส่งเฉพาะที่นับแล้ว
            </button>
          </>
        }
      >
        <p>
          ยังไม่ได้นับ <b className="num">{items.length - doneCount}</b> รายการ ถ้าส่งตอนนี้ ผู้จัดการจะเห็นเฉพาะ {doneCount} รายการที่นับแล้ว
        </p>
      </Sheet>
      <Sheet
        open={confirm === 'discard'}
        onClose={() => setConfirm(null)}
        title="ยกเลิกรอบตรวจนับนี้"
        footer={
          <>
            <button className="btn btn-secondary btn-lg" onClick={() => setConfirm(null)}>
              นับต่อ
            </button>
            <button className="btn btn-danger btn-lg" onClick={() => run(() => act(() => discardCount(count.id), 'ยกเลิกรอบตรวจนับแล้ว'))}>
              ยกเลิกรอบนี้
            </button>
          </>
        }
      >
        <p>จำนวนที่นับไว้ {doneCount} รายการจะหายไป และไม่ส่งให้ผู้จัดการ</p>
      </Sheet>
    </>
  );
}

function CountRow({ p, cat, value, selected, onSelect }: { p: Product; cat?: string; value: number | undefined; selected: boolean; onSelect: () => void }) {
  return (
    <button className="count-row" role="option" aria-selected={selected} onClick={onSelect} data-id={p.id}>
      <Thumb imageId={p.imageId} name={p.name} />
      <span className="stack" style={{ minWidth: 0 }}>
        <span className="name clamp-2">{p.name}</span>
        <span className="t-sm muted">{cat ?? 'ไม่มีหมวด'}</span>
      </span>
      <span className={`count-value num ${value !== undefined ? 'done' : ''}`} aria-label={value === undefined ? 'ยังไม่นับ' : `นับได้ ${value}`}>
        {value ?? '–'}
      </span>
    </button>
  );
}
