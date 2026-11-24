import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CheckCircle2, Clock, Images } from 'lucide-react';
import { db, type Sale, type SlipStatus } from '../../lib/db';
import { baht, fmtDateTime, fmtTime, fmtDateShort, saleNo } from '../../lib/format';
import { presetRange, type RangePreset } from '../../lib/reports';
import { setSlipStatus } from '../../lib/sales';
import { useImageUrl } from '../../lib/images';
import { useAction } from '../../state/app';
import { Empty, Seg, useBusy } from '../../components/ui';
import { ImageViewer } from '../../components/ImageViewer';
import { PageHead } from './BackOffice';

const LABEL: Record<SlipStatus, string> = { pending: 'รอตรวจ', verified: 'ตรวจแล้ว', flagged: 'มีปัญหา' };

export function SlipBadge({ sale }: { sale: Pick<Sale, 'slipStatus' | 'payment'> }) {
  if (sale.payment !== 'transfer' || !sale.slipStatus) return null;
  const s = sale.slipStatus;
  return (
    <span className={`badge ${s === 'verified' ? 'success' : s === 'flagged' ? 'danger' : 'accent'}`}>
      {s === 'verified' ? <CheckCircle2 size={12} /> : s === 'flagged' ? <AlertTriangle size={12} /> : <Clock size={12} />}
      สลิป{LABEL[s]}
    </span>
  );
}

export function SlipActions({ sale, onDone }: { sale: Sale; onDone?: () => void }) {
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState(sale.slipNote ?? '');
  const act = useAction();
  const [busy, run] = useBusy();
  if (flagging)
    return (
      <div className="stack" style={{ gap: 10 }}>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ปัญหาคืออะไร เช่น ยอดไม่ตรง, ไม่พบเงินเข้า" aria-label="ปัญหาของสลิป" autoFocus maxLength={150} />
        <div className="row">
          <button className="btn btn-ghost" onClick={() => setFlagging(false)}>
            ยกเลิก
          </button>
          <span className="spacer" />
          <button
            className="btn btn-danger"
            disabled={!note.trim() || busy}
            onClick={() =>
              run(async () => {
                await act(() => setSlipStatus(sale.id, 'flagged', note), 'ทำเครื่องหมายว่ามีปัญหาแล้ว');
                setFlagging(false);
                onDone?.();
              })
            }
          >
            บันทึกว่ามีปัญหา
          </button>
        </div>
      </div>
    );
  return (
    <div className="stack" style={{ gap: 8 }}>
      {sale.slipStatus === 'flagged' && sale.slipNote && <div className="notice danger">{sale.slipNote}</div>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {sale.slipStatus !== 'verified' && (
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await act(() => setSlipStatus(sale.id, 'verified'), 'ยืนยันสลิปแล้ว');
                onDone?.();
              })
            }
          >
            <CheckCircle2 size={18} /> เงินเข้าแล้ว ถูกต้อง
          </button>
        )}
        {sale.slipStatus !== 'flagged' && (
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setFlagging(true)}>
            <AlertTriangle size={18} /> มีปัญหา
          </button>
        )}
      </div>
      {sale.slipStatus !== 'pending' && (
        <button className="btn btn-ghost btn-sm" onClick={() => act(() => setSlipStatus(sale.id, 'pending'))}>
          เปลี่ยนกลับเป็นรอตรวจ
        </button>
      )}
    </div>
  );
}

type Filter = 'pending' | 'verified' | 'flagged' | 'all';

