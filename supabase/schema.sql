-- ------------------------------------------------------------------
-- Flow 同期用スキーマ。Supabase の SQL Editor にそのまま貼って実行する。
-- 何度実行しても壊れない(IF NOT EXISTS / DROP POLICY IF EXISTS)。
--
-- 方針:
--   - 行レベルセキュリティ(RLS)を必ず有効にする。これを忘れると
--     anonキーを持つ誰もが他人のカードを読めてしまう。**最重要。**
--   - テーブルは2つ。カード等の本体(flow_docs)と、追記専用の復習ログ
--     (flow_reviews)。ログを分けるのは差分同期のため(src/lib/sync/supabase.js)。
-- ------------------------------------------------------------------

-- 本体: カード・コレクション・設定・繰り越し統計。1ユーザー1行。
create table if not exists public.flow_docs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  doc        jsonb       not null,
  rev        bigint      not null default 1,   -- 楽観ロック用。書くたびに増やす
  updated_at timestamptz not null default now()
);

-- 復習ログ: 追記専用。更新も削除もしない。
-- id はクライアントが採番したUUID。同じレビューを2回送っても増えない。
create table if not exists public.flow_reviews (
  id              uuid    primary key,
  user_id         uuid    not null references auth.users(id) on delete cascade,
  card_id         text    not null,
  ts              bigint  not null,            -- ミリ秒。差分取得のカーソル
  good            boolean not null,
  interval_before double precision not null default 0,
  created_at      timestamptz not null default now()
);

-- 「自分のログの、前回より後のぶん」を引くための索引。差分同期の要
create index if not exists flow_reviews_user_ts_idx
  on public.flow_reviews (user_id, ts);

-- ------------------------------------------------------------------
-- RLS。自分の行だけ読み書きできる。
-- ------------------------------------------------------------------

alter table public.flow_docs    enable row level security;
alter table public.flow_reviews enable row level security;

drop policy if exists flow_docs_own on public.flow_docs;
create policy flow_docs_own on public.flow_docs
  for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ログは読みと挿入だけ。更新・削除は許可しない = 追記専用をDBで担保する。
-- 端末の不具合やアプリのバグでも、過去の学習実績が書き換わらない。
drop policy if exists flow_reviews_select_own on public.flow_reviews;
create policy flow_reviews_select_own on public.flow_reviews
  for select using (auth.uid() = user_id);

drop policy if exists flow_reviews_insert_own on public.flow_reviews;
create policy flow_reviews_insert_own on public.flow_reviews
  for insert with check (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- 退会時の後始末。auth.users から消えれば on delete cascade で全部消える。
-- 「アカウントを消したらデータも消える」をDB側で保証しておく。
-- ------------------------------------------------------------------
