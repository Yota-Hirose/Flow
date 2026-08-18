// ------------------------------------------------------------------
// Supabase アダプタ。engine.js の契約(pull / push / isSignedIn)を満たす。
//
// **テーブルを2つに割っている理由 — 費用そのもの。**
// DB全体を毎回やり取りすると、復習ログが2万件たまった人で1回あたり数MB。
// 1日数回 × 数千人で、無料枠どころか有料枠も飛ぶ(COST_ESTIMATE.md)。
//
//   flow_docs    … カード・コレクション・設定・繰り越し統計。JSONB 1行。
//                  変わったときだけ書く(カードは毎日は増えない)。
//   flow_reviews … 復習ログ。追記専用なので **差分だけ** でやり取りできる。
//                  取得は「前回より後のぶん」、送信は「サーバがまだ知らないぶん」。
//
// 部分的なログを返しても正しく動くのは、マージが和集合だから(merge.js)。
// ローカルには古いぶんが残っているので、新しいぶんだけ足せば揃う。
// **追記専用ログという設計が、そのまま通信量の削減になっている。**
//
// 認証はマジックリンク。パスワードを持たない = 漏らすものが無い。
// ------------------------------------------------------------------

import { syncFingerprint } from "./engine.js";
import { migrate } from "../migrations.js";

const URL = import.meta.env?.VITE_SUPABASE_URL ?? "";

// Supabaseは2026年末に anon キーを廃止し、publishable キー(sb_publishable_...)へ
// 移行する。どちらも「ブラウザに配ってよい公開鍵」で、渡す場所も同じなので、
// 両方の名前を受ける。新規は publishable を使う。
const KEY =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env?.VITE_SUPABASE_ANON_KEY ??
  "";

// 未設定でもアプリは動く。同期が無効になるだけ(原則6: ローカルが常に正)
export function isSyncConfigured() {
  return Boolean(URL && KEY);
}

// **遅延読み込み。** supabase-js は gzip で約140KB あり、同期を使わない人に
// まで最初の1枚が出るまでの時間を払わせる理由がない(原則6: ローカルが主)。
// 設定画面を開くかログイン済みのときだけ取りに行く。
// 既にログインしている痕跡があるか。無ければ supabase-js を読みに行かない。
// これを見ずに毎回 getSession() すると、遅延読み込みの意味が消える。
export function hasStoredSession() {
  try {
    if (typeof localStorage === "undefined") return false;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) return true;
    }
  } catch {
    return false;
  }
  return false;
}

// マジックリンクから戻ってきた直後。URLに認証情報が載っている
export function hasAuthCallback() {
  if (typeof location === "undefined") return false;
  const h = location.hash ?? "";
  return h.includes("access_token=") || h.includes("error_code=") || location.search.includes("code=");
}

// 起動時点で認証まわりを立ち上げるべきか
export function shouldInitAuth() {
  return isSyncConfigured() && (hasStoredSession() || hasAuthCallback());
}

let client = null;
let loading = null;

export async function getClient() {
  if (!isSyncConfigured()) return null;
  if (client) return client;
  if (!loading) {
    loading = import("@supabase/supabase-js").then(({ createClient }) => {
      client = createClient(URL, KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      return client;
    });
  }
  return loading;
}

// ------------------------------------------------------------------
// 認証
// ------------------------------------------------------------------

export async function sendMagicLink(email) {
  const c = await getClient();
  if (!c) throw new Error("同期が設定されていません");
  const { error } = await c.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: typeof location !== "undefined" ? location.origin : undefined },
  });
  if (error) throw error;
}

export async function signOut() {
  const c = await getClient();
  await c?.auth.signOut();
}

export async function getSession() {
  const c = await getClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data?.session ?? null;
}

export function onAuthChange(fn) {
  let sub = null;
  let cancelled = false;
  getClient().then((c) => {
    if (!c || cancelled) return;
    sub = c.auth.onAuthStateChange((_e, session) => fn(session)).data?.subscription;
  });
  return () => {
    cancelled = true;
    sub?.unsubscribe();
  };
}

// ------------------------------------------------------------------
// アダプタ
// ------------------------------------------------------------------

