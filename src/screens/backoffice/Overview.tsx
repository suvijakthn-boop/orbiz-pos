import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ChevronRight, ClipboardCheck, Flag, Images, PackageMinus, CheckCircle2 } from 'lucide-react';
import { db } from '../../lib/db';
import { baht, num, pct, fmtDateShort, dayKey, fmtDate } from '../../lib/format';
import { byDay, byHour, byProduct, change, inventoryValue, presetRange, previousRange, summarize, type RangePreset } from '../../lib/reports';
import { isLowStock, countVariance } from '../../lib/inventory';
import type { BoRoute } from '../../state/app';
import { Seg, Thumb } from '../../components/ui';
import { BarChart } from '../../components/Chart';
import { PageHead, useAttention } from './BackOffice';

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'วันนี้' },
  { value: '7d', label: '7 วัน' },
  { value: '30d', label: '30 วัน' },
  { value: 'month', label: 'เดือนนี้' },
];

function Delta({ v, label }: { v: number | null; label: string }) {
  if (v === null) return <span>ไม่มีข้อมูลช่วงก่อนให้เทียบ</span>;
  const up = v >= 0;
  return (
    <span>
      <span className={up ? 'delta-up' : 'delta-down'}>
        {up ? '▲' : '▼'} {pct(Math.abs(v))}
      </span>{' '}
      {label}
    </span>
  );
}

