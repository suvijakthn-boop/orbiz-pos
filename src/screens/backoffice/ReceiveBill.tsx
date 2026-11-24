import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCopy, Check, ReceiptText } from 'lucide-react';
import { db, type Receipt } from '../../lib/db';
import { baht, fmtDateTime, num } from '../../lib/format';
import { applyReceipt, claudePrompt, defaultAction, findDuplicate, parseReceipt, receiptTotal, type LineAction } from '../../lib/receiving';
import { useAction, useToast } from '../../state/app';
import { Sheet, useBusy } from '../../components/ui';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function actionValue(a: LineAction | null): string {
  if (!a) return '';
  return a.kind === 'product' ? `p:${a.productId}` : a.kind;
}

export function ReceiveBillSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const products = useLiveQuery(() => db.products.orderBy('sort').toArray(), []);
  const recent = useLiveQuery(() => db.receipts.orderBy('at').reverse().limit(5).toArray(), []);
  const [text, setText] = useState('');
  const [actions, setActions] = useState<(LineAction | null)[]>([]);
  const [copied, setCopied] = useState<'ok' | 'manual' | null>(null);
  const [dup, setDup] = useState<Receipt | null>(null);
  const [again, setAgain] = useState(false);
  const act = useAction();
  const toast = useToast();
  const [busy, run] = useBusy();

  const parsed = useMemo(() => (text.trim() ? parseReceipt(text, products ?? []) : null), [text, products]);
  useEffect(() => {
    setActions(parsed ? parsed.lines.map(defaultAction) : []);
    setAgain(false);
    if (parsed) findDuplicate(parsed.hash).then((d) => setDup(d ?? null));
    else setDup(null);
  }, [parsed]);
  useEffect(() => {
    if (!open) {
      setText('');
      setCopied(null);
    }
  }, [open]);

  const tracked = (products ?? []).filter((p) => p.trackStock);
  const prompt = claudePrompt(products ?? []);
  const lines = parsed?.lines ?? [];
  const errors = lines.filter((l) => l.error);
  const undecided = lines.filter((l, i) => !l.error && actions[i] === null).length;
  const toAdd = lines.filter((l, i) => !l.error && actions[i] && actions[i]!.kind !== 'skip');
  const total = parsed ? receiptTotal(lines, actions, products ?? []) : 0;
  const totalMismatch = undecided === 0 && parsed?.statedTotal != null && Math.abs(parsed.statedTotal - total) > 100;
  const blocked = !parsed || toAdd.length === 0 || undecided > 0 || (!!dup && !again);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="side"
      title="รับของจากบิล"
      footer={
        <>
          <button className="btn btn-secondary btn-lg" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            className="btn btn-primary btn-lg"
            disabled={blocked || busy}
            onClick={() =>
              run(async () => {
                const r = await act(() => applyReceipt(parsed!, actions, { allowDuplicate: again }));
                if (r && typeof r === 'object') {
                  toast({ text: `รับเข้า ${r.lines.length} รายการ · ทุนรวม ${baht(r.total)}`, tone: 'success' }, 5000);
                  onClose();
                }
              })
            }
          >
            {toAdd.length ? `รับเข้า ${toAdd.length} รายการ` : 'รับเข้า'}
          </button>
        </>
      }
    >
      <section className="stack" style={{ gap: 10 }}>
        <span className="label">1. ส่งบิลให้ Claude</span>
        <p className="help" style={{ fontSize: 14, lineHeight: '20px' }}>
          กดคัดลอกคำสั่ง แล้วเปิดแอป Claude วางคำสั่ง แนบรูปบิลของสัปดาห์นี้ แล้วส่ง คำสั่งมีรายชื่อสินค้า {num(tracked.length)} รายการในแอปให้ Claude ใช้ชื่อให้ตรง
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={async () => {
              const ok = await copyText(prompt);
              setCopied(ok ? 'ok' : 'manual');
              if (ok) toast({ text: 'คัดลอกคำสั่งแล้ว วางในแอป Claude ได้เลย', tone: 'success' });
            }}
          >
            {copied === 'ok' ? <Check size={18} /> : <ClipboardCopy size={18} />} {copied === 'ok' ? 'คัดลอกแล้ว' : 'คัดลอกคำสั่งให้ Claude'}
          </button>
        </div>
        {copied === 'manual' && (
          <>
            <p className="help">เครื่องนี้คัดลอกอัตโนมัติไม่ได้ กดค้างที่ข้อความด้านล่าง แล้วเลือกทั้งหมดและคัดลอก</p>
            <textarea className="textarea selectable" readOnly value={prompt} style={{ minHeight: 140, fontSize: 13 }} aria-label="คำสั่งให้ Claude" />
          </>
        )}
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <span className="label">2. วางข้อความที่ Claude ตอบกลับ</span>
        <textarea
          className="textarea"
          style={{ minHeight: 150, fontSize: 15 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="ข้อความสรุปบิลจาก Claude"
          placeholder={'#ORBIZ-รับของ\nสัปดาห์: 2026-11-23 ถึง 2026-11-29\nบิล: แม็คโคร 24/11 ฿1,250\nน้ำเปล่า 550 ml | 48 | 4.50\nรวม: 216'}
          spellCheck={false}
        />
        {text && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setText('')}>
            ล้างข้อความ
          </button>
        )}
      </section>

      {parsed && (
        <section className="stack" style={{ gap: 12 }}>
          <span className="label">3. ตรวจก่อนรับเข้า</span>
          {!parsed.hasMark && lines.length === 0 && <div className="notice danger">ไม่พบรายการสินค้า ข้อความต้องมีบรรทัดแบบ ชื่อสินค้า | จำนวน | ทุนต่อชิ้น</div>}
          {(parsed.week || parsed.bills) && (
            <dl className="kv">
              {parsed.week && (
                <>
                  <dt>สัปดาห์</dt>
                  <dd>{parsed.week}</dd>
                </>
              )}
              {parsed.bills && (
                <>
                  <dt>บิล</dt>
                  <dd>{parsed.bills}</dd>
                </>
              )}
            </dl>
          )}
          {dup && (
            <div className="notice warning" style={{ flexDirection: 'column', gap: 8 }}>
              <span>ข้อความนี้รับเข้าไปแล้วเมื่อ {fmtDateTime(dup.at)} ถ้ารับอีกครั้ง สต็อกจะเพิ่มซ้ำ</span>
              <label className="row" style={{ gap: 10, minHeight: 44 }}>
                <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} style={{ width: 22, height: 22 }} />
                ตั้งใจรับซ้ำ (เช่น ซื้อของชุดเดิมอีกรอบ)
              </label>
            </div>
          )}
          {errors.length > 0 && <div className="notice danger">{errors.length} บรรทัดมีปัญหา จะไม่รับเข้า แก้ตัวเลขในช่องข้อความด้านบนได้</div>}
          {undecided > 0 && <div className="notice warning">{undecided} บรรทัดชื่อไม่ตรงกับสินค้าในแอป เลือกว่าเป็นสินค้าตัวไหน</div>}
          <div className="card">
            {lines.map((l, i) => {
              const a = actions[i];
              const target = a?.kind === 'product' ? (products ?? []).find((p) => p.id === a.productId) : null;
              const costChange = target && l.cost !== null && l.cost !== target.cost;
              return (
                <div key={i} className="list-row" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
                  <div className="stack" style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <span className="t-strong">{l.name || `บรรทัด ${l.line}`}</span>
                    {l.error ? (
                      <span className="error-text">
                        บรรทัด {l.line}: {l.error}
                      </span>
                    ) : (
                      <span className="t-sm muted num">
                        +{l.qty} ชิ้น · ทุน {l.cost !== null ? baht(l.cost) : 'เท่าเดิม'}
                        {costChange && <span className={l.cost! > target!.cost ? ' diff-neg' : ' diff-pos'}> (เดิม {baht(target!.cost)})</span>}
                        {target && ` · คงเหลือ ${target.stock} → ${target.stock + (l.qty ?? 0)}`}
                      </span>
                    )}
                  </div>
                  {!l.error && (l.match ? (
                    <span className="badge success">ตรงกับในแอป</span>
                  ) : (
                    <select
                      className="select"
                      style={{ flex: '1 1 200px', minHeight: 44 }}
                      value={actionValue(a)}
                      aria-label={`เลือกสินค้าสำหรับ ${l.name}`}
                      onChange={(e) => {
                        const v = e.target.value;
                        const next: LineAction | null = v === 'create' ? { kind: 'create' } : v === 'skip' ? { kind: 'skip' } : v.startsWith('p:') ? { kind: 'product', productId: v.slice(2) } : null;
                        setActions((xs) => xs.map((x, j) => (j === i ? next : x)));
                      }}
                    >
                      <option value="">เลือกว่าเป็นสินค้าไหน…</option>
                      <option value="create">เพิ่มเป็นสินค้าใหม่ (ปิดขายไว้ก่อน)</option>
                      <option value="skip">ไม่รับเข้า</option>
                      {tracked.map((p) => (
                        <option key={p.id} value={`p:${p.id}`}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
              );
            })}
          </div>
          {toAdd.length > 0 && (
            <div className="total-row">
              <span className="label">ทุนรวมที่รับเข้า</span>
              <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>
                {baht(total)}
              </span>
            </div>
          )}
          {totalMismatch && <div className="notice warning">ยอดรวมในข้อความ {baht(parsed.statedTotal!)} ไม่ตรงกับที่คำนวณได้ {baht(total)} ตรวจจำนวนหรือทุนต่อชิ้นอีกครั้ง</div>}
          <p className="help">รับเข้าแล้ว สต็อกจะเพิ่มตามจำนวน และทุนของสินค้าจะเปลี่ยนเป็นทุนต่อชิ้นของบิลนี้ บิลเก่าที่ขายไปแล้วไม่เปลี่ยน</p>
        </section>
      )}

      {!parsed && (recent ?? []).length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <span className="label">รับของล่าสุด</span>
          <div className="card">
            {(recent ?? []).map((r) => (
              <div key={r.id} className="list-row" style={{ gap: 12 }}>
                <ReceiptText size={20} className="faint" />
                <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                  <span className="t-strong">{r.week ? `สัปดาห์ ${r.week}` : fmtDateTime(r.at)}</span>
                  <span className="t-sm muted num">
                    {r.lines.length} รายการ · {fmtDateTime(r.at)}
                  </span>
                </div>
                <span className="num t-strong">{baht(r.total)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </Sheet>
  );
}
