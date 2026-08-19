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
//
// v2 → v3:
//   - スケジューラを自前のSM-2から FSRS へ差し替え(T-08)。カードの state を
//     FSRS の形(stability / difficulty / fsrsState …)に変換する。
//     **due は1日たりとも動かさない。** 学習の予定を勝手にずらさないため。
//
// v4 → v5(同期の実地で判明した設計ミス / D-18):
//   - 既定のコレクションのIDを**全端末共通の固定値**にする。
//     端末ごとにUUIDで作っていたため、PCとスマホで「英語」が2つできて
//     しまい、同期しているのに別プールに見えていた。「開いているデッキは
//     端末ごと」の判断自体は正しいが、**既定のデッキだけは同じIDでないと
//     成り立たない。**
//   - シードカードも固定IDにする。中身が同じカードが端末ごとに別IDで
//     生まれると、同期のたびに10枚ずつ増える。
//
// v3 → v4(同期の前提 / T-21):
//   - 累積 stats を廃止し、復習ログからの導出に変える。累積値は2端末で
//     マージできない(足すと二重、maxを取ると片方が消える)。ログに残って
//     いない過去だけを statsBase として繰り越す。詳細は stats.js。
//   - settingsUpdatedAt を追加。設定はログではないので、新旧の判定に
//     タイムスタンプが要る。
// ------------------------------------------------------------------

import { uuid } from "./id.js";
import { normalizeSettings, defaultSettings } from "./settings.js";
import { emptyStats, emptyBase, baseFromLegacyStats } from "./stats.js";
import { fromSm2 } from "./fsrs.js";

export const SCHEMA_VERSION = 5;

export { emptyStats, emptyBase };

// **全端末で共通の固定ID。UUIDにしてはいけない。**
// 端末ごとに採番すると、同じ「英語」が2つできて別プールになる(D-18)。
// ユーザーが自分で作るコレクションは従来どおりUUID。
export const DEFAULT_COLLECTION_ID = "col-default";

export const DEFAULT_COLLECTION = {
  id: DEFAULT_COLLECTION_ID,
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
    // 統計はログから導出する。ここにあるのは「ログに残っていない過去」だけ
    statsBase: emptyBase(),
    settings: defaultSettings(),
    settingsUpdatedAt: 0,
  };
}

export function makeCollection({ name, promptLabel, id }, now = Date.now()) {
  return {
    id: id ?? uuid(),
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
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: migrateV4toV5,
};

// 既定のコレクションを共通IDへ寄せる。
//
// **コレクションが1つしかないときだけ実行する。** 2つ以上ある端末は、
// 既に同期して他端末のデッキを受け取っているか、自分で作っている。
// そこで機械的に寄せると、別物どうしを勝手に混ぜかねない。
// 既に割れてしまった端末は、設定の「統合」で人が選ぶ(原則4: 判断を減らす
// のは日々の操作であって、こういう一度きりの後始末は明示的でよい)。
function migrateV4toV5(v4) {
  const cols = Array.isArray(v4.collections) ? v4.collections : [];
  if (cols.length !== 1 || cols[0]?.id === DEFAULT_COLLECTION_ID) return { ...v4, version: 5 };

  const oldId = cols[0].id;
  return {
    ...v4,
    version: 5,
    collections: [{ ...cols[0], id: DEFAULT_COLLECTION_ID }],
    activeCollectionId: v4.activeCollectionId === oldId ? DEFAULT_COLLECTION_ID : v4.activeCollectionId,
    cards: (Array.isArray(v4.cards) ? v4.cards : []).map((c) =>
      c.collectionId === oldId ? { ...c, collectionId: DEFAULT_COLLECTION_ID } : c
    ),
  };
}

// 2つのコレクションを1つにまとめる。同期前に別々のIDで既定デッキが
// できてしまった端末の後始末(D-18)と、単純な整理の両方に使う。
// カードは移すだけで消さない。空になった側は tombstone にして同期で伝える。
export function mergeCollections(db, fromId, toId, now = Date.now()) {
  if (fromId === toId) return db;
  if (!db.collections.some((c) => c.id === toId)) return db;
  return {
    ...db,
    cards: db.cards.map((c) => (c.collectionId === fromId ? { ...c, collectionId: toId, updatedAt: now } : c)),
    collections: db.collections.map((c) => (c.id === fromId ? { ...c, deletedAt: now, updatedAt: now } : c)),
    activeCollectionId: db.activeCollectionId === fromId ? toId : db.activeCollectionId,
  };
}

// 累積statsを繰り越しへ。移行の前後で画面の数字が1も変わらないこと(テスト済み)
function migrateV3toV4(v3) {
  const { stats, ...rest } = v3;
  return {
    ...rest,
    version: 4,
    statsBase: baseFromLegacyStats(stats, Array.isArray(v3.reviewLog) ? v3.reviewLog : []),
    settingsUpdatedAt: v3.settingsUpdatedAt ?? 0,
  };
}

// SM-2 の state を FSRS の state へ。次に出る日は変えない(詳細は fsrs.js)
function migrateV2toV3(v2, now) {
  return {
    ...v2,
    version: 3,
    cards: (Array.isArray(v2.cards) ? v2.cards : []).map((c) => ({ ...c, state: fromSm2(c.state, now) })),
  };
}

function migrateV1toV2(v1, now) {
  const collection = makeCollection(DEFAULT_COLLECTION, now);
  const cards = (Array.isArray(v1.cards) ? v1.cards : []).map((c) => ({
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
      // 休眠(T-15)。stateではなくカード側に持つ — rebuildStateがstateを
      // 作り直しても休眠状態が消えないようにするため
      dormantSince: c.dormantSince ?? null,
      // リーチ提案を「そのまま」で見送った期限(T-09)
      leechSnoozedUntil: c.leechSnoozedUntil ?? null,
      state: { lapses: 0, lastReview: null, ...c.state },
    })),
    reviewLog: Array.isArray(db.reviewLog) ? db.reviewLog : [],
    statsBase: { ...emptyBase(), ...(db.statsBase && typeof db.statsBase === "object" ? db.statsBase : null) },
    settings: normalizeSettings(db.settings),
    settingsUpdatedAt: Number.isFinite(db.settingsUpdatedAt) ? db.settingsUpdatedAt : 0,
  };
}
