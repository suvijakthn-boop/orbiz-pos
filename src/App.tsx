import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ShoppingBag, ReceiptText, ClipboardList, LayoutGrid } from 'lucide-react';
import { db } from './lib/db';
import { ago } from './lib/format';
import { useImageUrl } from './lib/images';
import { logEvent } from './lib/audit';
import { StaffProvider, ToastProvider, useAppHeight, useRoute, useSettings, useThemeSync, useToast, type BoRoute, type StaffRoute } from './state/app';
import { ToastStack } from './components/ui';
import { PosScreen } from './screens/staff/PosScreen';
import { HistoryScreen } from './screens/staff/HistoryScreen';
import { StockCountScreen } from './screens/staff/StockCountScreen';
import { BackOffice } from './screens/backoffice/BackOffice';
import { LockScreen } from './screens/backoffice/Lock';

export function App() {
  useAppHeight();
  useThemeSync();
  return (
    <ToastProvider render={(t, d) => <ToastStack toasts={t} dismiss={d} />}>
      <StaffProvider>
        <Shell />
      </StaffProvider>
    </ToastProvider>
  );
}

function Shell() {
  const [route, go] = useRoute();
  const [unlocked, setUnlocked] = useState(false);
  const toast = useToast();

  const lock = useCallback(() => {
    setUnlocked((was) => {
      if (was) logEvent('system', 'ล็อกระบบจัดการ').catch(() => {});
      return false;
    });
  }, []);

  // Lock the Back Office whenever the iPad switches to another app or the screen turns off.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') lock();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', lock);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', lock);
    };
  }, [lock]);

  // Ask the browser to keep our data even when storage runs low.
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  // Offer app updates without interrupting a sale.
  useEffect(() => {
    const on = (e: Event) => {
      const update = (e as CustomEvent<() => void>).detail;
      toast({ text: 'มี ORBIZ POS เวอร์ชันใหม่', action: { label: 'อัปเดต', run: update } }, 15_000);
    };
    window.addEventListener('pos:update', on);
    return () => window.removeEventListener('pos:update', on);
  }, [toast]);

  const goStaff = (page: StaffRoute) => go({ area: 'staff', page });
  const goBo = (page: BoRoute = 'overview', param?: string) => go({ area: 'bo', page, param });
  const exitBo = () => {
    lock();
    goStaff('pos');
  };

  if (route.area === 'bo') {
    if (!unlocked)
      return (
        <div className="app">
          <LockScreen
            onUnlock={() => {
              setUnlocked(true);
              logEvent('system', 'เข้าระบบจัดการ').catch(() => {});
            }}
            onExit={exitBo}
          />
        </div>
      );
    return <BackOffice page={route.page} param={route.param} go={goBo} onExit={exitBo} onLock={lock} />;
  }

  return (
    <div className="app">
      <Rail current={route.page} onNavigate={goStaff} onBackOffice={() => goBo('overview')} />
      <main className="stage">
        {route.page === 'pos' && <PosScreen onGoBackOffice={() => goBo('products')} />}
        {route.page === 'history' && <HistoryScreen />}
        {route.page === 'count' && <StockCountScreen />}
      </main>
    </div>
  );
}

function Rail({ current, onNavigate, onBackOffice }: { current: StaffRoute; onNavigate: (p: StaffRoute) => void; onBackOffice: () => void }) {
  const s = useSettings();
  const logo = useImageUrl(s.logoImageId);
  const draft = useLiveQuery(() => db.counts.where('status').equals('draft').count(), []);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const stale = !s.lastBackupAt || Date.now() - s.lastBackupAt > 24 * 3600_000;
  const items: { id: StaffRoute; label: string; icon: React.ReactNode; dot?: boolean }[] = [
    { id: 'pos', label: 'ขายสินค้า', icon: <ShoppingBag size={24} /> },
    { id: 'history', label: 'ประวัติขาย', icon: <ReceiptText size={24} /> },
    { id: 'count', label: 'ตรวจนับ', icon: <ClipboardList size={24} />, dot: !!draft },
  ];
  return (
    <nav className="rail" aria-label="เมนูหลัก">
      <div className="rail-brand">
        {logo ? (
          <img src={logo} alt={s.shopName} />
        ) : (
          <span className="wordmark" aria-label="ORBIZ POS">
            ORBIZ
            <small>POS</small>
          </span>
        )}
      </div>
      {items.map((i) => (
        <button key={i.id} className="rail-item" aria-current={current === i.id ? 'page' : undefined} onClick={() => onNavigate(i.id)}>
          {i.icon}
          <span>{i.label}</span>
          {i.dot && <span className="dot" aria-label="มีรอบตรวจนับที่ยังไม่ส่ง" />}
        </button>
      ))}
      <div className="rail-foot">
        <button className="rail-item" onClick={onBackOffice}>
          <LayoutGrid size={24} />
          <span>ระบบจัดการ</span>
        </button>
        <div className={`backup-pill ${stale ? 'stale' : ''}`} aria-label="สถานะการสำรองข้อมูล">
          สำรองข้อมูล
          <b>{s.lastBackupAt ? ago(s.lastBackupAt).replace('ที่แล้ว', '') : 'ยังไม่เคย'}</b>
        </div>
      </div>
    </nav>
  );
}
