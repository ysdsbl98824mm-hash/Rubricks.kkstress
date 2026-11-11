"""質問一覧（整理版3）と割り当て表から、質問バンクの SQL を作る。
使い方: python3 scripts/make_seed.py 疲労ストレス質問一覧_整理版3.xlsx > supabase/seed_questions.sql
"""
import sys, json, re, openpyxl

# 構想書「質問の割り当て」タブの表（1〜11日目 × 8枠）
DAYS = {
 1: ["S-B13","S-B05","S-A01","S-A16","S-C06","S-B29","S-B21","F-W06"],
 2: ["S-B16","S-B06","S-A02","S-A17","S-C07","U-01","S-B24","S-A15"],
 3: ["S-B18","M-01","F-W09","S-A12","S-C08","U-02","S-B22","U-05"],
 4: ["S-B14","M-02","S-A04","S-A13","S-C09","F-W12","S-B23","U-06"],
 5: ["F-S10","M-03","S-A05","S-A14","S-D02","F-W05","S-B20","U-07"],
 6: ["S-B03","M-04","S-A06","F-W08","S-B07","F-W11","S-B19","F-S06"],
 7: ["S-B11","M-05","F-W07","S-C01","F-S11","U-03","S-B25","S-B13"],
 8: ["S-B12","M-06","S-A09","S-C02","S-B09","U-04","S-B26","S-B29"],
 9: ["S-B10","S-B15","S-A10","S-C03","F-S13","F-W02","S-B27","M-01"],
 10:["U-08","S-B17","F-W10","S-C04","F-S12","F-W03","S-B28","S-B15"],
 11:["S-B04","F-S08","S-A11","S-C05","F-S09","F-S06","S-A07","S-B07"],
}

def q(s): return "'" + str(s).replace("'", "''") + "'"

wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = wb['質問一覧']
rows = []
for r in ws.iter_rows(min_row=6, values_only=True):
    if not r[0]: continue
    qid, grp, text, scale = r[0], r[1], r[5], r[8]
    grp = re.sub(r'^\d+\s*', '', str(grp))
    choices = []
    for part in str(scale).split('/'):
        label, pts = part.strip().rsplit('=', 1)
        choices.append({"label": label.strip(), "points": int(pts)})
    rows.append((qid, grp, text, choices))

ids = {r[0] for r in rows}
used = {x for d in DAYS.values() for x in d}
assert used <= ids, used - ids
assert all(len(d) == 8 for d in DAYS.values())

print("-- 自動生成（scripts/make_seed.py）。質問文は要約なので、原本で文言を確かめてから使う。")
print("insert into public.questions (id, grp, text, choices, sort) values")
print(",\n".join(f"  ({q(a)}, {q(b)}, {q(c)}, {q(json.dumps(d, ensure_ascii=False))}::jsonb, {i+1})"
                 for i, (a, b, c, d) in enumerate(rows)))
print("on conflict (id) do update set grp = excluded.grp, text = excluded.text, choices = excluded.choices, sort = excluded.sort;")
print()
print("delete from public.question_days;")
print("insert into public.question_days (cycle_day, slot, question_id) values")
print(",\n".join(f"  ({d}, {s+1}, {q(x)})" for d, xs in DAYS.items() for s, x in enumerate(xs)))
print(";")
