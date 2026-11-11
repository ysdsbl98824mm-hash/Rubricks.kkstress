-- 日報＋ストレスチェック アプリ：テーブル・権限
-- 点数・回答・「今日感じたこと」・連絡フォームの本文・基準値は、Edge Functions で暗号化してから保存する（*_enc 列）。
-- 管理画面からテーブルを開いても、暗号化した列は読めない。中身を読めるのは Edge Functions だけ。

-- ============ メンバー ============
create table public.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  sheet_id text unique,                       -- タスク管理シート「01_組織マスタ」のメンバーID
  name text not null,
  email text not null unique check (email = lower(email)),
  notify_email text check (notify_email is null or notify_email = lower(notify_email)),  -- 通知先（空ならemail）
  is_operator boolean not null default false,
  is_representative boolean not null default false,
  status text not null default 'active' check (status in ('active', 'retired')),
  retired_at date,
  consent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============ 質問 ============
create table public.questions (
  id text primary key,                        -- S-B13 など
  grp text not null,
  text text not null,
  choices jsonb not null,                     -- [{"label":"全くない","points":0}, ...] 表示順
  sort int not null
);

create table public.question_days (
  cycle_day int not null check (cycle_day between 1 and 11),
  slot int not null check (slot between 1 and 8),
  question_id text not null references public.questions(id),
  primary key (cycle_day, slot)
);

-- ============ 日報 ============
create table public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  date date not null,
  start_time time,
  end_time time,                              -- 開始より前なら日をまたいだ扱い
  sleep_hours numeric(3,1) check (sleep_hours between 0 and 24),
  did text not null default '',
  has_deliverable boolean not null default false,
  deliverable_note text not null default '',
  feelings_enc text,                          -- 暗号化
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, date)
);

create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.daily_reports(id) on delete cascade,
  from_member_id uuid not null references public.members(id) on delete cascade,
  to_member_id uuid not null references public.members(id) on delete cascade,
  date date not null,
  note text not null,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

-- ストレスチェック（1日1行。回答と得点はまとめて暗号化）
create table public.stress_days (
  member_id uuid not null references public.members(id) on delete cascade,
  date date not null,
  cycle_day int not null check (cycle_day between 1 and 11),
  answers_enc text not null,                  -- [{"q":"S-B13","p":2}, ...]
  score_enc text not null,                    -- 0〜32
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, date)
);

-- ============ 判定 ============
create table public.baselines (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  start_date date not null,
  kind text not null check (kind in ('initial', 'rest', 'season')),
  value_enc text,                             -- B（0〜1）を暗号化。集め終わるまで null
  fixed_on date,
  created_at timestamptz not null default now(),
  unique (member_id, start_date)
);

create table public.stages (
  member_id uuid not null references public.members(id) on delete cascade,
  date date not null,
  stage int check (stage between 0 and 4),    -- 0健康 1やや偏りあり 2不安定 3危険 4今すぐ休息。保留は null
  held boolean not null default false,
  raised boolean not null default false,      -- 本人の基準からの悪化で1つ上げた
  baseline_high boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (member_id, date)
);

create table public.rests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  start_date date not null,
  end_date date,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

-- ============ 運用 ============
create table public.reassignments (
  id uuid primary key default gen_random_uuid(),
  from_member_id uuid references public.members(id) on delete set null,
  from_name text not null,
  to_names text not null,
  note text not null default '',
  created_by uuid references public.members(id) on delete set null,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  from_member_id uuid not null references public.members(id) on delete cascade,
  to_role text not null check (to_role in ('operator', 'representative')),
  body_enc text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- 内部の確認（中身の閲覧）の履歴。消せない・書き換えられない
create table public.access_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_member_id uuid references public.members(id) on delete set null,
  actor_name text not null,
  target_member_id uuid references public.members(id) on delete cascade,
  target_name text not null,
  range_from date not null,
  range_to date not null,
  reason text not null,
  notified boolean not null default false
);

create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  member_name text not null,
  requested_by uuid references public.members(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_by uuid references public.members(id) on delete set null,
  approved_at timestamptz,
  executed_at timestamptz
);

create table public.notifications_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,                          -- stage / danger / self_danger / reassign / review / contact / inspect / retired
  to_address text not null,
  member_id uuid references public.members(id) on delete cascade,
  ok boolean not null,
  error text
);

create table public.settings (
  key text primary key,
  value jsonb not null
);

create index on public.daily_reports (member_id, date desc);
create index on public.stages (date);
create index on public.review_requests (to_member_id, date desc);

-- ============ 履歴を守る ============
create function public.protect_access_log() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- 通知済みの印だけは付けられる
    if new.notified is distinct from old.notified
       and (new.at, new.actor_member_id, new.actor_name, new.target_member_id, new.target_name,
            new.range_from, new.range_to, new.reason)
           is not distinct from
           (old.at, old.actor_member_id, old.actor_name, old.target_member_id, old.target_name,
            old.range_from, old.range_to, old.reason) then
      return new;
    end if;
    -- 本人のデータ消去で actor が消えたときの set null も通す
    if new.actor_member_id is null and old.actor_member_id is not null
       and new.reason = old.reason and new.target_name = old.target_name then
      return new;
    end if;
    raise exception '内部の確認の履歴は書き換えられません';
  end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.member_deletion', true), '') = 'on' then
      return old;
    end if;
    raise exception '内部の確認の履歴は消せません';
  end if;
  return null;
