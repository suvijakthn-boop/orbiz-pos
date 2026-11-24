import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, History, Package, ReceiptText, Settings, Users } from 'lucide-react';
import { db, type LogEntry } from '../../lib/db';
import { dayKey, fmtTime, relativeDay } from '../../lib/format';
import { Empty, SearchField, Seg } from '../../components/ui';
import { PageHead } from './BackOffice';

type Area = 'all' | LogEntry['area'];
const ICON: Record<LogEntry['area'], React.ReactNode> = {
  sale: <ReceiptText size={18} />,
  product: <Package size={18} />,
  stock: <Boxes size={18} />,
  staff: <Users size={18} />,
  system: <Settings size={18} />,
};

export function ActivityLogPage() {
  const [area, setArea] = useState<Area>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(200);
  const rows = useLiveQuery(() => db.log.orderBy('at').reverse().filter((r) => area === 'all' || r.area === area).limit(limit).toArray(), [area, limit]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !t || `${r.action} ${r.detail ?? ''} ${r.actor}`.toLowerCase().includes(t));
  }, [rows, q]);
  const groups = useMemo(() => {
    const g: [string, LogEntry[]][] = [];
    for (const r of filtered) {
      const k = dayKey(r.at);
      const last = g[g.length - 1];
      if (last && last[0] === k) last[1].push(r);
      else g.push([k, [r]]);
    }
    return g;
  }, [filtered]);

  return (
    <div className="page">
      <PageHead title="ประวัติการแก้ไข" sub="ทุกการขาย การแก้สินค้า สต็อก และการตั้งค่า แก้หรือลบไม่ได้" />
      <div className="page-body">
        <div className="toolbar">
          <SearchField value={q} onChange={setQ} placeholder="ค้นหา เช่น ชื่อสินค้า เลขที่บิล" label="ค้นหาในประวัติ" />
          <Seg<Area>
            value={area}
            onChange={setArea}
            label="ประเภท"
            options={[
              { value: 'all', label: 'ทั้งหมด' },
              { value: 'sale', label: 'การขาย' },
              { value: 'product', label: 'สินค้า' },
              { value: 'stock', label: 'สต็อก' },
              { value: 'staff', label: 'พนักงาน' },
              { value: 'system', label: 'ระบบ' },
            ]}
          />
        </div>
        <div className="card table-card">
          {groups.length === 0 ? (
            <Empty icon={<History size={28} />} title="ยังไม่มีประวัติ" />
          ) : (
            groups.map(([day, list]) => (
              <section key={day}>
                <div className="day-head">{relativeDay(day)}</div>
                {list.map((r) => (
                  <div className="log-row" key={r.id}>
                    <span className="num t-sm muted" style={{ paddingTop: 8 }}>
                      {fmtTime(r.at)}
                    </span>
                    <span className="ico">{ICON[r.area]}</span>
                    <div className="stack" style={{ minWidth: 0 }}>
                      <span className="t-strong">{r.action}</span>
                      {r.detail && <span className="t-sm muted selectable">{r.detail}</span>}
                      <span className="t-xs faint">โดย {r.actor}</span>
                    </div>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
        {(rows?.length ?? 0) >= limit && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setLimit((l) => l + 300)}>
              แสดงเพิ่ม
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
