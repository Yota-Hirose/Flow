// ------------------------------------------------------------------
// 同期エンジン。バックエンドを知らない。
//
// **原則6(ローカルファースト)がここの設計を全部決めている。**
// 「レビュー中にネットワークを待つ実装は、理由を問わず却下する」。
// したがって:
//   - 同期は必ず非同期・投げっぱなし。await して画面を止めない
//   - 失敗しても学習は続く。ローカルが常に正で、同期は後追い
//   - オフラインは異常ではなく通常の状態のひとつ。エラーを出さない
//
// アダプタが満たすべき契約(これだけ):
//   pull()            → { db, rev } | null      未保存なら null
//   push(db, { rev }) → { rev }                 revが古ければ CONFLICT を投げる
//   revは「サーバ側の版」。楽観ロックに使う。中身は問わない(タイムスタンプでも
//   ハッシュでもよい)。Supabase実装では updated_at を使う。
//
// この分離のおかげで、Supabaseのプロジェクトが無くてもエンジン全体を
// インメモリのニセアダプタでテストできる。
// ------------------------------------------------------------------

import { mergeDb, rebuildMerged, changedCardsBetween, stableStringify } from "./merge.js";

export const CONFLICT = "conflict";
export const MAX_CONFLICT_RETRY = 3;

export const Status = {
  OFF: "off",           // 未ログイン。同期していない(異常ではない)
  IDLE: "idle",         // ログイン済み・待機
  SYNCING: "syncing",
  SYNCED: "synced",
  OFFLINE: "offline",   // 圏外。溜めて後で送る
  ERROR: "error",
};

export function conflictError() {
  const e = new Error("remote revision changed");
  e.code = CONFLICT;
  return e;
}

export function isConflict(e) {
  return e?.code === CONFLICT;
}

// ------------------------------------------------------------------
// 1回ぶんの同期。純粋に近い形にしてある(副作用はアダプタ呼び出しだけ)
// ------------------------------------------------------------------

export async function syncOnce({ adapter, local, rev = null, now = Date.now() }) {
  let attempt = 0;
  let baseRev = rev;

  while (attempt <= MAX_CONFLICT_RETRY) {
    const remote = await adapter.pull();
    const merged = mergeDb(local, remote?.db ?? null, now);

    // 合流でログが増えたカードだけ、ログから状態を作り直す。
    // これをやらないと「端末Aの3回」と「端末Bの2回」が合算されない
    const changed = changedCardsBetween(local.reviewLog ?? [], merged.reviewLog);
    const next = changed.size > 0 ? rebuildMerged(merged, changed) : merged;

    // 送る必要が無ければ送らない。無料枠のうちは通信量がそのまま原価になる
    const remoteRev = remote?.rev ?? baseRev;
    if (remote && sameContent(next, remote.db)) {
      return { db: next, rev: remoteRev, pushed: false };
    }

    try {
      const res = await adapter.push(next, { rev: remoteRev });
      return { db: next, rev: res?.rev ?? remoteRev, pushed: true };
    } catch (e) {
      // 別の端末が先に書いた。もう一度 pull して畳み直す。
      // 追記専用ログなので、やり直しても学習実績は失われない
      if (!isConflict(e) || attempt === MAX_CONFLICT_RETRY) throw e;
      attempt += 1;
      baseRev = null;
    }
  }
  throw conflictError();
}

// 同期対象だけを比べる。activeCollectionId は端末ごとの状態なので除く
export function sameContent(a, b) {
  return syncFingerprint(a) === syncFingerprint(b);
}

export function syncFingerprint(db) {
  if (!db) return "";
  return stableStringify({
    collections: db.collections,
    cards: db.cards,
    reviewLog: db.reviewLog,
    statsBase: db.statsBase,
    settings: db.settings,
    settingsUpdatedAt: db.settingsUpdatedAt,
  });
}

// ------------------------------------------------------------------
// スケジューラ。まとめて遅らせて、まとめて送る。
//
// 1枚評価するたびにDB全体を送ると、10枚のセットで10回書き込みになる。
// 通信量も費用も無駄で、電池も食う。セットが終わってから送れば1回で済む。
// ------------------------------------------------------------------

export const DEBOUNCE_MS = 8000;

export function createSyncEngine({
  adapter,
  getDb,
  onDb,
  onStatus = () => {},
  debounceMs = DEBOUNCE_MS,
  now = () => Date.now(),
} = {}) {
  let rev = null;
  let timer = null;
  let running = false;
  let queued = false;
  let status = Status.OFF;
  let lastSyncedAt = null;
  let lastError = null;

  function setStatus(s, err = null) {
    status = s;
    lastError = err;
    onStatus({ status: s, lastSyncedAt, error: err });
  }

  function online() {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  }

  async function run() {
    if (!adapter?.isSignedIn?.()) {
      setStatus(Status.OFF);
      return;
    }
    if (running) {
      queued = true;
      return;
    }
    if (!online()) {
      setStatus(Status.OFFLINE);
      return; // オンラインに戻ったら request() が呼ばれる
    }

    running = true;
    setStatus(Status.SYNCING);
    try {
      const res = await syncOnce({ adapter, local: getDb(), rev, now: now() });
      rev = res.rev;
      lastSyncedAt = now();
      // 合流結果を戻す。ローカルにしか無かった編集も残っている
      onDb?.(res.db);
      setStatus(Status.SYNCED);
    } catch (e) {
      setStatus(online() ? Status.ERROR : Status.OFFLINE, e);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, debounceMs);
  }

  return {
    // 変更があったので、そのうち送る(すぐには送らない)
    request() {
      if (!adapter?.isSignedIn?.()) return setStatus(Status.OFF);
      schedule();
    },
    // 今すぐ送る。ログイン直後・アプリを閉じる直前など
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return run();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    reset() {
      rev = null;
      lastSyncedAt = null;
      setStatus(Status.OFF);
    },
    get state() {
      return { status, lastSyncedAt, error: lastError };
    },
  };
}
