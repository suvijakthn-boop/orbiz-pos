import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DatabaseBackup, FolderInput, ImagePlus, KeyRound, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { db } from '../../lib/db';
import { ago, fmtDateTime, num } from '../../lib/format';
import { setSetting } from '../../lib/settings';
import { changePin, isWeakPin, regenerateRecovery } from '../../lib/auth';
import { createBackup, markBackupSaved, previewBackup, restoreBackup, storageEstimate, fmtBytes, type BackupPreview } from '../../lib/backup';
import { saveFile } from '../../lib/files';
import { compressImage, storeImage, useImageUrl } from '../../lib/images';
import { loadDemoData, removeDemoData } from '../../lib/seed';
import { logEvent } from '../../lib/audit';
import { useAction, useSettings, useToast } from '../../state/app';
import { Seg, Sheet, useBusy, useFilePicker } from '../../components/ui';
import { PageHead } from './BackOffice';
import { PinConfirm, PinPad } from './Lock';

export function SettingsPage() {
  const s = useSettings();
  const act = useAction();
  const toast = useToast();
  const logoUrl = useImageUrl(s.logoImageId);
  const [shopName, setShopName] = useState(s.shopName);
  const [busy, run] = useBusy();
  const [pinStep, setPinStep] = useState<'confirm' | 'new' | null>(null);
  const [recoveryStep, setRecoveryStep] = useState<'confirm' | 'show' | null>(null);
  const [recovery, setRecovery] = useState('');
  const [restoreFile, setRestoreFile] = useState<{ file: File; preview: BackupPreview } | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [demoConfirm, setDemoConfirm] = useState(false);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  const empty = useLiveQuery(async () => (await db.products.count()) === 0 && (await db.sales.count()) === 0, []);

  useEffect(() => setShopName(s.shopName), [s.shopName]);
  useEffect(() => {
    storageEstimate().then(setStorage);
  }, [s.lastBackupAt]);

  const logoPicker = useFilePicker(async (f) => {
    await act(async () => {
      const id = await storeImage(await compressImage(f, 'logo'), 'logo');
      const old = s.logoImageId;
      await setSetting('logoImageId', id);
      if (old) await db.images.delete(old);
      await logEvent('system', 'เปลี่ยนโลโก้');
    }, 'เปลี่ยนโลโก้แล้ว');
  });

  const restorePicker = useFilePicker(
    async (f) => {
      const preview = await act(() => previewBackup(f));
      if (preview) setRestoreFile({ file: f, preview });
    },
    { accept: '*/*' },
  );

  const backupNow = () =>
    run(() =>
      act(async () => {
        const { blob, filename, header } = await createBackup();
        const r = await saveFile(blob, filename);
        if (r === 'cancelled') {
          toast({ text: 'ยังไม่ได้บันทึกไฟล์สำรอง' });
          return;
        }
        await markBackupSaved(header);
        toast({ text: r === 'shared' ? 'สำรองแล้ว เลือก บันทึกไปยังไฟล์ เพื่อเก็บใน Files' : 'ดาวน์โหลดไฟล์สำรองแล้ว', tone: 'success' });
      }),
    );

  const stale = !s.lastBackupAt || Date.now() - s.lastBackupAt > 24 * 3600_000;

  return (
    <div className="page">
      <PageHead title="ตั้งค่า" />
      <div className="page-body section-gap" style={{ maxWidth: 780 }}>
        <section className="settings-group">
          <h2>สำรองข้อมูล</h2>
          <div className="card">
            <div className="setting-row">
              <DatabaseBackup size={22} />
              <div className="txt">
                <div className="t">{s.lastBackupAt ? `สำรองล่าสุด ${ago(s.lastBackupAt)}` : 'ยังไม่เคยสำรองข้อมูล'}</div>
                <div className="s">
                  {s.lastBackupAt ? fmtDateTime(s.lastBackupAt) + ' · ' : ''}ข้อมูลทั้งหมดอยู่ในไอแพดเครื่องนี้ ควรสำรองไว้ใน Files ทุกวัน
                </div>
              </div>
              <button className={`btn ${stale ? 'btn-primary' : 'btn-secondary'}`} onClick={backupNow} disabled={busy}>
                {busy ? 'กำลังเตรียมไฟล์…' : 'สำรองตอนนี้'}
              </button>
            </div>
            <div className="setting-row">
              <FolderInput size={22} />
              <div className="txt">
                <div className="t">กู้คืนจากไฟล์สำรอง</div>
                <div className="s">ใช้เมื่อย้ายไปไอแพดเครื่องใหม่ หรือข้อมูลในเครื่องหาย ข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด</div>
              </div>
              <button className="btn btn-secondary" onClick={restorePicker.open}>
                เลือกไฟล์
              </button>
              {restorePicker.input}
            </div>
            {storage && (
              <div className="setting-row">
                <span style={{ width: 22 }} />
                <div className="txt">
                  <div className="s">
                    ใช้พื้นที่ {fmtBytes(storage.usage)}
                    {storage.quota ? ` จาก ${fmtBytes(storage.quota)}` : ''} · {storage.persisted ? 'ระบบจะไม่ลบข้อมูลเอง' : 'แนะนำให้ติดตั้งแอปไว้บนหน้าจอโฮม เพื่อไม่ให้ระบบลบข้อมูลเอง'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="settings-group">
          <h2>ร้านค้า</h2>
          <div className="card">
            <div className="setting-row">
              <div className="bo-logo" style={{ width: 56, height: 56 }}>
                {logoUrl ? <img src={logoUrl} alt="โลโก้" /> : <span className="wordmark">ORBIZ</span>}
              </div>
              <div className="txt">
                <div className="t">โลโก้</div>
                <div className="s">แสดงที่แถบเมนูหน้าขายและระบบจัดการ ใช้ไฟล์ PNG พื้นใสจะสวยที่สุด</div>
              </div>
              {s.logoImageId && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    act(async () => {
                      const old = s.logoImageId;
                      await setSetting('logoImageId', null);
                      if (old) await db.images.delete(old);
                      await logEvent('system', 'กลับไปใช้โลโก้เริ่มต้น');
                    })
                  }
                >
                  ใช้ค่าเริ่มต้น
                </button>
              )}
              <button className="btn btn-secondary" onClick={logoPicker.open}>
                <ImagePlus size={18} /> เปลี่ยนโลโก้
              </button>
              {logoPicker.input}
            </div>
            <form
              className="setting-row"
              onSubmit={(e) => {
                e.preventDefault();
                const n = shopName.trim();
                if (!n || n === s.shopName) return;
                act(async () => {
                  await setSetting('shopName', n);
                  await logEvent('system', 'เปลี่ยนชื่อร้าน', `${s.shopName} → ${n}`);
                }, 'บันทึกชื่อร้านแล้ว');
              }}
            >
              <div className="txt field">
                <label className="t" htmlFor="shop-name">
                  ชื่อร้าน
                </label>
                <input id="shop-name" className="input" value={shopName} onChange={(e) => setShopName(e.target.value)} maxLength={40} />
              </div>
              <button className="btn btn-secondary" type="submit" disabled={!shopName.trim() || shopName.trim() === s.shopName} style={{ alignSelf: 'flex-end' }}>
                บันทึก
              </button>
            </form>
            <div className="setting-row">
              <div className="txt">
                <div className="t">ธีม</div>
                <div className="s">ตามระบบ จะเปลี่ยนเป็นโหมดมืดตามการตั้งค่าของไอแพด</div>
              </div>
              <Seg
                value={s.theme}
                onChange={(v) => setSetting('theme', v)}
                label="ธีม"
                options={[
                  { value: 'system', label: 'ตามระบบ' },
                  { value: 'light', label: 'สว่าง' },
                  { value: 'dark', label: 'มืด' },
                ]}
              />
            </div>
          </div>
        </section>

        <section className="settings-group">
          <h2>ความปลอดภัย</h2>
          <div className="card">
            <div className="setting-row">
              <div className="txt">
                <div className="t">ล็อกระบบจัดการอัตโนมัติ</div>
                <div className="s">เมื่อไม่มีการแตะหน้าจอตามเวลานี้ และทุกครั้งที่สลับไปแอปอื่น</div>
              </div>
              <Seg
                value={String(s.autoLockMinutes)}
                onChange={(v) => act(async () => (await setSetting('autoLockMinutes', Number(v)), await logEvent('system', `ตั้งล็อกอัตโนมัติ ${v} นาที`)))}
                label="เวลาล็อกอัตโนมัติ"
                options={['1', '3', '5', '10'].map((m) => ({ value: m, label: `${m} นาที` }))}
              />
            </div>
            <div className="setting-row">
              <KeyRound size={22} />
              <div className="txt">
                <div className="t">เปลี่ยน PIN ผู้จัดการ</div>
                <div className="s">ใช้เปิดระบบจัดการและยืนยันการแก้ไขสำคัญ</div>
              </div>
              <button className="btn btn-secondary" onClick={() => setPinStep('confirm')}>
                เปลี่ยน PIN
              </button>
            </div>
            <div className="setting-row">
              <ShieldCheck size={22} />
              <div className="txt">
                <div className="t">รหัสกู้คืน</div>
                <div className="s">ใช้ตั้ง PIN ใหม่เมื่อลืม สร้างใหม่แล้วรหัสเดิมจะใช้ไม่ได้</div>
              </div>
              <button className="btn btn-secondary" onClick={() => setRecoveryStep('confirm')}>
                สร้างรหัสใหม่
              </button>
            </div>
          </div>
        </section>

        {(empty || s.demoLoaded) && (
          <section className="settings-group">
            <h2>ข้อมูลตัวอย่าง</h2>
            <div className="card">
              <div className="setting-row">
                <Sparkles size={22} />
                <div className="txt">
                  <div className="t">{s.demoLoaded ? 'มีข้อมูลตัวอย่างอยู่ในเครื่อง' : 'ลองระบบด้วยข้อมูลตัวอย่าง'}</div>
                  <div className="s">{s.demoLoaded ? 'ลบก่อนเริ่มขายจริง ข้อมูลที่เพิ่มเองจะไม่ถูกลบ' : 'สินค้า 16 รายการ พนักงาน 3 คน และยอดขาย 2 สัปดาห์ เพื่อดูว่าระบบทำงานอย่างไร'}</div>
                </div>
                {s.demoLoaded ? (
                  <button className="btn btn-danger-ghost" onClick={() => setDemoConfirm(true)}>
                    <Trash2 size={18} /> ลบข้อมูลตัวอย่าง
                  </button>
                ) : (
                  <button className="btn btn-secondary" disabled={busy} onClick={() => run(() => act(() => loadDemoData(), 'ใส่ข้อมูลตัวอย่างแล้ว'))}>
                    ใส่ข้อมูลตัวอย่าง
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        <p className="t-xs faint">ORBIZ POS 1.0 · ทำงานในเครื่องโดยไม่ต้องใช้อินเทอร์เน็ต</p>
      </div>

      <PinConfirm open={pinStep === 'confirm'} onClose={() => setPinStep((p) => (p === 'confirm' ? null : p))} title="เปลี่ยน PIN" description="ใส่ PIN ปัจจุบันก่อน แล้วจึงตั้ง PIN ใหม่" confirmLabel="ขั้นที่ 1 จาก 2" onConfirm={() => setPinStep('new')} />
      <NewPinSheet open={pinStep === 'new'} onClose={() => setPinStep(null)} />

      <PinConfirm
        open={recoveryStep === 'confirm'}
        onClose={() => setRecoveryStep((p) => (p === 'confirm' ? null : p))}
        title="สร้างรหัสกู้คืนใหม่"
        description="รหัสกู้คืนเดิมจะใช้ไม่ได้อีก"
        confirmLabel="รหัสใหม่จะแสดงครั้งเดียว"
        onConfirm={async () => {
          setRecovery(await regenerateRecovery());
          setRecoveryStep('show');
        }}
      />
      <Sheet
        open={recoveryStep === 'show'}
        onClose={() => setRecoveryStep(null)}
        title="รหัสกู้คืนใหม่"
        footer={
          <button className="btn btn-primary btn-lg" onClick={() => setRecoveryStep(null)}>
            จดรหัสแล้ว
          </button>
        }
      >
        <p>จดเก็บไว้ในที่ปลอดภัย รหัสนี้จะไม่แสดงอีก</p>
        <div className="recovery-code num" style={{ background: 'var(--accent-soft)', color: 'var(--text)', textAlign: 'center' }}>
          {recovery}
        </div>
      </Sheet>

      <Sheet
        open={!!restoreFile && !restoreConfirm}
        onClose={() => setRestoreFile(null)}
        title="กู้คืนจากไฟล์สำรอง"
        footer={
          <>
            <button className="btn btn-secondary btn-lg" onClick={() => setRestoreFile(null)}>
              ยกเลิก
            </button>
            <button className="btn btn-danger btn-lg" onClick={() => setRestoreConfirm(true)}>
              แทนที่ข้อมูลในเครื่อง
            </button>
          </>
        }
      >
        {restoreFile && (
          <>
            <dl className="kv">
              <dt>ไฟล์สำรองเมื่อ</dt>
              <dd>{fmtDateTime(restoreFile.preview.createdAt)}</dd>
              <dt>รายการขาย</dt>
              <dd className="num">{num(restoreFile.preview.counts.sales ?? 0)}</dd>
              <dt>สินค้า</dt>
              <dd className="num">{num(restoreFile.preview.counts.products ?? 0)}</dd>
              <dt>รูป</dt>
              <dd className="num">{num(restoreFile.preview.counts.images ?? 0)}</dd>
            </dl>
            <div className="notice danger">ข้อมูลทั้งหมดในไอแพดเครื่องนี้จะถูกแทนที่ด้วยข้อมูลในไฟล์ รวมถึง PIN ผู้จัดการ ถ้ายังไม่แน่ใจ ให้สำรองข้อมูลปัจจุบันก่อน</div>
          </>
        )}
      </Sheet>
      <PinConfirm
        open={restoreConfirm}
        onClose={() => setRestoreConfirm(false)}
        danger
        title="ยืนยันการกู้คืน"
        description="ข้อมูลปัจจุบันในเครื่องจะถูกแทนที่ทั้งหมด"
        confirmLabel="หลังกู้คืน แอปจะเริ่มใหม่ที่หน้าขาย"
        onConfirm={async () => {
          await restoreBackup(restoreFile!.file);
          setRestoreFile(null);
          location.hash = '#/pos';
          location.reload();
        }}
      />
      <PinConfirm
        open={demoConfirm}
        onClose={() => setDemoConfirm(false)}
        danger
        title="ลบข้อมูลตัวอย่าง"
        description="สินค้า พนักงาน และรายการขายตัวอย่างทั้งหมดจะถูกลบ ข้อมูลที่เพิ่มเองยังอยู่"
        confirmLabel="ลบแล้วกู้คืนไม่ได้"
        onConfirm={async () => {
          await removeDemoData();
          toast({ text: 'ลบข้อมูลตัวอย่างแล้ว', tone: 'success' });
        }}
      />
    </div>
  );
}

function NewPinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [key, setKey] = useState(0);
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setFirst(null);
      setError('');
    }
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={first ? 'ยืนยัน PIN ใหม่' : 'ตั้ง PIN ใหม่'}>
      <div className="stack pin-light" style={{ alignItems: 'center', gap: 8 }}>
        <span className="muted">{first ? 'ใส่ PIN ใหม่อีกครั้ง' : 'ตัวเลข 6 หลักที่เดายาก'}</span>
        <PinPad
          resetKey={key}
          error={error}
          onComplete={async (pin) => {
            setError('');
            if (!first) {
              if (isWeakPin(pin)) {
                setError('PIN นี้เดาง่าย ใช้ตัวเลขที่ไม่เรียงกันหรือซ้ำกัน');
                return;
              }
              setFirst(pin);
              setKey((k) => k + 1);
              return;
            }
            if (pin !== first) {
              setFirst(null);
              setError('PIN สองครั้งไม่ตรงกัน ตั้งใหม่อีกครั้ง');
              return;
            }
            await changePin(pin);
            toast({ text: 'เปลี่ยน PIN แล้ว', tone: 'success' });
            onClose();
          }}
        />
        <p className="error-text" role="alert" style={{ minHeight: 18 }}>
          {error}
        </p>
      </div>
    </Sheet>
  );
}
