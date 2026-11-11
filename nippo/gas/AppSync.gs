/**
 * 日報アプリ（Supabase）にメンバー一覧を渡す、読み取り専用の窓口。
 * タスク管理シートの Apps Script に、このファイルを追加する（Code.gs はそのまま）。
 *
 * 準備：
 *  1. プロジェクトの設定 → スクリプト プロパティ に APP_SYNC_TOKEN を追加（長いランダムな文字列）
 *  2. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *     次のユーザーとして実行：自分 ／ アクセスできるユーザー：全員
 *  3. 表示された URL を Supabase の SHEET_SYNC_URL に、同じトークンを SHEET_SYNC_TOKEN に入れる
 * トークンが合わないときは何も返さない。点数や段階はシートに書き込まない。
 */
function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('APP_SYNC_TOKEN');
  const given = (e && e.parameter && e.parameter.token) || '';
  if (!token || given !== token) return json_({ error: 'unauthorized' });
  const sh = ss_().getSheetByName(MASTER_SHEET);
  const n = MEMBER_LAST_ROW - MEMBER_FIRST_ROW + 1;
  const v = sh.getRange(MEMBER_FIRST_ROW, 1, n, MEMBER_COL_STATE).getValues();
  const members = [];
  v.forEach(function (r) {
    const name = normalizeName_(r[MEMBER_COL_NAME - 1]);
    if (!name) return;
    members.push({
      id: String(r[0] || '').trim(),
      name: name,
      email: String(r[MEMBER_COL_EMAIL - 1] || '').trim(),
      state: String(r[MEMBER_COL_STATE - 1] || '').trim(),
    });
  });
  return json_({ members: members });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
