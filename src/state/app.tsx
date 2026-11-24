import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { DEFAULT_SETTINGS, getAllSettings, type SettingsShape } from '../lib/settings';

/* ---------------- routing (hash based, works from any folder or file host) ---------------- */

export type StaffRoute = 'pos' | 'history' | 'count';
export type BoRoute =
  | 'overview'
  | 'products'
  | 'inventory'
  | 'counts'
  | 'transactions'
  | 'slips'
  | 'reports'
  | 'staff'
  | 'log'
  | 'settings';

export type Route = { area: 'staff'; page: StaffRoute } | { area: 'bo'; page: BoRoute; param?: string };

const STAFF_PAGES: StaffRoute[] = ['pos', 'history', 'count'];
const BO_PAGES: BoRoute[] = ['overview', 'products', 'inventory', 'counts', 'transactions', 'slips', 'reports', 'staff', 'log', 'settings'];

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'admin') {
    const page = (BO_PAGES as string[]).includes(parts[1]) ? (parts[1] as BoRoute) : 'overview';
    return { area: 'bo', page, param: parts[2] };
  }
  const page = (STAFF_PAGES as string[]).includes(parts[0]) ? (parts[0] as StaffRoute) : 'pos';
  return { area: 'staff', page };
}

export function routeHash(r: Route): string {
  if (r.area === 'bo') return `#/admin/${r.page}${r.param ? `/${r.param}` : ''}`;
  return `#/${r.page}`;
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: Route) => {
    const h = routeHash(r);
    if (location.hash !== h) location.hash = h;
    setRoute(r);
  }, []);
  return [route, go];
}

/* ---------------- settings (live) ---------------- */

export function useSettings(): SettingsShape {
  const s = useLiveQuery(() => getAllSettings(), []);
  return s ?? DEFAULT_SETTINGS;
}

export function useThemeSync() {
  const theme = useLiveQuery(async () => (await db.settings.get('theme'))?.value as SettingsShape['theme'] | undefined, []);
  useEffect(() => {
    const t = theme ?? 'system';
    const el = document.documentElement;
    if (t === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', t);
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#101113');
  }, [theme]);
}

/** Keep the layout above the on-screen keyboard: size the app to the visual viewport. */
export function useAppHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    const set = () => {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
      if (vv && vv.offsetTop > 0) window.scrollTo(0, 0);
    };
    set();
    vv?.addEventListener('resize', set);
    vv?.addEventListener('scroll', set);
    window.addEventListener('resize', set);
    return () => {
      vv?.removeEventListener('resize', set);
      vv?.removeEventListener('scroll', set);
      window.removeEventListener('resize', set);
    };
  }, []);
}

/* ---------------- current staff (remembered on this iPad) ---------------- */

const STAFF_KEY = 'orbiz-pos.staff';

function readStaff(): string | null {
  try {
    return localStorage.getItem(STAFF_KEY);
  } catch {
    return null;
  }
}

interface StaffCtx {
  staffId: string | null;
  setStaffId: (id: string | null) => void;
}
const StaffContext = createContext<StaffCtx>({ staffId: null, setStaffId: () => {} });

export function StaffProvider({ children }: { children: ReactNode }) {
  const [staffId, setState] = useState<string | null>(readStaff);
  const setStaffId = useCallback((id: string | null) => {
    setState(id);
    try {
      if (id) localStorage.setItem(STAFF_KEY, id);
      else localStorage.removeItem(STAFF_KEY);
    } catch {
      /* private mode: remember for this session only */
    }
  }, []);
  const value = useMemo(() => ({ staffId, setStaffId }), [staffId, setStaffId]);
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

/** The selected staff member, or null if none / deactivated. */
export function useCurrentStaff() {
  const { staffId, setStaffId } = useContext(StaffContext);
  const staff = useLiveQuery(async () => (staffId ? (await db.staff.get(staffId)) ?? null : null), [staffId]);
  const active = staff && staff.active ? staff : null;
  return { staff: active, loading: staff === undefined && !!staffId, setStaffId };
}

/* ---------------- toasts ---------------- */

export interface Toast {
  id: number;
  text: string;
  tone?: 'default' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

interface ToastCtx {
  show: (t: Omit<Toast, 'id'>, ms?: number) => void;
}
const ToastContext = createContext<ToastCtx>({ show: () => {} });

export function ToastProvider({ children, render }: { children: ReactNode; render: (toasts: Toast[], dismiss: (id: number) => void) => ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, 'id'>, ms = 3200) => {
      const id = ++seq.current;
      setToasts((list) => [...list.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), t.action ? Math.max(ms, 5000) : ms);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {render(toasts, dismiss)}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext).show;
}

/** Run an async action and show its error message as a toast. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) toast({ text: success, tone: 'success' });
        // `undefined` always means "failed", so actions that return nothing report success as `true`.
        return (r === undefined ? true : r) as T;
      } catch (e) {
        toast({ text: (e as Error).message || 'ทำรายการไม่สำเร็จ ลองอีกครั้ง', tone: 'error' }, 4500);
        return undefined;
      }
    },
    [toast],
  );
}
