-- 毎朝の処理を登録する（Edge Functions をデプロイしたあとに、SQL Editor で1回だけ実行）
-- <PROJECT_REF> と <CRON_SECRET> を自分の値に置き換える。
-- 事前に Database → Extensions で pg_cron と pg_net を有効にする。

-- 毎朝6時（日本時間）＝ 21時（UTC）：前日分の判定・通知・古いデータの消去
select cron.schedule('nippo-daily', '0 21 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);

-- 毎朝5時半（日本時間）：タスク管理シートからメンバーを同期（使う場合だけ）
select cron.schedule('nippo-sync-members', '30 20 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-members',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
$$);

-- 止めるとき： select cron.unschedule('nippo-daily');
-- 確認：       select * from cron.job;  select * from cron.job_run_details order by start_time desc limit 10;
