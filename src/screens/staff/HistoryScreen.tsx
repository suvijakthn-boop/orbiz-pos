import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, Flag, QrCode, Receipt, X, ZoomIn, CheckCircle2 } from 'lucide-react';
import { db, type Sale, type MistakeReport } from '../../lib/db';
import { baht, dayKey, fmtDate, fmtTime, saleNo, fmtDateTime } from '../../lib/format';
import { MISTAKE_REASONS, reportMistake } from '../../lib/sales';
import { useAction, useCurrentStaff } from '../../state/app';
import { DateNav, Empty, useBusy } from '../../components/ui';
import { ImageViewer } from '../../components/ImageViewer';
import { useImageUrl } from '../../lib/images';

export function PayTag({ sale }: { sale: Pick<Sale, 'payment'> }) {
  return (
    <span className="pay-tag">
      {sale.payment === 'cash' ? <Banknote size={16} /> : <QrCode size={16} />}
      {sale.payment === 'cash' ? 'เงินสด' : 'โอนเงิน'}
    </span>
  );
}

export function itemSummary(s: Sale): string {
  const first = s.items[0];
  if (!first) return '';
  const rest = s.items.length - 1;
  return `${first.name}${first.qty > 1 ? ` ×${first.qty}` : ''}${rest > 0 ? ` และอีก ${rest} รายการ` : ''}`;
}

