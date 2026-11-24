import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, BarChart3 } from 'lucide-react';
import { db } from '../../lib/db';
import { baht, dayKey, fmtDate, fmtTime, num, pct, saleNo } from '../../lib/format';
import { byDay, byProduct, byStaff, presetRange, summarize, type Range, type RangePreset } from '../../lib/reports';
import { saveFile, toCsv } from '../../lib/files';
import { logEvent } from '../../lib/audit';
import { useAction } from '../../state/app';
import { Empty, Seg } from '../../components/ui';
import { BarChart } from '../../components/Chart';
import { PageHead } from './BackOffice';

type P = RangePreset | 'custom';

export function ReportsPage() {
  const [preset, setPreset] = useState<P>('7d');
  const [custom, setCustom] = useState<Range>(() => presetRange('month'));
  const range = useMemo<Range>(() => (preset === 'custom' ? custom : presetRange(preset)), [preset, custom]);
  const sales = useLiveQuery(() => db.sales.where('day').between(range.from, range.to, true, true).sortBy('createdAt'), [range.from, range.to]);
  const act = useAction();

  const s = useMemo(() => summarize(sales ?? []), [sales]);
  const products = useMemo(() => byProduct(sales ?? []), [sales]);
  const staff = useMemo(() => byStaff(sales ?? []), [sales]);
  const days = useMemo(() => byDay(sales ?? [], range), [sales, range]);
  const multiDay = range.from !== range.to;
  const stamp = `${range.from}_${range.to}`;

  const exportSales = () =>
    act(async () => {
      const rows: (string | number)[][] = [['date', 'time', 'number', 'staff', 'payment', 'status', 'slip', 'product', 'qty', 'price', 'cost', 'line_total', 'line_profit']];
      for (const x of sales ?? []) {
        for (const i of x.items) {
          rows.push([x.day, fmtTime(x.createdAt), saleNo(x.number), x.staffName, x.payment, x.status, x.slipStatus ?? '', i.name, i.qty, i.price / 100, i.cost / 100, (i.price * i.qty) / 100, ((i.price - i.cost) * i.qty) / 100]);
        }
      }
      const r = await saveFile(toCsv(rows), `orbiz-pos-sales-${stamp}.csv`);
      if (r !== 'cancelled') await logEvent('system', 'ส่งออกรายการขาย', `${fmtDate(range.from)} – ${fmtDate(range.to)}`);
    });

  const exportProducts = () =>
    act(async () => {
      const rows: (string | number)[][] = [['product', 'qty', 'revenue', 'cost', 'profit', 'margin']];
      for (const p of products) rows.push([p.name, p.qty, p.revenue / 100, p.cost / 100, p.profit / 100, p.revenue ? +(p.profit / p.revenue).toFixed(4) : '']);
      const r = await saveFile(toCsv(rows), `orbiz-pos-products-${stamp}.csv`);
      if (r !== 'cancelled') await logEvent('system', 'ส่งออกสรุปสินค้า', `${fmtDate(range.from)} – ${fmtDate(range.to)}`);
    });

  return (
    <div className="page">
      <PageHead title="รายงาน" sub={range.from === range.to ? fmtDate(range.from) : `${fmtDate(range.from)} – ${fmtDate(range.to)}`}>
        <button className="btn btn-secondary" onClick={exportProducts} disabled={!products.length}>
          <Download size={18} /> สรุปสินค้า CSV
        </button>
        <button className="btn btn-secondary" onClick={exportSales} disabled={!sales?.length}>
          <Download size={18} /> รายการขาย CSV
        </button>
      </PageHead>
      <div className="page-body section-gap">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <Seg<P>
            value={preset}
            onChange={setPreset}
            label="ช่วงเวลา"
            options={[
              { value: 'today', label: 'วันนี้' },
              { value: 'yesterday', label: 'เมื่อวาน' },
              { value: '7d', label: '7 วัน' },
              { value: '30d', label: '30 วัน' },
              { value: 'month', label: 'เดือนนี้' },
              { value: 'custom', label: 'กำหนดเอง' },
            ]}
          />
          {preset === 'custom' && (
            <div className="row">
              <input type="date" className="input" style={{ width: 170 }} value={custom.from} max={custom.to} aria-label="ตั้งแต่วันที่" onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
              <span className="muted">ถึง</span>
              <input type="date" className="input" style={{ width: 170 }} value={custom.to} min={custom.from} max={dayKey()} aria-label="ถึงวันที่" onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
            </div>
          )}
        </div>

        <div className="kpis">
          <div className="card kpi">
            <span className="k">ยอดขาย</span>
            <span className="v num">{baht(s.revenue)}</span>
            <span className="d num">
              เงินสด {baht(s.cash)} · โอน {baht(s.transfer)}
            </span>
          </div>
          <div className="card kpi">
            <span className="k">ต้นทุนสินค้าที่ขาย</span>
            <span className="v num">{baht(s.cost)}</span>
          </div>
          <div className="card kpi">
            <span className="k">กำไรขั้นต้น</span>
            <span className="v num">{baht(s.profit)}</span>
            <span className="d">อัตรากำไร {pct(s.margin, 1)}</span>
          </div>
          <div className="card kpi">
            <span className="k">จำนวนบิล</span>
            <span className="v num">{num(s.bills)}</span>
            <span className="d num">{s.voided ? `ยกเลิก ${s.voided} บิล (ไม่นับรวม)` : `${num(s.units)} ชิ้น`}</span>
          </div>
        </div>

        {s.bills === 0 ? (
          <div className="card" style={{ display: 'flex', minHeight: 280 }}>
            <Empty icon={<BarChart3 size={28} />} title="ไม่มียอดขายในช่วงนี้">
              ลองเลือกช่วงเวลาอื่น
            </Empty>
          </div>
        ) : (
          <>
            {multiDay && (
              <div className="card">
                <div className="card-head">
                  <h3>ยอดขายรายวัน</h3>
                </div>
                <div style={{ padding: '0 20px 16px' }}>
                  <BarChart bars={days.map((d) => ({ key: d.key, label: d.key.slice(8).replace(/^0/, ''), value: d.revenue, tip: fmtDate(d.key) }))} format={baht} />
                </div>
              </div>
            )}
            <div className="grid-2">
              <div className="card table-card">
                <div className="card-head">
                  <h3>ตามสินค้า</h3>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>สินค้า</th>
                      <th className="r">จำนวน</th>
                      <th className="r">ยอดขาย</th>
                      <th className="r hide-narrow">ต้นทุน</th>
                      <th className="r">กำไร</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.productId}>
                        <td className="t-strong">{p.name}</td>
                        <td className="r num">{num(p.qty)}</td>
                        <td className="r num">{baht(p.revenue)}</td>
                        <td className="r num hide-narrow">{baht(p.cost)}</td>
                        <td className="r num">
                          {baht(p.profit)} <span className="muted t-sm">{pct(p.revenue ? p.profit / p.revenue : NaN)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="section-gap">
                <div className="card table-card">
                  <div className="card-head">
                    <h3>ตามพนักงาน</h3>
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>พนักงาน</th>
                        <th className="r">บิล</th>
                        <th className="r">ยอดขาย</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staff.map((r) => (
                        <tr key={r.key}>
                          <td className="t-strong">{r.label}</td>
                          <td className="r num">{r.bills}</td>
                          <td className="r num">{baht(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card table-card">
                  <div className="card-head">
                    <h3>ตามวิธีชำระ</h3>
                  </div>
                  <table className="table">
                    <tbody>
                      {(
                        [
                          ['เงินสด', s.cash],
                          ['โอนเงิน', s.transfer],
                        ] as const
                      ).map(([k, v]) => (
                        <tr key={k}>
                          <td className="t-strong">{k}</td>
                          <td className="r num">{baht(v)}</td>
                          <td className="r num muted">{pct(s.revenue ? v / s.revenue : NaN)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
