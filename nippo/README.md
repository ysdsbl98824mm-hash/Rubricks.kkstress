# 日報＋ストレスチェック アプリ

構想書「ストレスチェック付き日報アプリ 構想書」の内容を、Supabase と React で作ったものです。

- 画面：`web/`（Vite + React。Netlify に置く想定）
- データベース：`supabase/migrations/`（テーブルと権限）、`supabase/seed_questions.sql`（質問85問と1〜11日目の割り当て）
- サーバー側の処理：`supabase/functions/`（Edge Functions）
- タスク管理シート側：`gas/AppSync.gs`（メンバー一覧を渡す窓口。既存の Code.gs に追加する）
- テスト：`tests/`

Supabase の設定をせずに `web/` をビルドすると、保存されないデモ表示で画面を確かめられます（`npm run dev` → http://localhost:5173）。

---

## しくみ

| 画面 | できること |
| --- | --- |
| 今日 | 日報（稼働の開始・終了、睡眠、やったこと、成果物、確認依頼、感じたこと）と「今日どうだった？」8問。今日から2日前まで入力・修正できる |
| 記録 | 自分だけ：日ごとの日報・回答・点数・段階、自分への確認依頼、**内部の確認の履歴** |
| 連絡 | 代表か運用者に送る連絡フォーム。受け取る立場の人は、届いた連絡もここで読む。相談窓口の案内 |
| 運用 | 運用者：危険以上の人（名前と段階だけ）、振り直しの記録（→代表に事後通知）、休息、内部の確認、メンバー管理、シートと同期。代表：消去の承認、履歴 |

### 中身を守るしくみ

- 点数・回答・「今日感じたこと」・連絡の本文・基準値は、Edge Functions の中で **AES-GCM で暗号化してから** 保存します。Supabase の管理画面でテーブルを開いても、`v1:...` という読めない文字列しか見えません。
- 暗号化の鍵 `DATA_KEY` は Edge Functions の秘密の設定（Secrets）にだけ置きます。
- 中身を人が読む手段は「内部の確認」（`inspect`）だけです。使うと
  1. 先に `access_log` に履歴が残る（残せなければ中身は返さない）
  2. 本人と代表にメールが届く
  3. 本人の「記録」画面の下に履歴が出る
- `access_log` は、データベースの仕組み（トリガー）で書き換え・削除ができません。例外は、代表が承認した退任者のデータ消去のときだけです。
- **限界**：Edge Functions のプログラムを書き換えられる人なら、履歴を残さずに読むプログラムを置くこともできます。メールが本人に届く点と、関数のデプロイ履歴が Supabase に残る点で気づける、という程度の守りです。同意文にもそう書いています。

### 判定（毎朝6時）

構想書の「判定ロジック」どおりです。値はすべて `settings` テーブルにあり、SQL で変えられます（下の「あとから変える」）。

1. R＝直近7日の「日ごとの得点÷32」の平均（3日未満なら保留）
2. 睡眠：直近10日で7日分以上入力があり、**10日分に換算した合計**が50時間未満なら +10ポイント
   - 構想書は「10日間の合計」ですが、入力が7日分だけだと7時間ずつ寝ても49時間で加点されてしまうので、平均×10日で比べています
3. 40/55/70/85% で段階A
4. 基準B（最初の22日、休息明け、1・5・9月に取り直し）から、3日連続でB+20ポイント以上、または5日続けてRが上がり合計10ポイント以上 → 1つ上げる。Bが55%以上なら上げない（「基準が高め」）
5. 通知：本人には段階が変わったとき・悪化を新たに検知したとき。運用者には危険以上が2日続いた日（とその後さらに上がった日）。運用者本人のときは本人の通知先へ
6. 6か月より前のデータを消去。退任から30日たった人がいれば、運用者と代表に消去の判断をお願いするメール（以後週1回）

「悪化＝点が上がる方向」として作っています。日報から自動で出す3問（F-W01・F-W04・F-W13）は、換算のしかたが未決なので点数に入れていません。

---

## 準備

