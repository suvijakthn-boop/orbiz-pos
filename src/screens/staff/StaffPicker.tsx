import { useLiveQuery } from 'dexie-react-hooks';
import { Users } from 'lucide-react';
import { db } from '../../lib/db';
import { Avatar, Empty, Sheet } from '../../components/ui';

export function StaffPicker({ open, onClose, current, onPick }: { open: boolean; onClose: () => void; current: string | null; onPick: (id: string) => void }) {
  const staff = useLiveQuery(async () => (await db.staff.toArray()).filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name, 'th')), []);
  return (
    <Sheet open={open} onClose={onClose} title="ใครขายรายการนี้">
      {staff && staff.length === 0 ? (
        <Empty icon={<Users size={28} />} title="ยังไม่มีรายชื่อพนักงาน">
          ผู้จัดการเพิ่มชื่อได้ที่ ระบบจัดการ → พนักงาน
        </Empty>
      ) : (
        <div className="choice-list">
          {(staff ?? []).map((s) => (
            <button key={s.id} className="choice" aria-pressed={s.id === current} onClick={() => onPick(s.id)} data-autofocus={s.id === current ? '' : undefined}>
              <Avatar name={s.name} size={44} />
              {s.name}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