export function HistoryScreen() {
  const [day, setDay] = useState(dayKey());
  const [selected, setSelected] = useState<string | null>(null);
  const sales = useLiveQuery(() => db.sales.where('day').equals(day).reverse().sortBy('createdAt'), [day]);
  const reports = useLiveQuery(() => db.reports.toArray(), []);
  const reportsBySale = useMemo(() => {
    const m = new Map<string, MistakeReport[]>();
    for (const r of reports ?? []) m.set(r.saleId, [...(m.get(r.saleId) ?? []), r]);
    return m;
  }, [reports]);

  // Keep "today" correct if the iPad is left open past midnight.
  useEffect(() => {
    const t = setInterval(() => {
      const today = dayKey();
      setDay((d) => (d > today ? today : d));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const done = (sales ?? []).filter((s) => s.status === 'completed');
  const total = done.reduce((a, s) => a + s.total, 0);
  const sel = sales?.find((s) => s.id === selected) ?? null;

  return (
    <>
      <section className="history-list">
        <header className="page-head">
          <div className="stack">
            <h1>ประวัติการขาย</h1>
            <span className="sub">{fmtDate(day)}</span>
          </div>
          <span className="spacer" />
          <DateNav value={day} onChange={(d) => (setDay(d), setSelected(null))} />
        </header>
        <div className="summary-strip">
          <div className="item">
            <span className="v num">{done.length}</span>
            <span className="k">รายการ</span>
          </div>
          <div className="item">
            <span className="v num">{baht(total)}</span>
            <span className="k">ยอดขาย</span>
          </div>
          <div className="item">
            <span className="v num">{baht(done.filter((s) => s.payment === 'cash').reduce((a, s) => a + s.total, 0))}</span>
            <span className="k">เงินสด</span>
          </div>
          <div className="item">
            <span className="v num">{baht(done.filter((s) => s.payment === 'transfer').reduce((a, s) => a + s.total, 0))}</span>
            <span className="k">โอนเงิน</span>
          </div>
        </div>
        <div className="scroll" style={{ flex: 1, padding: '0 24px 24px' }}>
          {sales && sales.length === 0 ? (
            <div className="card" style={{ display: 'flex', minHeight: 320 }}>
              <Empty icon={<Receipt size={28} />} title={day === dayKey() ? 'วันนี้ยังไม่มีการขาย' : 'วันนี้ไม่มีการขาย'}>
                รายการที่บันทึกจากหน้าขายสินค้าจะแสดงที่นี่
              </Empty>
            </div>
          ) : (
            <div className="card table-card" role="list">
              {(sales ?? []).map((s) => {
                const open = (reportsBySale.get(s.id) ?? []).some((r) => r.status === 'open');
                return (
                  <button key={s.id} role="listitem" className="sale-row" aria-selected={s.id === selected} onClick={() => setSelected(s.id)}>
                    <span className="time num">{fmtTime(s.createdAt)}</span>
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
                    <span className="hide-sm" />
                    <span className="amount-col">
                      <span className={`amount num ${s.status === 'voided' ? 'void' : ''}`}>{baht(s.total)}</span>
                      {s.status === 'voided' ? <span className="badge danger">ยกเลิกแล้ว</span> : open ? <span className="badge warning">แจ้งผิดแล้ว</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
      {sel && <SaleDetail sale={sel} reports={reportsBySale.get(sel.id) ?? []} onClose={() => setSelected(null)} />}
    </>
  );
}

function SaleDetail({ sale, reports, onClose }: { sale: Sale; reports: MistakeReport[]; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [reporting, setReporting] = useState(false);
  const slipUrl = useImageUrl(sale.slipImageId);
  return (
    <aside className="detail-pane" aria-label={`รายละเอียดเลขที่ ${saleNo(sale.number)}`}>
      <div className="pane-head">
        <div className="stack" style={{ flex: 1 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }} className="num">
            เลขที่ {saleNo(sale.number)}
          </h2>
          <span className="t-sm muted">{fmtDateTime(sale.createdAt)}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="ปิดรายละเอียด">
          <X size={22} />
        </button>
      </div>
      <div className="pane-body">
        {sale.status === 'voided' && (
          <div className="notice danger">
            ผู้จัดการยกเลิกรายการนี้แล้ว{sale.voidReason ? ` · ${sale.voidReason}` : ''}
          </div>
        )}
        <div className="receipt-items">
          {sale.items.map((i) => (
            <div className="receipt-item" key={i.productId}>
              <span>
                {i.name} <span className="muted num">×{i.qty}</span>
              </span>
              <span className="num t-strong">{baht(i.price * i.qty)}</span>
            </div>
          ))}
        </div>
        <div className="total-row">
          <span className="label">ยอดรวม</span>
          <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>
            {baht(sale.total)}
          </span>
        </div>
        <dl className="kv">
          <dt>วิธีชำระ</dt>
          <dd>
            <PayTag sale={sale} />
          </dd>
          <dt>พนักงาน</dt>
          <dd>{sale.staffName}</dd>
        </dl>
        {sale.slipImageId && (
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">สลิปการโอน</span>
            <button className="slip-large" onClick={() => setZoom(true)} aria-label="ดูสลิปเต็มจอ">
              {slipUrl && <img src={slipUrl} alt="รูปสลิป" />}
              <span className="zoom-hint">
                <ZoomIn size={14} /> แตะเพื่อขยาย
              </span>
            </button>
          </div>
        )}
        {reports.map((r) => (
          <div key={r.id} className={`notice ${r.status === 'open' ? 'warning' : 'success'}`}>
            {r.status === 'open' ? <Flag size={18} /> : <CheckCircle2 size={18} />}
            <div>
              <div className="t-strong">{r.status === 'open' ? 'แจ้งผิดแล้ว รอผู้จัดการตรวจ' : 'ผู้จัดการแก้แล้ว'}</div>
              <div>
                {r.reason}
                {r.note ? ` · ${r.note}` : ''}
              </div>
              {r.resolution && <div>ผู้จัดการ: {r.resolution}</div>}
            </div>
          </div>
        ))}
        {sale.status === 'completed' &&
          (reporting ? (
            <ReportForm saleId={sale.id} onDone={() => setReporting(false)} />
          ) : (
            <button className="btn btn-secondary btn-block" onClick={() => setReporting(true)}>
              <Flag size={18} /> แจ้งว่ารายการนี้ผิด
            </button>
          ))}
        <p className="t-xs muted">พนักงานแก้รายการขายเองไม่ได้ แจ้งผิดแล้วผู้จัดการจะเป็นคนแก้</p>
      </div>
      {zoom && <ImageViewer imageId={sale.slipImageId} onClose={() => setZoom(false)} title={`สลิป เลขที่ ${saleNo(sale.number)} · ${baht(sale.total)}`} />}
    </aside>
  );
}

function ReportForm({ saleId, onDone }: { saleId: string; onDone: () => void }) {
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const { staff } = useCurrentStaff();
  const act = useAction();
  const [busy, run] = useBusy();
  return (
    <div className="card card-pad stack" style={{ gap: 16 }}>
      <span className="label">ผิดตรงไหน</span>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {MISTAKE_REASONS.map((r) => (
          <button key={r} className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <div className="field">
        <label className="label" htmlFor="mistake-note">
          รายละเอียด {reason === 'อื่น ๆ' ? '' : <span className="muted">(ไม่บังคับ)</span>}
        </label>
        <textarea id="mistake-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ลูกค้าซื้อ 1 ชิ้น แต่กดไป 2" maxLength={200} />
      </div>
      <div className="row">
        <button className="btn btn-ghost" onClick={onDone}>
          ยกเลิก
        </button>
        <span className="spacer" />
        <button
          className="btn btn-primary"
          disabled={!reason || busy}
          onClick={() =>
            run(async () => {
              const r = await act(() => reportMistake(saleId, reason, note, staff?.name ?? 'พนักงาน'), 'ส่งเรื่องให้ผู้จัดการแล้ว');
              if (r) onDone();
            })
          }
        >
          ส่งให้ผู้จัดการ
        </button>
      </div>
    </div>
  );
}