const DOC_TABLE = "flow_docs";
const REVIEW_TABLE = "flow_reviews";

export function createSupabaseAdapter({ getSessionSync } = {}) {
  // サーバが持っていると分かっているエントリID。差分送信の判断に使う
  const known = new Set();
  let cursor = 0;        // ここまでのログは取得済み(ms)
  let docFingerprint = null;
  let docRev = null;

  function uid() {
    const s = getSessionSync?.();
    return s?.user?.id ?? null;
  }

  return {
    isSignedIn: () => Boolean(isSyncConfigured() && uid()),

    // ログアウト時に呼ぶ。別アカウントのカーソルを引きずらない
    reset() {
      known.clear();
      cursor = 0;
      docFingerprint = null;
      docRev = null;
    },

    async pull() {
      const userId = uid();
      if (!userId) return null;
      const c = await getClient();

      const { data: docRow, error: docErr } = await c
        .from(DOC_TABLE)
        .select("doc, rev")
        .eq("user_id", userId)
        .maybeSingle();
      if (docErr) throw docErr;

      // 前回より後のログだけ。ここが通信量の効くところ
      const { data: rows, error: revErr } = await c
        .from(REVIEW_TABLE)
        .select("id, card_id, ts, good, interval_before")
        .eq("user_id", userId)
        .gt("ts", cursor)
        .order("ts", { ascending: true });
      if (revErr) throw revErr;

      const reviewLog = (rows ?? []).map(fromRow);
      for (const e of reviewLog) {
        known.add(e.id);
        if (e.ts > cursor) cursor = e.ts;
      }

      if (!docRow) return reviewLog.length ? { db: migrate({ reviewLog }), rev: null } : null;

      docRev = docRow.rev;
      const db = migrate({ ...docRow.doc, reviewLog });
      docFingerprint = docOf(db);
      return { db, rev: docRow.rev };
    },

    async push(db, { rev } = {}) {
      const userId = uid();
      if (!userId) throw new Error("未ログイン");
      const c = await getClient();

      // 1) 新しいログだけ挿入。主キー衝突は無視 = 再送しても増えない
      const fresh = (db.reviewLog ?? []).filter((e) => !known.has(e.id));
      if (fresh.length > 0) {
        // 一度に送りすぎない。初回同期で2万件あっても分割して通る
        for (let i = 0; i < fresh.length; i += 500) {
          const chunk = fresh.slice(i, i + 500);
          const { error } = await c
            .from(REVIEW_TABLE)
            .upsert(chunk.map((e) => toRow(e, userId)), { onConflict: "id", ignoreDuplicates: true });
          if (error) throw error;
        }
        for (const e of fresh) {
          known.add(e.id);
          if (e.ts > cursor) cursor = e.ts;
        }
      }

      // 2) カード・設定は変わったときだけ書く
      const fingerprint = docOf(db);
      if (fingerprint === docFingerprint) return { rev: rev ?? docRev };

      const nextRev = (Number(rev ?? docRev ?? 0) || 0) + 1;
      const { data, error } = await c
        .from(DOC_TABLE)
        .upsert(
          { user_id: userId, doc: stripLog(db), rev: nextRev, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        )
        .select("rev")
        .maybeSingle();
      if (error) throw error;

      docFingerprint = fingerprint;
      docRev = data?.rev ?? nextRev;
      return { rev: docRev };
    },
  };
}

// ログを除いた本体。ログは別テーブルなのでJSONBに入れない
function stripLog(db) {
  const { reviewLog: _log, activeCollectionId: _active, ...rest } = db;
  return rest; // 開いているデッキは端末ごとの状態なので送らない(merge.js)
}

function docOf(db) {
  return syncFingerprint({ ...db, reviewLog: [] });
}

function toRow(e, userId) {
  return { id: e.id, user_id: userId, card_id: e.cardId, ts: e.ts, good: e.good, interval_before: e.intervalBefore ?? 0 };
}

function fromRow(r) {
  return { id: r.id, cardId: r.card_id, ts: Number(r.ts), good: r.good, intervalBefore: r.interval_before ?? 0 };
}
