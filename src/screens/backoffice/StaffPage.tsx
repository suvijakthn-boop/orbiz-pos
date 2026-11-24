import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Pencil, Users, X } from 'lucide-react';
import { db } from '../../lib/db';
import { baht, dayKey } from '../../lib/format';
import { addStaff, renameStaff, setStaffActive } from '../../lib/inventory';
import { useAction } from '../../state/app';
import { Avatar, Empty } from '../../components/ui';
import { PageHead } from './BackOffice';

export function StaffPage() {
  const staff = useLiveQuery(async () => (await db.staff.toArray()).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'th')), []);
  const today = useLiveQuery(() => db.sales.where('day').equals(dayKey()).filter((s) => s.status === 'completed').toArray(), []);
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const act = useAction();

  return (
    <div className="page">
      <PageHead title="พนักงาน" sub="ชื่อที่พนักงานเลือกก่อนบันทึกการขาย" />
      <div className="page-body" style={{ maxWidth: 760 }}>
        <form
          className="row"
          style={{ marginBottom: 16 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if ((await act(() => addStaff(name), 'เพิ่มพนักงานแล้ว')) !== undefined) setName('');
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อเล่นพนักงาน" aria-label="ชื่อพนักงานใหม่" maxLength={30} />
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
            เพิ่มพนักงาน
          </button>
        </form>
        <div className="card">
          {staff && staff.length === 0 ? (
            <Empty icon={<Users size={28} />} title="ยังไม่มีพนักงาน">
              เพิ่มชื่อพนักงานอย่างน้อย 1 คน เพื่อเริ่มบันทึกการขาย
            </Empty>
          ) : (
            (staff ?? []).map((s) => {
              const mine = (today ?? []).filter((x) => x.staffId === s.id);
              return (
                <div key={s.id} className="list-row" style={{ opacity: s.active ? 1 : 0.6 }}>
                  <Avatar name={s.name} />
                  {edit?.id === s.id ? (
                    <form
                      className="row"
                      style={{ flex: 1 }}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await act(() => renameStaff(s.id, edit.name), 'เปลี่ยนชื่อแล้ว');
                        setEdit(null);
                      }}
                    >
                      <input className="input" value={edit.name} onChange={(e) => setEdit({ id: s.id, name: e.target.value })} aria-label="ชื่อพนักงาน" autoFocus maxLength={30} />
                      <button className="icon-btn" type="submit" aria-label="บันทึกชื่อ">
                        <Check size={20} />
                      </button>
                      <button className="icon-btn" type="button" onClick={() => setEdit(null)} aria-label="ยกเลิก">
                        <X size={20} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                        <span className="t-strong">{s.name}</span>
                        <span className="t-sm muted num">{s.active ? (mine.length ? `วันนี้ขาย ${mine.length} บิล · ${baht(mine.reduce((a, x) => a + x.total, 0))}` : 'วันนี้ยังไม่มีการขาย') : 'ปิดใช้แล้ว ไม่ขึ้นในรายชื่อหน้าขาย'}</span>
                      </div>
                      <button className="icon-btn" onClick={() => setEdit({ id: s.id, name: s.name })} aria-label={`เปลี่ยนชื่อ ${s.name}`}>
                        <Pencil size={18} />
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => act(() => setStaffActive(s.id, !s.active), s.active ? 'ปิดใช้ชื่อนี้แล้ว' : 'เปิดใช้ชื่อนี้แล้ว')}>
                        {s.active ? 'ปิดใช้' : 'เปิดใช้'}
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
        <p className="help" style={{ marginTop: 12 }}>
          ปิดใช้แทนการลบ เพื่อให้ประวัติการขายของพนักงานคนนั้นยังอยู่ครบ
        </p>
      </div>
    </div>
  );
}