export function SlipsPage() {
  const [status, setStatus] = useState<Filter>('pending');
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [open, setOpen] = useState<number | null>(null);
  const range = useMemo(() => presetRange(preset), [preset]);
  const sales = useLiveQuery(
    () =>
      db.sales
        .where('day')
        .between(range.from, range.to, true, true)
        .filter((s) => s.payment === 'transfer' && !!s.slipImageId && s.status === 'completed')
        .reverse()
        .sortBy('createdAt'),
    [range.from, range.to],
  );
  const list = useMemo(() => (sales ?? []).filter((s) => status === 'all' || s.slipStatus === status), [sales, status]);
  const counts = useMemo(() => {
    const c = { pending: 0, verified: 0, flagged: 0 };
    for (const s of sales ?? []) if (s.slipStatus) c[s.slipStatus] += 1;
    return c;
  }, [sales]);
  const idx = open !== null ? Math.min(open, list.length - 1) : -1;
  const current = idx >= 0 ? list[idx] : null;

  return (
    <div className="page">
      <PageHead title="สลิปโอนเงิน" sub={`${list.length} ใบ · ${baht(list.reduce((a, s) => a + s.total, 0))}`}>
        <Seg<RangePreset>
          value={preset}
          onChange={setPreset}
          label="ช่วงเวลา"
          options={[
            { value: 'today', label: 'วันนี้' },
            { value: '7d', label: '7 วัน' },
            { value: '30d', label: '30 วัน' },
          ]}
        />
      </PageHead>
      <div className="page-body">
        <div className="toolbar">
          <Seg<Filter>
            value={status}
            onChange={(v) => (setStatus(v), setOpen(null))}
            label="สถานะสลิป"
            options={[
              { value: 'pending', label: `รอตรวจ (${counts.pending})` },
              { value: 'flagged', label: `มีปัญหา (${counts.flagged})` },
              { value: 'verified', label: `ตรวจแล้ว (${counts.verified})` },
              { value: 'all', label: 'ทั้งหมด' },
            ]}
          />
        </div>
        {list.length === 0 ? (
          <div className="card" style={{ display: 'flex', minHeight: 320 }}>
            <Empty icon={status === 'pending' ? <CheckCircle2 size={28} /> : <Images size={28} />} title={status === 'pending' ? 'ไม่มีสลิปรอตรวจ' : 'ไม่มีสลิปในกลุ่มนี้'}>
              {status === 'pending' ? 'สลิปในช่วงนี้ตรวจครบแล้ว' : 'ลองเลือกช่วงเวลาอื่น'}
            </Empty>
          </div>
        ) : (
          <div className="slip-grid">
            {list.map((s, i) => (
              <SlipCard key={s.id} sale={s} onOpen={() => setOpen(i)} />
            ))}
          </div>
        )}
      </div>
      {current && (
        <ImageViewer
          imageId={current.slipImageId}
          onClose={() => setOpen(null)}
          title={`${idx + 1} / ${list.length}`}
          onPrev={idx > 0 ? () => setOpen(idx - 1) : undefined}
          onNext={idx < list.length - 1 ? () => setOpen(idx + 1) : undefined}
        >
          <div className="stack" style={{ gap: 4 }}>
            <span className="t-sm muted">ยอดที่ต้องได้รับ</span>
            <span className="num" style={{ fontSize: 40, fontWeight: 700, lineHeight: '48px' }}>
              {baht(current.total)}
            </span>
          </div>
          <dl className="kv">
            <dt>เลขที่</dt>
            <dd className="num">{saleNo(current.number)}</dd>
            <dt>เวลา</dt>
            <dd>{fmtDateTime(current.createdAt)}</dd>
            <dt>พนักงาน</dt>
            <dd>{current.staffName}</dd>
            <dt>สถานะ</dt>
            <dd>
              <SlipBadge sale={current} />
            </dd>
          </dl>
          <p className="t-sm muted">เทียบยอดและเวลาในสลิปกับบัญชีธนาคาร ถ้าเงินเข้าแล้วให้กดยืนยัน</p>
          {/* After a decision, the next slip in this filter slides into place. */}
          <SlipActions key={current.id + current.slipStatus} sale={current} />
        </ImageViewer>
      )}
    </div>
  );
}

function SlipCard({ sale, onOpen }: { sale: Sale; onOpen: () => void }) {
  const url = useImageUrl(sale.slipImageId);
  return (
    <button className="slip-card" onClick={onOpen} aria-label={`สลิป ${baht(sale.total)} เลขที่ ${saleNo(sale.number)}`}>
      <div className="img">
        {url && <img src={url} alt="" loading="lazy" />}
        <SlipBadge sale={sale} />
      </div>
      <div className="body">
        <span className="amt num">{baht(sale.total)}</span>
        <span className="t-sm muted num">
          #{saleNo(sale.number)} · {fmtDateShort(sale.createdAt)} {fmtTime(sale.createdAt)}
        </span>
        <span className="t-sm muted">{sale.staffName}</span>
      </div>
    </button>
  );
}
