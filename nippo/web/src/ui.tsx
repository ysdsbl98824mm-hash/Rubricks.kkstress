import { STAGES } from './types';

export function StageMark({ value, name }: { value: number; name?: string }) {
  return (
    <span className={'stage' + (value >= 3 ? ' hot' : '')}>
      <span className="cells" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i <= value ? 'on' : ''} />)}
      </span>
      <span className="name">{name ?? STAGES[value]}</span>
    </span>
  );
}

export function YesNo({ value, onChange, name }: { value: boolean; onChange: (v: boolean) => void; name: string }) {
  return (
    <span className="yn" role="radiogroup">
      <label><input type="radio" name={name} checked={value} onChange={() => onChange(true)} /><span>あり</span></label>
      <label><input type="radio" name={name} checked={!value} onChange={() => onChange(false)} /><span>なし</span></label>
    </span>
  );
}

export function Status({ msg }: { msg: { text: string; err?: boolean } | null }) {
  if (!msg) return null;
  return <span className={'status' + (msg.err ? ' err' : '')} role={msg.err ? 'alert' : 'status'}>{msg.text}</span>;
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 選択肢の文言に、改行してよい位置を入れる（狭い画面で「ほとんどな/い」のように切れないように） */
const PREFIX = ['全く', 'あまり', 'どちらとも', 'やや', '非常に', 'ほとんど', 'ときどき'];
export function softBreak(label: string): string {
  let s = label;
  for (const p of PREFIX) if (s.startsWith(p) && s.length > p.length + 1) { s = p + '\u200b' + s.slice(p.length); break; }
  return s.replace('当てはまらない', '当ては\u200bまらない');
}
