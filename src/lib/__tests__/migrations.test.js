import { describe, it, expect } from "vitest";
import { migrate, emptyDb, makeCollection, SCHEMA_VERSION, DEFAULT_COLLECTION } from "../migrations.js";
import { rate } from "../scheduler.js";
import { exportDb, importDb } from "../storage.js";
import { deriveStats } from "../stats.js";

const T0 = 1_700_000_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// 旧バージョンの実データ相当(seedCards.jsが作っていた形)
const v1 = {
  version: 1,
  cards: [
    {
      id: "seed-0",
      hint: "通常は・たいてい",
      pre: "We ",
      answer: "typically",
      post: " post a new build every other month.",
      note: "usuallyのフォーマル版",
      src: "TD UserGuide",
      createdAt: T0 - 86400000,
      state: { reps: 3, interval: 8, ease: 2.3, due: T0 + 86400000 },
    },
    {
      id: "seed-1",
      hint: "頻繁に",
      pre: "There are ",
      answer: "frequently",
      post: " new features added.",
      note: "",
      src: "",
      createdAt: T0 - 86400000,
      state: { reps: 0, interval: 0, ease: 2.5, due: T0 },
    },
  ],
  stats: { totalReviews: 42, totalCorrect: 30, bestCombo: 7, lastReviewDay: "2026-8-15", streak: 3 },
};

describe("migrate — v1 から最新版への移行", () => {
  it("**次に出る日(due)が1日たりとも動かない**", () => {
    // ここがFSRS移行で最も守るべき点。学習の予定を勝手にずらさない
    const db = migrate(structuredClone(v1), T0);
    expect(db.version).toBe(SCHEMA_VERSION);
    expect(db.cards).toHaveLength(2);
    expect(db.cards[0].state.due).toBe(T0 + 86400000);
    expect(db.cards[1].state.due).toBe(T0);
  });

  it("復習回数と失敗回数が引き継がれる", () => {
    const db = migrate(structuredClone(v1), T0);
    expect(db.cards[0].state.reps).toBe(3);
    expect(db.cards[1].state.reps).toBe(0);
  });

  it("SM-2のinterval/easeがFSRSのstability/difficultyに写る", () => {
    const db = migrate(structuredClone(v1), T0);
    const s = db.cards[0].state;
    expect(s.stability).toBeGreaterThan(0);
    expect(s.difficulty).toBeGreaterThanOrEqual(1);
    expect(s.difficulty).toBeLessThanOrEqual(10);
    expect(s.scheduledDays).toBe(8);
    expect(s.fsrsState).toBe(2); // Review
    // easeが下がっていたカードほど難しく評価される
    expect(s.difficulty).toBeGreaterThan(5);
  });

  it("一度も触っていないカードは新規のまま(FSRSのNew)", () => {
    const db = migrate(structuredClone(v1), T0);
    expect(db.cards[1].state.fsrsState).toBe(0);
    expect(db.cards[1].state.stability).toBe(0);
  });

  it("移行後もそのままFSRSで評価を続けられる", () => {
    const db = migrate(structuredClone(v1), T0);
    const next = rate(db.cards[0].state, true, T0 + 86400000);
    expect(next.reps).toBe(4);
    expect(next.due).toBeGreaterThan(T0 + 86400000);
  });

  it("カードの中身(ヒント・英文・メモ・出典)が保たれる", () => {
    const db = migrate(structuredClone(v1), T0);
    expect(db.cards[0]).toMatchObject({
      hint: "通常は・たいてい",
      pre: "We ",
      answer: "typically",
      post: " post a new build every other month.",
      note: "usuallyのフォーマル版",
      src: "TD UserGuide",
    });
  });

  it("統計が保たれる — 累積値から導出へ移っても数字は変わらない", () => {
    const db = migrate(structuredClone(v1), T0);
    expect(deriveStats(db.reviewLog, db.statsBase)).toEqual(v1.stats);
  });

  it("固定IDがUUIDに採番し直される(2端末での衝突を防ぐ)", () => {
    const db = migrate(structuredClone(v1), T0);
    for (const c of db.cards) {
      expect(c.id).toMatch(UUID_RE);
      expect(c.id).not.toMatch(/^seed-/);
    }
    expect(new Set(db.cards.map((c) => c.id)).size).toBe(2);
  });

  it("2台の端末が同じv1データから独立に移行してもIDが衝突しない", () => {
    const deviceA = migrate(structuredClone(v1), T0);
    const deviceB = migrate(structuredClone(v1), T0);
    const idsA = new Set(deviceA.cards.map((c) => c.id));
    expect(deviceB.cards.some((c) => idsA.has(c.id))).toBe(false);
  });

  it("同期メタ(updatedAt / deletedAt)が付与される", () => {
    const db = migrate(structuredClone(v1), T0);
    for (const c of db.cards) {
      expect(typeof c.updatedAt).toBe("number");
      expect(c.deletedAt).toBeNull();
    }
  });

  it("state に lapses と lastReview が入る", () => {
    const db = migrate(structuredClone(v1), T0);
    expect(db.cards[0].state.lapses).toBe(0);
    expect(db.cards[0].state.lastReview).toBeNull();
  });

  it("既存カードが既定のコレクションに入る", () => {
    const db = migrate(structuredClone(v1), T0);
    expect(db.collections).toHaveLength(1);
    expect(db.collections[0].name).toBe(DEFAULT_COLLECTION.name);
    expect(db.collections[0].promptLabel).toBe(DEFAULT_COLLECTION.promptLabel);
    expect(db.activeCollectionId).toBe(db.collections[0].id);
    for (const c of db.cards) expect(c.collectionId).toBe(db.collections[0].id);
  });

  it("復習ログの入れ物ができる", () => {
    expect(migrate(structuredClone(v1), T0).reviewLog).toEqual([]);
  });
});

