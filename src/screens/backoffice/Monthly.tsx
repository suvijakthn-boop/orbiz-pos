import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react';
import { db } from '../../lib/db';
import { baht, dayKey, fmtDate, fmtDateTime, num, pct } from '../../lib/format';
import { addMonths, buildMonthlyReport, earliestMonth, fmtMonth, fmtMonthShort, lastMonths, monthOf, monthRange, monthlyTrend, type MonthlyReport } from '../../lib/monthly';
import { change } from '../../lib/reports';
import { saveFile, toCsv } from '../../lib/files';
import { logEvent } from '../../lib/audit';
import { useImageUrl } from '../../lib/images';
import { useAction, useSettings } from '../../state/app';
import { BarChart } from '../../components/Chart';
import { PageHead } from './BackOffice';

function Delta({ v, label }: { v: number | null; label: string }) {
  if (v === null) return <span>ไม่มีข้อมูลเดือนก่อนให้เทียบ</span>;
  return (
    <span>
      <span className={v >= 0 ? 'delta-up' : 'delta-down'}>
        {v >= 0 ? '▲' : '▼'} {pct(Math.abs(v))}
      </span>{' '}
      {label}
    </span>
  );
}

export function MonthlyPage() {
  const current = monthOf();
  const [month, setMonth] = useState(current);
  const trendMonths = useMemo(() => lastMonths(month, 12), [month]);
  const from = monthRange(trendMonths[0]).from;
  const to = monthRange(month).to;
  const sales = useLiveQuery(() => db.sales.where('day').between(from, to, true, true).toArray(), [from, to]);
  const firstSale = useLiveQuery(() => db.sales.orderBy('day').first(), []);
  const receipts = useLiveQuery(() => db.receipts.toArray(), []);
  const moves = useLiveQuery(() => db.moves.where('at').between(new Date(`${monthRange(month).from}T00:00:00`).getTime(), new Date(`${to}T23:59:59.999`).getTime(), true, true).toArray(), [month, to]);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const settings = useSettings();
  const act = useAction();

  const report = useMemo(
    () => (sales && receipts && moves && products ? buildMonthlyReport(month, { sales, receipts, moves, products }) : null),
    [month, sales, receipts, moves, products],
  );
  const trend = useMemo(() => (sales && receipts ? monthlyTrend(trendMonths, sales, receipts) : []), [trendMonths, sales, receipts]);

  // Compare like with like: while a month is running, compare with the same number of days last month.
  const prev = useMemo(() => {
    if (!sales || !receipts || !moves || !products || !report) return null;
    const pm = addMonths(month, -1);
    const pr = buildMonthlyReport(pm, { sales, receipts, moves: [], products });
    if (!report.inProgress) return pr;
    const cutDay = dayKey().slice(8);
    const cut = `${pm}-${cutDay}`;
    return buildMonthlyReport(pm, { sales: sales.filter((s) => s.day <= cut), receipts: receipts.filter((r) => dayKey(r.at) <= cut), moves: [], products });
  }, [month, sales, receipts, moves, products, report]);

  const earliest = firstSale ? earliestMonth([firstSale]) : current;
  const vsLabel = report?.inProgress ? 'จากช่วงเดียวกันเดือนก่อน' : 'จากเดือนก่อน';

  const exportCsv = () =>
    act(async () => {
      if (!report) return;
      const s = report.sales;
      const rows: (string | number)[][] = [
        ['section', 'item', 'value'],
        ['summary', 'month', report.month],
        ['summary', 'revenue', s.revenue / 100],
        ['summary', 'cost_of_goods_sold', s.cost / 100],
        ['summary', 'gross_profit', s.profit / 100],
        ['summary', 'bills', s.bills],
        ['summary', 'units', s.units],
        ['summary', 'cash', s.cash / 100],
        ['summary', 'transfer', s.transfer / 100],
        ['summary', 'voided_bills', s.voided],
        ['summary', 'voided_value', report.voidedValue / 100],
        ['summary', 'purchases', report.purchases / 100],
        ['summary', 'stock_loss_value', report.stockLossValue / 100],
        ...report.purchaseWeeks.map((w) => ['purchases', w.label, w.total / 100]),
        ...report.products.map((p) => ['product_revenue', p.name, p.revenue / 100]),
        ...report.products.map((p) => ['product_qty', p.name, p.qty]),
        ...report.staff.map((r) => ['staff_revenue', r.label, r.revenue / 100]),
        ...report.days.map((d) => ['daily_revenue', d.key, d.revenue / 100]),
      ];
      const r = await saveFile(toCsv(rows), `orbiz-pos-monthly-${report.month}.csv`);
      if (r !== 'cancelled') await logEvent('system', 'ส่งออกสรุปประจำเดือน', fmtMonth(report.month));
    });

  const print = () => {
    if (!report) return;
    logEvent('system', 'พิมพ์บิลสรุปประจำเดือน', fmtMonth(report.month)).catch(() => {});
    window.print();
  };

  return (
    <div className="page">
      <PageHead title="สรุปรายเดือน" sub={report?.inProgress ? `${fmtMonth(month)} · ข้อมูลถึง ${fmtDate(dayKey())}` : fmtMonth(month)}>
        <div className="date-nav">
          <button className="icon-btn" aria-label="เดือนก่อน" onClick={() => setMonth(addMonths(month, -1))} disabled={month <= earliest}>
            <ChevronLeft size={20} />
          </button>
          <span className="label-btn" style={{ display: 'grid', placeItems: 'center', minWidth: 150 }}>
            {fmtMonth(month)}
          </span>
          <button className="icon-btn" aria-label="เดือนถัดไป" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= current}>
            <ChevronRight size={20} />
          </button>
        </div>
        <button className="btn btn-secondary" onClick={exportCsv} disabled={!report}>
          <Download size={18} /> CSV
        </button>
        <button className="btn btn-primary" onClick={print} disabled={!report}>
          <Printer size={18} /> พิมพ์ / บันทึก PDF
        </button>
      </PageHead>
      {report && (
        <div className="page-body section-gap">
          <div className="kpis">
            <div className="card kpi">
              <span className="k">ยอดขาย</span>
              <span className="v num">{baht(report.sales.revenue)}</span>
              <span className="d">
                <Delta v={prev ? change(report.sales.revenue, prev.sales.revenue) : null} label={vsLabel} />
              </span>
            </div>
            <div className="card kpi">
              <span className="k">กำไรขั้นต้น</span>
              <span className="v num">{baht(report.sales.profit)}</span>
              <span className="d">อัตรากำไร {pct(report.sales.margin)}</span>
            </div>
            <div className="card kpi">
              <span className="k">ซื้อของเข้า</span>
              <span className="v num">{baht(report.purchases)}</span>
              <span className="d num">{report.receipts.length ? `จากบิล ${report.receipts.length} ครั้ง` : 'ยังไม่มีการรับของจากบิล'}</span>
            </div>
            <div className="card kpi">
              <span className="k">จำนวนบิล</span>
              <span className="v num">{num(report.sales.bills)}</span>
              <span className="d num">
                เฉลี่ยวันละ {baht(report.avgPerDay)} · ขาย {report.activeDays}/{report.daysElapsed} วัน
              </span>
            </div>
          </div>

          <div className="grid-2-even">
            <div className="card">
              <div className="card-head">
                <h3>12 เดือนล่าสุด</h3>
                <span className="spacer" />
                <span className="t-sm muted">ยอดขายรายเดือน</span>
              </div>
              <div style={{ padding: '0 20px 16px' }}>
                <BarChart bars={trend.map((t) => ({ key: t.month, label: fmtMonthShort(t.month), value: t.revenue, tip: `${fmtMonth(t.month)} · กำไร ${baht(t.profit)}` }))} format={baht} />
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <h3>รายวันใน{fmtMonth(month).split(' ')[0]}</h3>
                <span className="spacer" />
                {report.bestDay && <span className="t-sm muted num">ดีที่สุด {fmtDate(report.bestDay.key)}</span>}
              </div>
              <div style={{ padding: '0 20px 16px' }}>
                <BarChart
                  bars={report.days.map((d) => ({ key: d.key, label: String(Number(d.key.slice(8))), value: d.revenue, tip: fmtDate(d.key) }))}
                  format={baht}
                  highlightLast={false}
                />
              </div>
            </div>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <span className="label">บิลสรุปประจำเดือน</span>
            <p className="help">ตัวอย่างหน้าที่จะพิมพ์ กด พิมพ์ / บันทึก PDF แล้วเลือกเครื่องพิมพ์ หรือกดแชร์ในหน้าพิมพ์เพื่อบันทึกเป็น PDF ลง Files หรือส่งทาง LINE</p>
          </div>
          <div className="statement-wrap">
            <MonthlyStatement report={report} shopName={settings.shopName} logoImageId={settings.logoImageId} />
          </div>
        </div>
      )}
      {report && createPortal(<MonthlyStatement report={report} shopName={settings.shopName} logoImageId={settings.logoImageId} />, document.getElementById('print-root') ?? document.body)}
    </div>
  );
}

