import { useEffect, useRef, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  LayoutDashboard,
  Package,
  Boxes,
  ClipboardCheck,
  ReceiptText,
  Images,
  BarChart3,
  CalendarRange,
  Users,
  History,
  Settings as SettingsIcon,
  ArrowLeftToLine,
  Lock,
} from 'lucide-react';
import { db } from '../../lib/db';
import { isLowStock } from '../../lib/inventory';
import { useImageUrl } from '../../lib/images';
import type { BoRoute } from '../../state/app';
import { useSettings } from '../../state/app';
import { Overview } from './Overview';
import { ProductsPage } from './Products';
import { InventoryPage } from './Inventory';
import { CountsPage } from './Counts';
import { TransactionsPage } from './Transactions';
import { SlipsPage } from './Slips';
import { ReportsPage } from './Reports';
import { MonthlyPage } from './Monthly';
import { StaffPage } from './StaffPage';
import { ActivityLogPage } from './ActivityLog';
import { SettingsPage } from './Settings';

const NAV: { id: BoRoute; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'ภาพรวม', icon: <LayoutDashboard size={20} /> },
  { id: 'products', label: 'สินค้า', icon: <Package size={20} /> },
  { id: 'inventory', label: 'สต็อก', icon: <Boxes size={20} /> },
  { id: 'counts', label: 'ตรวจนับ', icon: <ClipboardCheck size={20} /> },
  { id: 'transactions', label: 'รายการขาย', icon: <ReceiptText size={20} /> },
  { id: 'slips', label: 'สลิปโอนเงิน', icon: <Images size={20} /> },
  { id: 'reports', label: 'รายงาน', icon: <BarChart3 size={20} /> },
  { id: 'monthly', label: 'สรุปรายเดือน', icon: <CalendarRange size={20} /> },
  { id: 'staff', label: 'พนักงาน', icon: <Users size={20} /> },
  { id: 'log', label: 'ประวัติการแก้ไข', icon: <History size={20} /> },
  { id: 'settings', label: 'ตั้งค่า', icon: <SettingsIcon size={20} /> },
];

export function useAttention() {
  return useLiveQuery(async () => {
    const [slips, reports, counts, products] = await Promise.all([
      db.sales.where('slipStatus').equals('pending').filter((s) => s.status === 'completed').count(),
      db.reports.where('status').equals('open').count(),
      db.counts.where('status').equals('submitted').count(),
      db.products.toArray(),
    ]);
    return { slips, reports, counts, low: products.filter(isLowStock).length };
  }, []);
}

export function BackOffice({ page, param, go, onExit, onLock }: { page: BoRoute; param?: string; go: (p: BoRoute, param?: string) => void; onExit: () => void; onLock: () => void }) {
  const settings = useSettings();
  const attention = useAttention();
  const logoUrl = useImageUrl(settings.logoImageId);

  // Lock after inactivity.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const ms = Math.max(1, settings.autoLockMinutes) * 60_000;
    const reset = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(onLock, ms);
    };
    reset();
    const evts = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    evts.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer.current);
      evts.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [settings.autoLockMinutes, onLock]);

  const badge: Partial<Record<BoRoute, number>> = {
    slips: attention?.slips,
    transactions: attention?.reports,
    counts: attention?.counts,
    inventory: attention?.low,
  };

  return (
    <div className="bo">
      <aside className="bo-side" aria-label="เมนูระบบจัดการ">
        <div className="bo-brand">
          <div className="bo-logo">{logoUrl ? <img src={logoUrl} alt={settings.shopName} /> : <span className="wordmark">ORBIZ</span>}</div>
          <div className="names stack" style={{ minWidth: 0 }}>
            <span className="t1 ellipsis">ระบบจัดการ</span>
            <span className="t2 ellipsis">{settings.shopName}</span>
          </div>
        </div>
        <nav className="bo-nav">
          {NAV.map((n) => (
            <button key={n.id} aria-current={page === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
              {n.icon}
              <span>{n.label}</span>
              {!!badge[n.id] && (
                <span className="n num" aria-label={`${badge[n.id]} รายการต้องดู`}>
                  {badge[n.id]}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="bo-side-foot">
          <button className="btn btn-ghost btn-block" onClick={onLock} style={{ justifyContent: 'flex-start' }}>
            <Lock size={18} /> <span>ล็อกระบบจัดการ</span>
          </button>
          <button className="btn btn-primary btn-block" onClick={onExit} data-testid="return-to-pos">
            <ArrowLeftToLine size={18} /> <span>กลับหน้าขายสินค้า</span>
          </button>
        </div>
      </aside>
      <main className="bo-main">
        {page === 'overview' && <Overview go={go} />}
        {page === 'products' && <ProductsPage />}
        {page === 'inventory' && <InventoryPage initial={param} />}
        {page === 'counts' && <CountsPage />}
        {page === 'transactions' && <TransactionsPage initial={param} />}
        {page === 'slips' && <SlipsPage />}
        {page === 'reports' && <ReportsPage />}
        {page === 'monthly' && <MonthlyPage />}
        {page === 'staff' && <StaffPage />}
        {page === 'log' && <ActivityLogPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="stack" style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {sub && <span className="sub">{sub}</span>}
      </div>
      <span className="spacer" />
      {children}
    </header>
  );
}