describe("migrate — 壊れた入力への耐性", () => {
  it("null / undefined でも空のDBを返す", () => {
    expect(migrate(null, T0).version).toBe(SCHEMA_VERSION);
    expect(migrate(undefined, T0).cards).toEqual([]);
  });

  it("cards が配列でなくてもクラッシュしない", () => {
    expect(migrate({ version: 3, cards: "こわれている" }, T0).cards).toEqual([]);
    expect(migrate({ version: 2, cards: "こわれている" }, T0).cards).toEqual([]);
  });

  it("collections が空でも既定のコレクションが補われる", () => {
    const db = migrate({ version: 3, collections: [], cards: [] }, T0);
    expect(db.collections).toHaveLength(1);
    expect(db.activeCollectionId).toBe(db.collections[0].id);
  });

  it("activeCollectionId が存在しないIDを指していても直る", () => {
    const col = makeCollection(DEFAULT_COLLECTION, T0);
    const db = migrate({ version: 3, collections: [col], activeCollectionId: "存在しない", cards: [] }, T0);
    expect(db.activeCollectionId).toBe(col.id);
  });

  it("collectionId を持たないカードはアクティブなコレクションに寄せる", () => {
    const col = makeCollection(DEFAULT_COLLECTION, T0);
    const db = migrate(
      { version: 3, collections: [col], activeCollectionId: col.id, cards: [{ id: "x", state: {} }] },
      T0
    );
    expect(db.cards[0].collectionId).toBe(col.id);
  });

  it("未知の未来バージョンは壊さずそのまま扱う", () => {
    const future = { version: 99, cards: [], collections: [], reviewLog: [] };
    expect(migrate(future, T0).version).toBe(99);
  });

  it("移行を二度かけても結果が変わらない(冪等)", () => {
    const once = migrate(structuredClone(v1), T0);
    const twice = migrate(structuredClone(once), T0);
    expect(twice).toEqual(once);
  });
});

describe("エクスポート / インポート", () => {
  it("書き出したJSONを読み戻すと完全に一致する", () => {
    const db = migrate(structuredClone(v1), T0);
    const restored = importDb(exportDb(db), T0);
    expect(restored).toEqual(db);
  });

  it("空のDBでも往復できる", () => {
    const db = emptyDb(T0);
    expect(importDb(exportDb(db), T0)).toEqual(db);
  });

  it("v1形式のJSONを直接インポートしても移行される", () => {
    const restored = importDb(JSON.stringify(v1), T0);
    expect(restored.version).toBe(SCHEMA_VERSION);
    expect(restored.cards).toHaveLength(2);
    expect(deriveStats(restored.reviewLog, restored.statsBase).totalReviews).toBe(42);
  });

  it("JSONとして不正なら例外を投げる", () => {
    expect(() => importDb("{こわれている", T0)).toThrow();
  });
});
