// ------------------------------------------------------------------
// 永続化層。MVPはlocalStorage、復習ログが膨らむ頃にIndexedDBへ(T-18)。
//
// DB全体を1キーに入れている。カードとログと統計が別キーだと、書き込みが
// 途中で失敗したときに互いに矛盾した状態で残るため。
// ------------------------------------------------------------------

import { migrate, emptyDb, SCHEMA_VERSION } from "./migrations.js";

const DB_KEY = "flow.db";
const LEGACY_CARDS_KEY = "flow.cards.v1";
const LEGACY_STATS_KEY = "flow.stats.v1";

export { SCHEMA_VERSION };

function hasStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false; // プライベートブラウジング等でアクセス自体が例外になる場合
  }
}

// 保存済みのDBを読む。無ければ旧キー(v1)からの移行を試み、それも無ければ null。
// 破損していても例外は投げず null を返す(呼び出し側がシードで初期化できる)。
export function loadDb(now = Date.now()) {
  if (!hasStorage()) return null;

  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return migrate(JSON.parse(raw), now);
  } catch (e) {
    console.error("Failed to read flow.db — falling back", e);
  }

  try {
    const legacyCards = localStorage.getItem(LEGACY_CARDS_KEY);
    if (legacyCards) {
      const legacyStats = localStorage.getItem(LEGACY_STATS_KEY);
      const migrated = migrate(
        {
          version: 1,
          cards: JSON.parse(legacyCards),
          stats: legacyStats ? JSON.parse(legacyStats) : undefined,
        },
        now
      );
      saveDb(migrated); // 移行結果を書いておく。旧キーは復旧用に消さない
      return migrated;
    }
  } catch (e) {
    console.error("Failed to migrate legacy data", e);
  }

  return null;
}

export function saveDb(db) {
  if (!hasStorage()) return false;
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    // 容量超過。ログのリングバッファ(reviewLog.js)で予防しているが、
    // それでも溢れた場合はユーザーに気づかせる必要がある。
    console.error("Failed to save flow.db", e);
    return false;
  }
}

// ------------------------------------------------------------------
// バックアップ。同期(T-21)が動くまでは、これが唯一の端末間移行手段。
// ------------------------------------------------------------------

export function exportDb(db) {
  return JSON.stringify({ ...db, exportedAt: Date.now() }, null, 2);
}

// 取り込みは必ず migrate を通す。古い端末から書き出したJSONも読めるように。
export function importDb(json, now = Date.now()) {
  const parsed = JSON.parse(json);
  const db = migrate(parsed, now);
  if (!Array.isArray(db.cards)) throw new Error("cards が配列ではありません");
  return db;
}

export { emptyDb };
// 日付キーは統計側の関心事なので stats.js に移した。互換のため再輸出する。
export { dayKey } from "./stats.js";