export function Overview({ go }: { go: (p: BoRoute, param?: string) => void }) {
  const [preset, setPreset] = useState<RangePreset>('today');
  const range = useMemo(() => presetRange(preset), [preset]);
  const prev = useMemo(() => previousRange(range), [range]);
  const sales = useLiveQuery(() => db.sales.where('day').between(range.from, range.to, true, true).toArray(), [range.from, range.to]);
  const prevSales = useLiveQuery(() => db.sales.where('day').between(prev.from, prev.to, true, true).toArray(), [prev.from, prev.to]);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const submitted = useLiveQuery(() => db.counts.where('status').equals('submitted').toArray(), []);
  const attention = useAttention();

  const s = useMemo(() => summarize(sales ?? []), [sales]);
  // Compare like with like: if the range ends today, only count the previous range up to the same time of day.
  const p = useMemo(() => {
    const len = range.to >= dayKey() ? (Date.now() - new Date(`${range.from}T00:00:00`).getTime()) : Infinity;
    const cut = new Date(`${prev.from}T00:00:00`).getTime() + len;
    return summarize((prevSales ?? []).filter((x) => x.createdAt <= cut));
  }, [prevSales, range, prev]);
  const bars = useMemo(() => {
    if (!sales) return [];
    if (preset === 'today') return byHour(sales).map((r) => ({ key: r.key, label: r.label.slice(0, 2), value: r.revenue, tip: r.label }));
    return byDay(sales, range).map((r) => ({ key: r.key, label: fmtDateShort(r.key).split(' ')[0], value: r.revenue, tip: fmtDate(r.key) }));
  }, [sales, preset, range]);
  const top = useMemo(() => byProduct(sales ?? []).slice(0, 5), [sales]);
  const low = useMemo(() => (products ?? []).filter(isLowStock).sort((a, b) => a.stock - b.stock), [products]);
  const invValue = useMemo(() => inventoryValue(products ?? []), [products]);
  const variance = useMemo(() => (submitted ?? []).reduce((a, c) => a + countVariance(c.lines ?? []).diffLines.length, 0), [submitted]);
  const imgOf = useMemo(() => new Map((products ?? []).map((x) => [x.id, x.imageId])), [products]);

  const actions = [
    { n: attention?.slips ?? 0, label: 'สลิปโอนเงินรอตรวจ', icon: <Images size={18} />, cls: 'acc', go: () => go('slips') },
    { n: attention?.reports ?? 0, label: 'พนักงานแจ้งรายการผิด', icon: <Flag size={18} />, cls: 'warn', go: () => go('transactions', 'reported') },
    { n: attention?.counts ?? 0, label: variance ? `ผลตรวจนับรออนุมัติ · ไม่ตรง ${variance} รายการ` : 'ผลตรวจนับรออนุมัติ', icon: <ClipboardCheck size={18} />, cls: 'acc', go: () => go('counts') },
    { n: attention?.low ?? 0, label: 'สินค้าใกล้หมดหรือหมดแล้ว', icon: <PackageMinus size={18} />, cls: 'warn', go: () => go('inventory', 'low') },
  ];
  const pending = actions.filter((a) => a.n > 0);

  return (
    <div className="page">
      <PageHead title="ภาพรวม" sub={preset === 'today' ? fmtDate(dayKey()) : `${fmtDate(range.from)} – ${fmtDate(range.to)}`}>
        <Seg value={preset} onChange={setPreset} options={PRESETS} label="ช่วงเวลา" />
      </PageHead>
      <div className="page-body section-gap">
        <div className="kpis">
          <div className="card kpi">
            <span className="k">ยอดขาย</span>
            <span className="v num">{baht(s.revenue)}</span>
            <span className="d">
              <Delta v={change(s.revenue, p.revenue)} label={preset === 'today' ? 'จากเมื่อวานเวลานี้' : 'จากช่วงก่อนหน้า'} />
            </span>
          </div>
          <div className="card kpi">
            <span className="k">กำไรขั้นต้น</span>
            <span className="v num">{baht(s.profit)}</span>
            <span className="d">อัตรากำไร {pct(s.margin)}</span>
          </div>
          <div className="card kpi">
            <span className="k">จำนวนบิล</span>
            <span className="v num">{num(s.bills)}</span>
            <span className="d num">
              {num(s.units)} ชิ้น · เฉลี่ย {baht(s.avgBill)} ต่อบิล
            </span>
          </div>
          <div className="card kpi">
            <span className="k">มูลค่าสต็อก (ทุน)</span>
            <span className="v num">{baht(invValue)}</span>
            <span className="d num">{num((products ?? []).filter((x) => x.active && x.trackStock).length)} สินค้าที่นับสต็อก</span>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-head">
              <h3>{preset === 'today' ? 'ยอดขายรายชั่วโมง' : 'ยอดขายรายวัน'}</h3>
              <span className="spacer" />
              <span className="t-sm muted num">
                เงินสด {baht(s.cash)} · โอน {baht(s.transfer)}
              </span>
            </div>
            <div style={{ padding: '0 20px 16px' }}>
              {s.bills === 0 ? (
                <div className="empty" style={{ minHeight: 220 }}>
                  <p>ยังไม่มียอดขายในช่วงนี้</p>
                </div>
              ) : (
                <BarChart bars={bars} format={baht} highlightLast={preset !== 'today'} />
              )}
            </div>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="card-head">
              <h3>ต้องดำเนินการ</h3>
            </div>
            {pending.length === 0 ? (
              <div className="empty" style={{ padding: 24 }}>
                <div className="empty-icon" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                  <CheckCircle2 size={28} />
                </div>
                <h3>ไม่มีเรื่องค้าง</h3>
                <p>สลิป รายการแจ้งผิด และผลตรวจนับ ตรวจครบแล้ว</p>
              </div>
            ) : (
              pending.map((a) => (
                <button key={a.label} className="action-row" onClick={a.go}>
                  <span className={`ico ${a.cls}`}>{a.icon}</span>
                  <span style={{ flex: 1 }}>{a.label}</span>
                  <span className="n num">{a.n}</span>
                  <ChevronRight size={18} className="faint" />
                </button>
              ))
            )}
          </div>
        </div>

        <div className="grid-2-even">
          <div className="card">
            <div className="card-head">
              <h3>ขายดี</h3>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => go('reports')}>
                ดูรายงาน <ChevronRight size={16} />
              </button>
            </div>
            {top.length === 0 ? (
              <p className="muted" style={{ padding: '0 20px 20px' }}>
                ยังไม่มีการขายในช่วงนี้
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th className="grow">สินค้า</th>
                    <th className="r">ขายได้</th>
                    <th className="r">ยอดขาย</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((r) => (
                    <tr key={r.productId}>
                      <td className="grow">
                        <div className="row" style={{ gap: 12 }}>
                          <Thumb imageId={imgOf.get(r.productId) ?? null} name={r.name} size={40} />
                          <span className="ellipsis">{r.name}</span>
                        </div>
                      </td>
                      <td className="r num">{num(r.qty)}</td>
                      <td className="r num t-strong">{baht(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <div className="card-head">
              <h3>สินค้าใกล้หมด</h3>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => go('inventory', 'low')}>
                จัดการสต็อก <ChevronRight size={16} />
              </button>
            </div>
            {low.length === 0 ? (
              <p className="muted" style={{ padding: '0 20px 20px' }}>
                สต็อกทุกรายการยังพอขาย
              </p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th className="grow">สินค้า</th>
                    <th className="r">คงเหลือ</th>
                    <th className="r">แจ้งเมื่อเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {low.slice(0, 6).map((x) => (
                    <tr key={x.id} className="clickable" onClick={() => go('inventory', x.id)}>
                      <td className="grow">
                        <div className="row" style={{ gap: 12 }}>
                          <Thumb imageId={x.imageId} name={x.name} size={40} />
                          <span className="ellipsis">{x.name}</span>
                        </div>
                      </td>
                      <td className="r">
                        {x.stock <= 0 ? (
                          <span className="badge danger">หมด</span>
                        ) : (
                          <span className="badge warning num">
                            <AlertTriangle size={12} /> {x.stock}
                          </span>
                        )}
                      </td>
                      <td className="r num muted">{x.lowStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
