import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, PackagePlus, ReceiptText, SlidersHorizontal, X } from 'lucide-react';
import { db, type Product, type StockReason } from '../../lib/db';
import { baht, fmtDateTime, num, parseBaht, bahtInput } from '../../lib/format';
import { adjustStock, isLowStock, receiveStock } from '../../lib/inventory';
import { inventoryValue } from '../../lib/reports';
import { useAction } from '../../state/app';
import { Empty, SearchField, Seg, Thumb, useBusy } from '../../components/ui';
import { PageHead } from './BackOffice';
import { PinConfirm } from './Lock';
import { ReceiveBillSheet } from './ReceiveBill';

type Filter = 'all' | 'low' | 'out';

export const REASON_LABEL: Record<StockReason, string> = {
  sale: 'ขาย',
  void: 'ยกเลิกการขาย',
  receive: 'รับเข้า',
  adjust: 'ปรับยอด',
  count: 'ตรวจนับ',
  initial: 'สต็อกเริ่มต้น',
};

export function InventoryPage({ initial }: { initial?: string }) {
  const products = useLiveQuery(() => db.products.orderBy('sort').toArray(), []);
  const [filter, setFilter] = useState<Filter>(initial === 'low' ? 'low' : 'all');
  const [q, setQ] = useState('');
  const [bill, setBill] = useState(false);
  const [selected, setSelected] = useState<string | null>(initial && initial !== 'low' ? initial : null);

  const tracked = useMemo(() => (products ?? []).filter((p) => p.trackStock && p.active), [products]);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return tracked.filter(
      (p) => (filter === 'all' || (filter === 'low' ? isLowStock(p) : p.stock <= 0)) && (!term || p.name.toLowerCase().includes(term)),
    );
  }, [tracked, filter, q]);
  const sel = (products ?? []).find((p) => p.id === selected) ?? null;

  return (
    <div className="split">
      <div className="page">
        <PageHead title="สต็อก" sub={`มูลค่าตามทุน ${baht(inventoryValue(products ?? []))} · ${num(tracked.reduce((a, p) => a + Math.max(0, p.stock), 0))} ชิ้น`}>
          <button className="btn btn-primary" onClick={() => setBill(true)}>
            <ReceiptText size={18} /> รับของจากบิล
          </button>
        </PageHead>
        <div className="page-body">
          <div className="toolbar">
            <SearchField value={q} onChange={setQ} placeholder="ค้นหาสินค้า" label="ค้นหาสินค้าในสต็อก" />
            <Seg<Filter>
              value={filter}
              onChange={setFilter}
              label="กรอง"
              options={[
                { value: 'all', label: 'ทั้งหมด' },
                { value: 'low', label: `ใกล้หมด (${tracked.filter(isLowStock).length})` },
                { value: 'out', label: 'หมด' },
              ]}
            />
          </div>
          <div className="card table-card">
            {list.length === 0 ? (
              <Empty icon={<Boxes size={28} />} title={tracked.length === 0 ? 'ยังไม่มีสินค้าที่นับสต็อก' : 'ไม่มีสินค้าในกลุ่มนี้'}>
                {tracked.length === 0 ? 'เปิด นับสต็อก ในหน้าแก้ไขสินค้า' : filter !== 'all' ? 'สต็อกทุกรายการยังพอขาย' : undefined}
              </Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>สินค้า</th>
                    <th className="r">คงเหลือ</th>
                    <th className="r hide-narrow">แจ้งเมื่อเหลือ</th>
                    <th className="r">มูลค่าทุน</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id} className="clickable" aria-selected={p.id === selected} onClick={() => setSelected(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(p.id)}>
                      <td>
                        <div className="row" style={{ gap: 12 }}>
                          <Thumb imageId={p.imageId} name={p.name} />
                          <span className="t-strong ellipsis">{p.name}</span>
                        </div>
                      </td>
                      <td className="r num">
                        {p.stock <= 0 ? <span className="badge danger">หมด</span> : isLowStock(p) ? <span className="badge warning">{p.stock}</span> : <b>{p.stock}</b>}
                      </td>
                      <td className="r num muted hide-narrow">{p.lowStock}</td>
                      <td className="r num">{baht(Math.max(0, p.stock) * p.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      {sel && <StockPanel p={sel} onClose={() => setSelected(null)} />}
      <ReceiveBillSheet open={bill} onClose={() => setBill(false)} />
    </div>
  );
}

function StockPanel({ p, onClose }: { p: Product; onClose: () => void }) {
  const moves = useLiveQuery(() => db.moves.where('productId').equals(p.id).reverse().sortBy('at'), [p.id]);
  const [mode, setMode] = useState<'receive' | 'adjust' | null>(null);
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const act = useAction();
  const [busy, run] = useBusy();

  useEffect(() => {
    setMode(null);
  }, [p.id]);
  useEffect(() => {
    setQty(mode === 'adjust' ? String(p.stock) : '');
    setCost(bahtInput(p.cost));
    setNote('');
  }, [mode, p.id, p.stock, p.cost]);

  const qtyNum = /^\d+$/.test(qty) ? Number(qty) : NaN;
  const costNum = parseBaht(cost);

  return (
    <aside className="detail-pane" aria-label={`สต็อก ${p.name}`}>
      <div className="pane-head">
        <Thumb imageId={p.imageId} name={p.name} size={48} />
        <div className="stack" style={{ flex: 1, minWidth: 0 }}>
          <h2 className="ellipsis" style={{ fontSize: 18, fontWeight: 700 }}>
            {p.name}
          </h2>
          <span className="t-sm muted num">ทุน {baht(p.cost)} / ชิ้น</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="ปิด">
          <X size={22} />
        </button>
      </div>
      <div className="pane-body">
        <div className="row" style={{ alignItems: 'baseline', gap: 12 }}>
          <span className="stat-big num">{p.stock}</span>
          <span className="muted">ชิ้นคงเหลือ</span>
          <span className="spacer" />
          {p.stock <= 0 ? <span className="badge danger">หมด</span> : isLowStock(p) ? <span className="badge warning">ใกล้หมด</span> : null}
        </div>
        {mode === null && (
          <div className="row">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setMode('receive')}>
              <PackagePlus size={18} /> รับสินค้าเข้า
            </button>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setMode('adjust')}>
              <SlidersHorizontal size={18} /> ปรับยอด
            </button>
          </div>
        )}
        {mode === 'receive' && (
          <div className="card card-pad stack" style={{ gap: 16 }}>
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="rcv-qty">
                  จำนวนที่รับเข้า
                </label>
                <input id="rcv-qty" className="input num" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} autoFocus placeholder="0" />
              </div>
              <div className="field">
                <label className="label" htmlFor="rcv-cost">
                  ต้นทุนต่อชิ้น
                </label>
                <div className="input-affix">
                  <span className="affix">฿</span>
                  <input id="rcv-cost" className="input num" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="rcv-note">
                หมายเหตุ <span className="muted">(ไม่บังคับ)</span>
              </label>
              <input id="rcv-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เลขที่ใบส่งของ" maxLength={100} />
            </div>
            {qtyNum > 0 && <p className="help num">หลังรับเข้า คงเหลือ {p.stock + qtyNum} ชิ้น</p>}
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setMode(null)}>
                ยกเลิก
              </button>
              <span className="spacer" />
              <button
                className="btn btn-primary"
                disabled={!(qtyNum > 0) || costNum === null || busy}
                onClick={() => run(async () => (await act(() => receiveStock(p.id, qtyNum, costNum, note), `รับเข้า ${qtyNum} ชิ้นแล้ว`)) !== undefined && setMode(null))}
              >
                บันทึกรับเข้า
              </button>
            </div>
          </div>
        )}
        {mode === 'adjust' && (
          <div className="card card-pad stack" style={{ gap: 16 }}>
            <div className="field">
              <label className="label" htmlFor="adj-qty">
                ยอดคงเหลือที่ถูกต้อง
              </label>
              <input id="adj-qty" className="input num" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} autoFocus />
              {Number.isFinite(qtyNum) && qtyNum !== p.stock && (
                <span className={`help num ${qtyNum > p.stock ? 'diff-pos' : 'diff-neg'}`}>
                  {qtyNum > p.stock ? '+' : ''}
                  {qtyNum - p.stock} ชิ้น · {baht((qtyNum - p.stock) * p.cost)}
                </span>
              )}
            </div>
            <div className="field">
              <label className="label" htmlFor="adj-note">
                เหตุผล
              </label>
              <input id="adj-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ของเสีย, ของหาย, นับผิด" maxLength={100} />
            </div>
            <p className="help">ใช้เมื่อยอดในระบบไม่ตรงของจริง ทุกการปรับต้องใส่ PIN และบันทึกไว้ในประวัติ</p>
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setMode(null)}>
                ยกเลิก
              </button>
              <span className="spacer" />
              <button className="btn btn-primary" disabled={!Number.isFinite(qtyNum) || qtyNum === p.stock || !note.trim()} onClick={() => setConfirm(true)}>
                ปรับยอด
              </button>
            </div>
          </div>
        )}
        <div className="stack">
          <span className="label" style={{ marginBottom: 4 }}>
            ความเคลื่อนไหว
          </span>
          {(moves ?? []).length === 0 && <p className="muted t-sm">ยังไม่มีความเคลื่อนไหว</p>}
          {(moves ?? []).slice(0, 60).map((m) => (
            <div className="move-row" key={m.id}>
              <span className="t-strong">{REASON_LABEL[m.reason]}</span>
              <span className={`delta num ${m.delta > 0 ? 'plus' : ''}`}>
                {m.delta > 0 ? '+' : ''}
                {m.delta}
              </span>
              <span className="muted">
                {fmtDateTime(m.at)}
                {m.note ? ` · ${m.note}` : ''}
              </span>
              <span className="muted num" style={{ textAlign: 'right' }}>
                เหลือ {m.balanceAfter}
              </span>
            </div>
          ))}
        </div>
      </div>
      <PinConfirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="ยืนยันการปรับยอด"
        description={
          <>
            {p.name}: <b className="num">{p.stock}</b> → <b className="num">{qtyNum}</b> ชิ้น · {note}
          </>
        }
        confirmLabel="ระบบจะบันทึกการปรับยอดนี้ในประวัติการแก้ไข"
        onConfirm={async () => {
          await adjustStock(p.id, qtyNum, note);
          setMode(null);
        }}
      />
    </aside>
  );
}