end $$;

create trigger access_log_protect
  before update or delete on public.access_log
  for each row execute function public.protect_access_log();

-- ============ 権限の判定に使う関数 ============
create function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members where auth_user_id = auth.uid() and status = 'active'
$$;

create function public.am_operator() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_operator from public.members where auth_user_id = auth.uid() and status = 'active'), false)
$$;

create function public.am_representative() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_representative from public.members where auth_user_id = auth.uid() and status = 'active'), false)
$$;

-- ログインした人を、メールアドレスでメンバーに結びつける
create function public.link_me() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  mid uuid;
begin
  if auth.uid() is null or mail = '' then return null; end if;
  update public.members set auth_user_id = auth.uid()
   where email = mail and auth_user_id is null and status = 'active';
  select id into mid from public.members where auth_user_id = auth.uid() and status = 'active';
  return mid;
end $$;

create function public.give_consent() returns void
language sql security definer set search_path = public as $$
  update public.members set consent_at = now()
   where auth_user_id = auth.uid() and status = 'active' and consent_at is null
$$;

-- 確認依頼のメンション用（名前だけ）
create function public.list_directory() returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select m.id, m.name from public.members m
   where m.status = 'active' and public.my_member_id() is not null
   order by m.name
$$;

-- 本人のデータ消去（代表の承認後に Edge Function から呼ぶ）
create function public.execute_member_deletion(req uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.deletion_requests;
begin
  select * into r from public.deletion_requests where id = req for update;
  if r.id is null or r.approved_at is null or r.executed_at is not null or r.member_id is null then
    raise exception '消去できる状態ではありません';
  end if;
  perform set_config('app.member_deletion', 'on', true);
  update public.deletion_requests set executed_at = now() where id = req;
  delete from public.members where id = r.member_id;
end $$;

revoke all on function public.execute_member_deletion(uuid) from public, anon, authenticated;

-- ============ 行ごとの権限（RLS） ============
alter table public.members           enable row level security;
alter table public.questions         enable row level security;
alter table public.question_days     enable row level security;
alter table public.daily_reports     enable row level security;
alter table public.review_requests   enable row level security;
alter table public.stress_days       enable row level security;
alter table public.baselines         enable row level security;
alter table public.stages            enable row level security;
alter table public.rests             enable row level security;
alter table public.reassignments     enable row level security;
alter table public.contact_messages  enable row level security;
alter table public.access_log        enable row level security;
alter table public.deletion_requests enable row level security;
alter table public.notifications_log enable row level security;
alter table public.settings          enable row level security;

-- メンバー：自分の行。運用者と代表は全員分（名前・メール・在籍状態の管理のため）
create policy members_read on public.members for select to authenticated
  using (auth_user_id = auth.uid() or public.am_operator() or public.am_representative());

create policy questions_read on public.questions for select to authenticated using (true);
create policy question_days_read on public.question_days for select to authenticated using (true);

-- 日報：本人だけ（書き込みは Edge Function から）
create policy reports_read_own on public.daily_reports for select to authenticated
  using (member_id = public.my_member_id());

create policy reviews_read on public.review_requests for select to authenticated
  using (from_member_id = public.my_member_id() or to_member_id = public.my_member_id());

-- stress_days・baselines・contact_messages・notifications_log：画面からは読めない（ポリシーなし）

-- 段階：本人。運用者は「危険」以上の行だけ
create policy stages_read_own on public.stages for select to authenticated
  using (member_id = public.my_member_id());
create policy stages_read_danger on public.stages for select to authenticated
  using (public.am_operator() and stage >= 3);

create policy rests_read on public.rests for select to authenticated
  using (member_id = public.my_member_id() or public.am_operator());

create policy reassign_read on public.reassignments for select to authenticated
  using (public.am_operator() or public.am_representative());

-- 内部の確認の履歴：自分が確認された分。運用者と代表は全部
create policy access_log_read on public.access_log for select to authenticated
  using (target_member_id = public.my_member_id() or public.am_operator() or public.am_representative());

create policy deletion_read on public.deletion_requests for select to authenticated
  using (public.am_operator() or public.am_representative());

create policy settings_read on public.settings for select to authenticated using (true);

-- 画面（authenticated）から書き込める表はない。書き込みはすべて Edge Function（service role）経由。
revoke insert, update, delete on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ============ 初期設定（仮の値。あとから update で変更できる） ============
insert into public.settings (key, value) values
  ('borders',               '[0.40, 0.55, 0.70, 0.85]'),
  ('raise_daily_margin',    '0.20'),   -- 3日連続で B+20ポイント以上
  ('raise_daily_days',      '3'),
  ('raise_trend_days',      '5'),      -- 5日続けて R が上がる
  ('raise_trend_total',     '0.10'),   -- 5日間で合計10ポイント以上
  ('sleep_bonus',           '0.10'),   -- 睡眠の加点
  ('sleep_window_days',     '10'),
  ('sleep_limit_hours',     '50'),
  ('sleep_min_entries',     '7'),
  ('baseline_days',         '22'),
  ('baseline_high',         '0.55'),
  ('min_days_for_stage',    '3'),
  ('operator_notify_days',  '2'),      -- 危険以上が2日続いたら運用者へ（案）
  ('retention_months',      '6'),
  ('retired_remind_days',   '30'),
  ('season_months',         '[1, 5, 9]');

grant execute on function public.execute_member_deletion(uuid) to service_role;
