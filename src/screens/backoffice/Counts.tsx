import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck, X } from 'lucide-react';
import { db, type StockCount } from '../../lib/db';
import { baht, fmtDateTime, num } from '../../lib/format';
import { approveCount, countVariance, rejectCount } from '../../lib/inventory';
import { useAction } from '../../state/app';
import { Empty, Seg, useBusy } from '../../components/ui';
import { PageHead } from './BackOffice';
import { PinConfirm } from './Lock';

const STATUS: Record<StockCount['status'], [string, string]> = {
  draft: ['กำลังนับ', ''],
  submitted: ['รออนุมัติ', 'accent'],
  approved: ['อนุมัติแล้ว', 'success'],
  rejected: ['ไม่อนุมัติ', 'warning'],
};

export function CountsPage() {
  const counts = useLiveQuery(() => db.counts.orderBy('startedAt').reverse().toArray(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const sel = (counts ?? []).find((c) => c.id === selected) ?? (counts ?? []).find((c) => c.status === 'submitted') ?? null;

  return (
    <div className="split">
      <div className="page" style={{ maxWidth: sel ? 420 : undefined, flex: sel ? 'none' : 1, width: sel ? '38%' : undefined }}>
        <PageHead title="ตรวจนับสต็อก" sub="ผลที่พนักงานส่งมา ตรวจแล้วอนุมัติเพื่อปรับยอด" />
        <div className="page-body">
          <div className="card">
            {counts && counts.length === 0 ? (
              <Empty icon={<ClipboardCheck size={28} />} title="ยังไม่มีการตรวจนับ">
                พนักงานเริ่มตรวจนับได้ที่เมนู ตรวจนับสต็อก ในหน้าขาย
              </Empty>
            ) : (
              (counts ?? []).map((c) => {
                const v = countVariance(c.lines ?? []);
                return (
                  <button key={c.id} className="list-row" aria-selected={sel?.id === c.id} onClick={() => setSelected(c.id)} disabled={c.status === 'draft'}>
                    <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                      <span className="t-strong">{fmtDateTime(c.submittedAt ?? c.startedAt)}</span>
                      <span className="t-sm muted num">
                        {c.staffName} · {c.status === 'draft' ? `นับแล้ว ${Object.keys(c.counts).length} รายการ` : `${c.lines?.length ?? 0} รายการ · ไม่ตรง ${v.diffLines.length}`}
                      </span>
                    </div>
                    <span className={`badge ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
      {sel && <CountReview c={sel} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CountReview({ c, onClose }: { c: StockCount; onClose: () => void }) {
  const [onlyDiff, setOnlyDiff] = useState<'diff' | 'all'>('diff');
  const [note, setNote] = useState('');
  const [approve, setApprove] = useState(false);
  const act = useAction();
  const [busy, run] = useBusy();
  const lines = c.lines ?? [];
  const v = useMemo(() => countVariance(lines), [lines]);
  const shown = onlyDiff === 'diff' ? v.diffLines : lines;

  return (
    <div className="page" style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}>
      <header className="page-head">
        <div className="stack">
          <h1 style={{ fontSize: 22 }}>ผลตรวจนับ</h1>
          <span className="sub">
            {c.staffName} · ส่งเมื่อ {c.submittedAt ? fmtDateTime(c.submittedAt) : '—'}
          </span>
        </div>
        <span className="spacer" />
        <span className={`badge ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>
        <button className="icon-btn" onClick={onClose} aria-label="ปิด">
          <X size={22} />
        </button>
      </header>
      <div className="page-body section-gap">
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <div className="card kpi" style={{ minHeight: 0 }}>
            <span className="k">นับแล้ว</span>
            <span className="v num">{lines.length}</span>
          </div>
          <div className="card kpi" style={{ minHeight: 0 }}>
            <span className="k">ไม่ตรงระบบ</span>
            <span className="v num">{v.diffLines.length}</span>
          </div>
          <div className="card kpi" style={{ minHeight: 0 }}>
            <span className="k">มูลค่าส่วนต่าง</span>
            <span className={`v num ${v.value < 0 ? 'diff-neg' : v.value > 0 ? 'diff-pos' : ''}`}>{baht(v.value)}</span>
          </div>
        </div>
        <div className="row">
          <Seg
            value={onlyDiff}
            onChange={setOnlyDiff}
            label="แสดง"
            options={[
              { value: 'diff', label: `เฉพาะที่ไม่ตรง (${v.diffLines.length})` },
              { value: 'all', label: `ทั้งหมด (${lines.length})` },
            ]}
          />
        </div>
        <div className="card table-card">
          {shown.length === 0 ? (
            <Empty icon={<ClipboardCheck size={28} />} title="ทุกรายการตรงกับระบบ" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>สินค้า</th>
                  <th className="r">ในระบบ</th>
                  <th className="r">นับได้</th>
                  <th className="r">ต่าง</th>
                  <th className="r hide-narrow">มูลค่า</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const d = l.counted - l.expected;
                  return (
                    <tr key={l.productId}>
                      <td className="t-strong">{l.name}</td>
                      <td className="r num">{num(l.expected)}</td>
                      <td className="r num">{num(l.counted)}</td>
                      <td className={`r num ${d > 0 ? 'diff-pos' : d < 0 ? 'diff-neg' : 'muted'}`}>
                        {d > 0 ? '+' : ''}
                        {d}
                      </td>
                      <td className="r num hide-narrow">{baht(d * l.cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {c.status === 'submitted' ? (
          <div className="card card-pad stack" style={{ gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="count-note">
                หมายเหตุถึงพนักงาน
              </label>
              <input id="count-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ต้องใส่เมื่อไม่อนุมัติ เช่น ให้นับชั้นหลังใหม่" maxLength={150} />
            </div>
            <p className="help">อนุมัติแล้ว ระบบจะปรับยอดตามส่วนต่างที่นับได้ การขายที่เกิดหลังส่งผลนับยังคงถูกต้อง</p>
            <div className="row">
              <button className="btn btn-secondary" disabled={!note.trim() || busy} onClick={() => run(() => act(() => rejectCount(c.id, note), 'ส่งกลับให้นับใหม่แล้ว'))}>
                ไม่อนุมัติ ให้นับใหม่
              </button>
              <span className="spacer" />
              <button className="btn btn-primary" onClick={() => setApprove(true)}>
                อนุมัติและปรับสต็อก
              </button>
            </div>
          </div>
        ) : (
          c.reviewedAt && (
            <div className={`notice ${c.status === 'approved' ? 'success' : 'warning'}`}>
              {STATUS[c.status][0]} เมื่อ {fmtDateTime(c.reviewedAt)}
              {c.reviewNote ? ` · ${c.reviewNote}` : ''}
            </div>
          )
        )}
      </div>
      <PinConfirm
        open={approve}
        onClose={() => setApprove(false)}
        title="อนุมัติผลตรวจนับ"
        description={
          <>
            ปรับสต็อก {v.diffLines.length} รายการ · มูลค่าส่วนต่าง <b className="num">{baht(v.value)}</b>
          </>
        }
        confirmLabel="การปรับยอดจะบันทึกในประวัติการแก้ไข"
        onConfirm={() => approveCount(c.id, note)}
      />
    </div>
  );
}
