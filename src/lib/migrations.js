// ------------------------------------------------------------------
// スキーマのバージョン管理とマイグレーション。
//
// これが無い状態でカード構造を変えると、ドッグフーディングで貯めた実学習
// 履歴(SPEC §9 の30日連続KPIの根拠そのもの)が壊れる。復旧手段も無かった。
//
// バージョンを上げる基準: **既存データの変換が要るときだけ**。
// 既定値を入れれば済む純粋な追加(例: settings)は normalize() が吸収するので
// 段を増やさない。逆に、意味の変わるフィールド改名・型変更・分解は必ず1段追加する。
//
// v1 → v2 で入れたもの:
//   - カードIDのUUID化(端末間の衝突防止 / T-21の前提)
//   - updatedAt(2端末の編集の新旧判定)
//   - deletedAt によるソフト削除(削除の同期。無いと端末Aの削除が端末Bで復活する)
//   - コレクション(分類軸。多用途化 / §4-7)
//   - 復習ログ(FSRS移行の原資 / 同期の衝突解決 / リーチカード検出)
//   - state に lapses と lastReview
// ------------------------------------------------------------------

import { uuid } from "./id.js";
import { normalizeSettings, defaultSettings } from "./settings.js";

export const SCHEMA_VERSION = 2;

export const DEFAULT_COLLECTION = {
  name: "英語",
  promptLabel: "英語で言うと?",
};

export function emptyDb(now = Date.now()) {
  const collection = makeCollection(DEFAULT_COLLECTION, now);
  return {
    version: SCHEMA_VERSION,
    collections: [collection],
    activeCollectionId: collection.id,
    cards: [],
    reviewLog: [],
    stats: emptyStats(),
    settings: defaultSettings(),
  };
}

export function emptyStats() {
  return { totalReviews: 0, totalCorrect: 0, bestCombo: 0, lastReviewDay: null, streak: 0 };
}

export function makeCollection({ name, promptLabel }, now = Date.now()) {
  return {
    id: uuid(),
    name,
    promptLabel: promptLabel || DEFAULT_COLLECTION.promptLabel,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

// 版を判定して最新まで順に上げる。未知の未来バージョンはそのまま返す
// (新しい端末で作ったデータを古いアプリが壊さないように)。
export function migrate(data, now = Date.now()) {
  if (!data || typeof data !== "object") return emptyDb(now);
  let db = data;
  let guard = 0;
  while ((db.version ?? 1) < SCHEMA_VERSION && guard++ < 20) {
    const from = db.version ?? 1;
    const step = STEPS[from];
    if (!step) break;
    db = step(db, now);
  }
  return normalize(db, now);
}

const STEPS = {
  1: migrateV1toV2,
};

function migrateV1toV2(v1, now) {
  const collection = makeCollection(DEFAULT_COLLECTION, now);
  const cards = (v1.cards ?? []).map((c) => ({
    id: uuid(), // 旧IDは `seed-0` 等で端末間衝突するため必ず採番し直す
    collectionId: collection.id,
    hint: c.hint ?? "",
    pre: c.pre ?? "",
    answer: c.answer ?? "",
    post: c.post ?? "",
    note: c.note ?? "",
    src: c.src ?? "",
    createdAt: c.createdAt ?? now,
    updatedAt: c.createdAt ?? now,
    deletedAt: null,
    state: {
      reps: c.state?.reps ?? 0,
      interval: c.state?.interval ?? 0,
      ease: c.state?.ease ?? 2.5,
      due: c.state?.due ?? now,
      // v1は失敗回数も最終復習時刻も保存していなかった。ここは復元不能なので
      // 0/null から始める(だからこそ、これ以降のログ蓄積に意味がある)。
      lapses: 0,
      lastReview: null,
    },
  }));

  return {
    version: 2,
    collections: [collection],
    activeCollectionId: collection.id,
    cards,
    reviewLog: [],
    stats: { ...emptyStats(), ...v1.stats },
    settings: defaultSettings(),
  };
}

// 壊れた/欠けたフィールドを埋めて、以降のコードが undefined を踏まないようにする。
function normalize(db, now) {
  const collections = Array.isArray(db.collections) && db.collections.length > 0
    ? db.collections
    : [makeCollection(DEFAULT_COLLECTION, now)];

  const alive = collections.filter((c) => !c.deletedAt);
  const activeCollectionId =
    alive.some((c) => c.id === db.activeCollectionId) ? db.activeCollectionId : (alive[0] ?? collections[0]).id;

  return {
    version: db.version ?? SCHEMA_VERSION,
    collections,
    activeCollectionId,
    cards: (Array.isArray(db.cards) ? db.cards : []).map((c) => ({
      ...c,
      collectionId: c.collectionId ?? activeCollectionId,
      updatedAt: c.updatedAt ?? c.createdAt ?? now,
      deletedAt: c.deletedAt ?? null,
      state: { lapses: 0, lastReview: null, ...c.state },
    })),
    reviewLog: Array.isArray(db.reviewLog) ? db.reviewLog : [],
    stats: { ...emptyStats(), ...db.stats },
    settings: normalizeSettings(db.settings),
  };
}