必要なもの：Supabase のプロジェクト、Supabase CLI、Netlify（家計簿アプリと同じ）、メール送信用の [Resend](https://resend.com) のアカウント。

### 1. データベース

```bash
supabase link --project-ref <PROJECT_REF>
supabase db push                       # migrations のテーブルと権限
psql "<接続文字列>" -f supabase/seed_questions.sql   # または SQL Editor に貼って実行
```

最初の運用者を1人だけ SQL で入れます（あとは画面から追加できます）。

```sql
insert into public.members (name, email, is_operator) values ('自分の名前', 'you@example.com', true);
```

### 2. Edge Functions

```bash
# 鍵を作る（32バイト）。この値は、代表のパスワード管理ツールなど、なくさない場所に1回だけ控える。
# なくすと、それまでの点数・回答・感じたことは誰にも読めなくなります。
openssl rand -base64 32

supabase secrets set \
  DATA_KEY=<上で作った値> \
  CRON_SECRET=<長いランダムな文字列> \
  RESEND_API_KEY=<Resend の API キー> \
  MAIL_FROM='日報 <nippo@あなたのドメイン>' \
  APP_URL=https://<NetlifyのURL> \
  APP_ORIGIN=https://<NetlifyのURL>

# 任意：Google チャットの非公開スペースに確認依頼の知らせを出す
supabase secrets set GOOGLE_CHAT_WEBHOOK_URL=<スペースの Webhook URL>
# 任意：タスク管理シートと同期
supabase secrets set SHEET_SYNC_URL=<Apps Script の Web アプリ URL> SHEET_SYNC_TOKEN=<APP_SYNC_TOKEN と同じ値>

supabase functions deploy day me inspect contact ops
supabase functions deploy daily sync-members --no-verify-jwt
```

`daily` と `sync-members` は毎朝 pg_cron から呼ぶので、入口のログイン確認（Verify JWT）を外してデプロイします。代わりに関数の中で `x-cron-secret` を確かめ、画面から呼ばれたときはログインした運用者かどうかを確かめています。

### 3. 毎朝の処理

Database → Extensions で `pg_cron` と `pg_net` を有効にし、`supabase/cron.sql` の `<PROJECT_REF>` と `<CRON_SECRET>` を置き換えて SQL Editor で実行します。

### 4. ログイン（メールのコード）

Authentication → Email Templates → Magic Link の本文に `{{ .Token }}` を入れてください（6桁のコードがメールに載ります）。リンクだけでもログインできます。
Authentication → URL Configuration の Site URL に Netlify の URL を入れます。

### 5. 画面（Netlify）

`web/` をリポジトリに置き、Netlify の Base directory を `web` にします。環境変数に `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を入れます（`web/.env.example`）。

### 6. タスク管理シートとつなぐ（任意）

`gas/AppSync.gs` をタスク管理シートの Apps Script に追加し、ファイルの先頭に書いた手順でウェブアプリとして公開します。運用画面の「タスク管理シートと同期」で、01_組織マスタのメンバー（ID・氏名・メール・在籍状態）を取り込みます。退任にした人は、アプリでも退任になります。

---

## あとから変える

全部、あとから変えられます。

| 変えたいもの | やり方 |
| --- | --- |
| 線や検知の値（40/55/70/85%、+20、睡眠50時間など） | SQL：`update settings set value = '0.15' where key = 'raise_daily_margin';`（次の朝から反映） |
| 質問の文言・割り当て | `scripts/make_seed.py` を直して `seed_questions.sql` を作り直し、実行 |
| 判定や通知のプログラム | `supabase/functions/` を直して `supabase functions deploy <名前>` |
| テーブル | `supabase/migrations/` に新しいファイルを足して `supabase db push` |
| 画面・同意文の文面 | `web/src/` を直して push（Netlify が作り直す）。同意文は `web/src/pages/Consent.tsx` |

## テスト

```bash
node --test tests/judge.test.ts          # 判定（構想書の例1〜5を含む17件）
deno test tests/crypto.test.ts           # 暗号化
cd supabase/functions && deno check */index.ts
cd web && npm run build
```

## まだ決めていないこと（構想書の未決事項）

- 運用者への通知を「危険以上になった日」にするか「2日続いた日」にするか（いまは2日。`operator_notify_days`）
- 自動で出す3問の換算
- Google チャットへの通知の範囲（いまは確認依頼の知らせだけ、Webhook の非公開スペースへ）
- 休息の記録のしかた（いまは運用者が「運用」画面で開始・終了を入れる）
- 「再割り振り済」をシートから読むか（いまはアプリの「振り直しの記録」から代表に通知）