function Row({ k, v, strong, sub }: { k: string; v: string; strong?: boolean; sub?: string }) {
  return (
    <tr className={strong ? 'strong' : undefined}>
      <td>
        {k}
        {sub && <span className="st-sub"> {sub}</span>}
      </td>
      <td className="r num">{v}</td>
    </tr>
  );
}

export function MonthlyStatement({ report, shopName, logoImageId }: { report: MonthlyReport; shopName: string; logoImageId: string | null }) {
  const logo = useImageUrl(logoImageId);
  const s = report.sales;
  const top = report.products.slice(0, 10);
  return (
    <article className="statement" aria-label={`บิลสรุปประจำเดือน ${fmtMonth(report.month)}`}>
      <header className="st-head">
        <div className="st-brand">
          {logo ? <img src={logo} alt="" /> : null}
          <div>
            <div className="st-shop">{shopName}</div>
            <div className="st-muted">ORBIZ POS</div>
          </div>
        </div>
        <div className="st-title">
          <div className="st-doc">บิลสรุปประจำเดือน</div>
          <div className="st-month">{fmtMonth(report.month)}</div>
          <div className="st-muted">
            {fmtDate(report.range.from)} – {fmtDate(report.inProgress ? dayKey() : report.range.to)}
            {report.inProgress && ' (ยังไม่จบเดือน)'}
          </div>
        </div>
      </header>

      <section>
        <h4>สรุปยอด</h4>
        <table className="st-table">
          <tbody>
            <Row k="ยอดขาย" v={baht(s.revenue)} strong />
            <Row k="ต้นทุนสินค้าที่ขาย" v={baht(s.cost)} />
            <Row k="กำไรขั้นต้น" sub={`(${pct(s.margin, 1)})`} v={baht(s.profit)} strong />
            <Row k="จำนวนบิล" v={`${num(s.bills)} บิล · ${num(s.units)} ชิ้น`} />
            <Row k="เงินสด" v={baht(s.cash)} />
            <Row k="โอนเงิน" v={baht(s.transfer)} />
            {s.voided > 0 && <Row k="บิลที่ยกเลิก (ไม่นับในยอดขาย)" v={`${s.voided} บิล · ${baht(report.voidedValue)}`} />}
          </tbody>
        </table>
      </section>

      <section>
        <h4>ซื้อของเข้า (จากบิลที่รับเข้า)</h4>
        {report.purchaseWeeks.length === 0 ? (
          <p className="st-muted">ไม่มีการรับของจากบิลในเดือนนี้</p>
        ) : (
          <table className="st-table">
            <tbody>
              {report.purchaseWeeks.map((w) => (
                <Row key={w.label} k={w.label.startsWith('รับเข้า') ? w.label : `สัปดาห์ ${w.label}`} v={baht(w.total)} />
              ))}
              <Row k="รวมค่าซื้อของเข้า" v={baht(report.purchases)} strong />
              <Row k="ยอดขาย หัก ค่าซื้อของเข้า" v={baht(s.revenue - report.purchases)} />
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h4>สินค้าขายดี {top.length ? `${top.length} อันดับ` : ''}</h4>
        {top.length === 0 ? (
          <p className="st-muted">ไม่มีการขายในเดือนนี้</p>
        ) : (
          <table className="st-table cols">
            <thead>
              <tr>
                <th>สินค้า</th>
                <th className="r">ชิ้น</th>
                <th className="r">ยอดขาย</th>
                <th className="r">กำไร</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p) => (
                <tr key={p.productId}>
                  <td>{p.name}</td>
                  <td className="r num">{num(p.qty)}</td>
                  <td className="r num">{baht(p.revenue)}</td>
                  <td className="r num">{baht(p.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {report.staff.length > 0 && (
        <section>
          <h4>ตามพนักงาน</h4>
          <table className="st-table cols">
            <thead>
              <tr>
                <th>พนักงาน</th>
                <th className="r">บิล</th>
                <th className="r">ยอดขาย</th>
              </tr>
            </thead>
            <tbody>
              {report.staff.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="r num">{num(r.bills)}</td>
                  <td className="r num">{baht(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h4>สต็อกและเรื่องที่ต้องตรวจ</h4>
        <table className="st-table">
          <tbody>
            <Row k="สต็อกขาดจากการปรับยอดและตรวจนับ" v={report.stockLossUnits ? `${num(report.stockLossUnits)} ชิ้น · ${baht(report.stockLossValue)}` : 'ไม่มี'} />
            {report.stockGainUnits > 0 && <Row k="สต็อกเกินจากการปรับยอดและตรวจนับ" v={`${num(report.stockGainUnits)} ชิ้น · ${baht(report.stockGainValue)}`} />}
            <Row k="มูลค่าสต็อกตามทุน ณ วันที่พิมพ์" v={baht(report.inventoryValueNow)} />
            <Row k="สลิปโอนเงินที่ยังไม่ได้ตรวจ" v={report.slipsPending ? `${report.slipsPending} ใบ` : 'ไม่มี'} />
            {report.slipsFlagged > 0 && <Row k="สลิปที่มีปัญหา" v={`${report.slipsFlagged} ใบ`} />}
          </tbody>
        </table>
      </section>

      <footer className="st-foot">
        <span>พิมพ์เมื่อ {fmtDateTime(Date.now())}</span>
        <span>มูลค่าสต็อกที่ขาดคิดจากทุนปัจจุบัน · ข้อมูลจากไอแพดเครื่องนี้</span>
      </footer>
    </article>
  );
}
