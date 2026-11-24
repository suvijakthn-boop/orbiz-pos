import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, CheckCircle2, Flag, ReceiptText, X, ZoomIn } from 'lucide-react';
import { db, type MistakeReport, type PaymentMethod, type Sale } from '../../lib/db';
import { baht, fmtDate, fmtDateTime, fmtTime, pct, saleNo } from '../../lib/format';
import { presetRange, summarize, type RangePreset } from '../../lib/reports';
import { changePayment, resolveReport, voidSale } from '../../lib/sales';
import { useImageUrl } from '../../lib/images';
import { useAction } from '../../state/app';
import { Empty, Seg, useBusy } from '../../components/ui';
import { ImageViewer } from '../../components/ImageViewer';
import { PageHead } from './BackOffice';
import { PinConfirm } from './Lock';
import { PayTag, itemSummary } from '../staff/HistoryScreen';
import { SlipActions, SlipBadge } from './Slips';

type Show = 'all' | 'reported' | 'voided';

export function TransactionsPage({ initial }: { initial?: string }) {
  const [preset, setPreset] = useState<RangePreset>(initial === 'reported' ? '30d' : 'today');
  const [pay, setPay] = useState<'all' | PaymentMethod>('all');
  const [show, setShow] = useState<Show>(initial === 'reported' ? 'reported' : 'all');
  const [selected, setSelected] = useState<string | null>(null);
  const range = useMemo(() => presetRange(preset), [preset]);
  const sales = useLiveQuery(() => db.sales.where('day').between(range.from, range.to, true, true).reverse().sortBy('createdAt'), [range.from, range.to]);
  const reports = useLiveQuery(() => db.reports.toArray(), []);
  const openBySale = useMemo(() => new Set((reports ?? []).filter((r) => r.status === 'open').map((r) => r.saleId)), [reports]);

  const list = useMemo(
    () =>
      (sales ?? []).filter(
        (s) => (pay === 'all' || s.payment === pay) && (show === 'all' || (show === 'reported' ? openBySale.has(s.id) : s.status === 'voided')),
      ),
    [sales, pay, show, openBySale],
  );
  const sum = summarize(list);
  const sel = (sales ?? []).find((s) => s.id === selected) ?? null;

  return (
    <div className="split">
      <div className="page">
        <PageHead title="รายการขาย" sub={`${list.filter((s) => s.status === 'completed').length} บิล · ${baht(sum.revenue)} · กำไร ${baht(sum.profit)}`} />
        <div className="page-body">
          <div className="toolbar">
            <Seg<RangePreset>
              value={preset}
              onChange={setPreset}
              label="ช่วงเวลา"
              options={[
                { value: 'today', label: 'วันนี้' },
                { value: 'yesterday', label: 'เมื่อวาน' },
                { value: '7d', label: '7 วัน' },
                { value: '30d', label: '30 วัน' },
              ]}
            />
            <Seg<'all' | PaymentMethod>
              value={pay}
              onChange={setPay}
              label="วิธีชำระ"
              options={[
                { value: 'all', label: 'ทุกวิธี' },
                { value: 'cash', label: 'เงินสด' },
                { value: 'transfer', label: 'โอน' },
              ]}
            />
            <Seg<Show>
              value={show}
              onChange={setShow}
              label="สถานะ"
              options={[
                { value: 'all', label: 'ทั้งหมด' },
                { value: 'reported', label: `แจ้งผิด${openBySale.size ? ` (${openBySale.size})` : ''}` },
                { value: 'voided', label: 'ยกเลิก' },
              ]}
            />
          </div>
          <div className="card table-card">
            {list.length === 0 ? (
              <Empty icon={<ReceiptText size={28} />} title="ไม่มีรายการในช่วงนี้">
                {show === 'reported' ? 'ไม่มีรายการที่พนักงานแจ้งผิดค้างอยู่' : 'ลองเลือกช่วงเวลาอื่น'}
              </Empty>
            ) : (
              list.map((s) => (
                <button key={s.id} className="sale-row" aria-selected={s.id === selected} onClick={() => setSelected(s.id)}>
                  <span className="stack">
                    <span className="time num">{fmtTime(s.createdAt)}</span>
                    {preset !== 'today' && <span className="t-xs muted">{fmtDate(s.day).replace(/ \d{4}$/, '')}</span>}
                  </span>
                  <span className="stack" style={{ minWidth: 0 }}>
                    <span className="ellipsis t-strong" style={{ fontSize: 15 }}>
                      {itemSummary(s)}
                    </span>
                    <span className="row t-sm muted" style={{ gap: 10 }}>
                      <span className="num">#{saleNo(s.number)}</span>
                      <span>{s.staffName}</span>
                      <PayTag sale={s} />
                    </span>
                  </span>
                  <span className="hide-sm num muted t-sm" style={{ textAlign: 'right' }}>
                    {s.status === 'completed' ? `กำไร ${baht(s.total - s.costTotal)}` : ''}
                  </span>
                  <span className="amount-col">
                    <span className={`amount num ${s.status === 'voided' ? 'void' : ''}`}>{baht(s.total)}</span>
                    {s.status === 'voided' ? (
                      <span className="badge danger">ยกเลิกแล้ว</span>
                    ) : openBySale.has(s.id) ? (
                      <span className="badge warning">แจ้งผิด</span>
                    ) : (
                      <SlipBadge sale={s} />
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
      {sel && <TransactionDetail sale={sel} reports={(reports ?? []).filter((r) => r.saleId === sel.id)} onClose={() => setSelected(null)} />}
    </div>
  );
}

function TransactionDetail({ sale, reports, onClose }: { sale: Sale; reports: MistakeReport[]; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const slipUrl = useImageUrl(sale.slipImageId);
  const act = useAction();
  const profit = sale.total - sale.costTotal;
  return (
    <aside className="detail-pane" aria-label={`รายละเอียดเลขที่ ${saleNo(sale.number)}`}>
      <div className="pane-head">
        <div className="stack" style={{ flex: 1 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }} className="num">
            เลขที่ {saleNo(sale.number)}
          </h2>
          <span className="t-sm muted">
            {fmtDateTime(sale.createdAt)} · {sale.staffName}
          </span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="ปิด">
          <X size={22} />
        </button>
      </div>
      <div className="pane-body">
        {sale.status === 'voided' && (
          <div className="notice danger">
            <Ban size={18} />
            <div>
              ยกเลิกแล้ว {sale.voidedAt ? fmtDateTime(sale.voidedAt) : ''} · {sale.voidReason}
              <div className="t-sm">คืนสต็อกแล้ว</div>
            </div>
          </div>
        )}
        {reports.map((r) => (
          <ReportCard key={r.id} r={r} />
        ))}
        <div className="receipt-items">
          {sale.items.map((i) => (
            <div className="receipt-item" key={i.productId}>
              <span className="stack">
                <span>
                  {i.name} <span className="muted num">×{i.qty}</span>
                </span>
                <span className="t-xs muted num">
                  {baht(i.price)} · ทุน {baht(i.cost)}
                </span>
              </span>
              <span className="num t-strong">{baht(i.price * i.qty)}</span>
            </div>
          ))}
        </div>
        <dl className="kv">
          <dt>ยอดรวม</dt>
          <dd className="num" style={{ fontSize: 22, fontWeight: 700 }}>
            {baht(sale.total)}
          </dd>
          <dt>ต้นทุน</dt>
          <dd className="num">{baht(sale.costTotal)}</dd>
          <dt>กำไรขั้นต้น</dt>
          <dd className="num">
            {baht(profit)} <span className="muted">({pct(sale.total ? profit / sale.total : NaN)})</span>
          </dd>
        </dl>
        <div className="field">
          <span className="label">วิธีชำระ</span>
          {sale.status === 'completed' ? (
            <Seg<PaymentMethod>
              value={sale.payment}
              onChange={(p) => act(() => changePayment(sale.id, p), 'แก้วิธีชำระแล้ว')}
              label="วิธีชำระ"
              options={[
                { value: 'cash', label: 'เงินสด' },
                { value: 'transfer', label: 'โอนเงิน' },
              ]}
            />
          ) : (
            <PayTag sale={sale} />
          )}
        </div>
        {sale.slipImageId && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row">
              <span className="label">สลิปการโอน</span>
              <span className="spacer" />
              <SlipBadge sale={sale} />
            </div>
            <button className="slip-large" onClick={() => setZoom(true)} aria-label="ดูสลิปเต็มจอ">
              {slipUrl && <img src={slipUrl} alt="รูปสลิป" />}
              <span className="zoom-hint">
                <ZoomIn size={14} /> แตะเพื่อขยาย
              </span>
            </button>
            {sale.payment === 'transfer' && sale.status === 'completed' && <SlipActions sale={sale} />}
          </div>
        )}
        {sale.status === 'completed' && (
          <button className="btn btn-danger-ghost btn-block" onClick={() => setVoiding(true)}>
            <Ban size={18} /> ยกเลิกรายการขายนี้
          </button>
        )}
      </div>
      {zoom && <ImageViewer imageId={sale.slipImageId} onClose={() => setZoom(false)} title={`เลขที่ ${saleNo(sale.number)} · ${baht(sale.total)}`} />}
      <PinConfirm
        open={voiding}
        onClose={() => setVoiding(false)}
        danger
        title="ยกเลิกรายการขาย"
        description={
          <>
            เลขที่ {saleNo(sale.number)} · <b className="num">{baht(sale.total)}</b> จะไม่นับเป็นยอดขาย และคืนสต็อกทุกรายการ รายการเดิมยังเก็บไว้ในประวัติ
          </>
        }
        reasonLabel="เหตุผลที่ยกเลิก"
        reasonPlaceholder="เช่น ลูกค้าคืนสินค้า, พนักงานบันทึกซ้ำ"
        confirmLabel="ยกเลิกแล้วแก้กลับไม่ได้"
        onConfirm={(reason) => voidSale(sale.id, reason)}
      />
    </aside>
  );
}

function ReportCard({ r }: { r: MistakeReport }) {
  const [text, setText] = useState('');
  const act = useAction();
  const [busy, run] = useBusy();
  if (r.status === 'resolved')
    return (
      <div className="notice success">
        <CheckCircle2 size={18} />
        <div>
          <div className="t-strong">ปิดเรื่องแล้ว · {r.reason}</div>
          {r.resolution && <div>{r.resolution}</div>}
        </div>
      </div>
    );
  return (
    <div className="notice warning" style={{ flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Flag size={18} />
        <div>
          <div className="t-strong">
            {r.staffName} แจ้งว่าผิด: {r.reason}
          </div>
          {r.note && <div>{r.note}</div>}
          <div className="t-xs">{fmtDateTime(r.createdAt)}</div>
        </div>
      </div>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="แก้อย่างไร เช่น ยกเลิกบิลแล้วให้ขายใหม่" aria-label="วิธีที่แก้" maxLength={150} />
      <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} disabled={busy} onClick={() => run(() => act(() => resolveReport(r.id, text), 'ปิดเรื่องแล้ว'))}>
        ปิดเรื่องนี้
      </button>
    </div>
  );
}
