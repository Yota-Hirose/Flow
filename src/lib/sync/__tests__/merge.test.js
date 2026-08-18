import { describe, it, expect } from "vitest";
import { mergeDb, rebuildMerged, changedCardsBetween, pickNewer, stableStringify } from "../merge.js";
import { emptyDb, SCHEMA_VERSION } from "../../migrations.js";
import { makeCard } from "../../parser.js";
import { deriveStats } from "../../stats.js";
import { isDue } from "../../scheduler.js";

const T0 = new Date(2026, 7, 16, 12, 0, 0).getTime();
const MIN = 60_000;

function seedDb() {
  const db = emptyDb(T0);
  const col = db.activeCollectionId;
  return {
    ...db,
    cards: [
      makeCard({ hint: "資料", pre: "send the ", answer: "document", post: "." }, col, T0),
      makeCard({ hint: "頻繁に", pre: "used ", answer: "frequently", post: "." }, col, T0),
    ],
  };
}

const review = (id, cardId, ts, good) => ({ id, cardId, ts, good, intervalBefore: 0 });

// ------------------------------------------------------------------

describe("stableStringify — 引き分けの決着が端末に依らない", () => {
  it("キーの順序が違っても同じ文字列", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });
  it("入れ子でも順序に依らない", () => {
    expect(stableStringify({ x: { p: 1, q: 2 } })).toBe(stableStringify({ x: { q: 2, p: 1 } }));
  });
});

describe("pickNewer", () => {
  it("updatedAt の新しい方を採る", () => {
    expect(pickNewer({ id: "a", updatedAt: 1 }, { id: "a", updatedAt: 2 }).updatedAt).toBe(2);
  });
  it("同時刻でも必ず同じ側を採る — 役割で決めない", () => {
    const a = { id: "x", updatedAt: 5, hint: "A" };
    const b = { id: "x", updatedAt: 5, hint: "B" };
    expect(pickNewer(a, b)).toEqual(pickNewer(b, a));
  });
  it("片方が無ければもう片方", () => {
    expect(pickNewer(null, { id: "a" }).id).toBe("a");
    expect(pickNewer({ id: "a" }, null).id).toBe("a");
  });
});

// ------------------------------------------------------------------
// 満たすべき性質
// ------------------------------------------------------------------

describe("可換性 — どちらから畳んでも同じ結果になる", () => {
  it("編集が衝突しても収束する", () => {
    const base = seedDb();
    const id = base.cards[0].id;

    const a = { ...base, cards: base.cards.map((c) => (c.id === id ? { ...c, hint: "端末A", updatedAt: T0 + MIN } : c)) };
    const b = { ...base, cards: base.cards.map((c) => (c.id === id ? { ...c, hint: "端末B", updatedAt: T0 + 2 * MIN } : c)) };

    const ab = mergeDb(a, b, T0);
    const ba = mergeDb(b, a, T0);
    expect(ab.cards).toEqual(ba.cards);
    expect(ab.cards.find((c) => c.id === id).hint).toBe("端末B"); // 新しい方
  });

  it("同時刻の衝突でも収束する — ここが崩れると永久に一致しない", () => {
    const base = seedDb();
    const id = base.cards[0].id;
    const a = { ...base, cards: base.cards.map((c) => (c.id === id ? { ...c, hint: "あ", updatedAt: T0 + MIN } : c)) };
    const b = { ...base, cards: base.cards.map((c) => (c.id === id ? { ...c, hint: "い", updatedAt: T0 + MIN } : c)) };

    expect(mergeDb(a, b, T0).cards).toEqual(mergeDb(b, a, T0).cards);
  });

  it("ログ・統計・設定も含めて可換(開いているデッキを除く)", () => {
    const base = seedDb();
    const a = {
      ...base,
      reviewLog: [review("r1", base.cards[0].id, T0 + MIN, true)],
      settings: { ...base.settings, setSize: 20 },
      settingsUpdatedAt: T0 + MIN,
    };
    const b = {
      ...base,
      reviewLog: [review("r2", base.cards[1].id, T0 + 2 * MIN, false)],
      settings: { ...base.settings, setSize: 5 },
      settingsUpdatedAt: T0 + 3 * MIN,
    };

    const ab = mergeDb(a, b, T0);
    const ba = mergeDb(b, a, T0);
    expect({ ...ab, activeCollectionId: null }).toEqual({ ...ba, activeCollectionId: null });
  });
});

describe("冪等性 — 同じものを2回受け取っても増えない", () => {
  it("自分自身とマージしても変わらない", () => {
    const a = { ...seedDb(), reviewLog: [review("r1", "c1", T0, true), review("r2", "c1", T0 + MIN, false)] };
    const once = mergeDb(a, a, T0);
    expect(mergeDb(once, once, T0)).toEqual(once);
    expect(once.reviewLog).toHaveLength(2);
  });

  it("同期を繰り返しても総レビュー数が膨らまない", () => {
    const a = { ...seedDb(), reviewLog: [review("r1", "c1", T0, true)] };
    const b = { ...seedDb(), reviewLog: [review("r2", "c1", T0 + MIN, true)] };

    let m = mergeDb(a, b, T0);
    for (let i = 0; i < 5; i++) m = mergeDb(m, b, T0);
    expect(deriveStats(m.reviewLog, m.statsBase).totalReviews).toBe(2);
  });
});

// ------------------------------------------------------------------
// 実際に起きること
// ------------------------------------------------------------------

describe("復習ログ — 学習の実績はマージで消えない", () => {
  it("両端末のレビューが合流する", () => {
    const base = seedDb();
    const id = base.cards[0].id;
    const a = { ...base, reviewLog: [review("r1", id, T0, true), review("r2", id, T0 + MIN, true)] };
    const b = { ...base, reviewLog: [review("r3", id, T0 + 2 * MIN, false)] };

    const m = mergeDb(a, b, T0);
    expect(m.reviewLog.map((e) => e.id)).toEqual(["r1", "r2", "r3"]);
    expect(deriveStats(m.reviewLog, m.statsBase).totalReviews).toBe(3);
  });

  it("時刻順に並ぶ", () => {
    const base = seedDb();
    const a = { ...base, reviewLog: [review("r3", "c1", T0 + 3 * MIN, true)] };
    const b = { ...base, reviewLog: [review("r1", "c1", T0 + MIN, true)] };
    expect(mergeDb(a, b, T0).reviewLog.map((e) => e.ts)).toEqual([T0 + MIN, T0 + 3 * MIN]);
  });
});

describe("削除 — 片方で消したカードが復活しない", () => {
  it("tombstoneが勝つ", () => {
    const base = seedDb();
    const id = base.cards[0].id;
    const a = base; // 消していない端末
    const b = { ...base, cards: base.cards.map((c) => (c.id === id ? { ...c, deletedAt: T0 + MIN, updatedAt: T0 + MIN } : c)) };

    const m = mergeDb(a, b, T0);
    expect(m.cards.find((c) => c.id === id).deletedAt).toBe(T0 + MIN);
    expect(m.cards).toHaveLength(2); // 配列からは消えない = 次の同期でも伝わる
  });

  it("削除より後の編集は復活として扱う", () => {
    const base = seedDb();
    const id = base.cards[0].id;
    const a = { ...base, cards: base.cards.map((c) => (c.id === id ? { ...c, deletedAt: T0 + MIN, updatedAt: T0 + MIN } : c)) };
    const b = { ...base, cards: base.cards.map((c) => (c.id === id ? { ...c, hint: "直した", updatedAt: T0 + 2 * MIN } : c)) };
    expect(mergeDb(a, b, T0).cards.find((c) => c.id === id).deletedAt).toBeNull();
  });
});

describe("片方にしか無いもの", () => {
  it("追加されたカードが両方に入る", () => {
    const base = seedDb();
    const extra = makeCard({ hint: "新規", pre: "", answer: "new", post: "" }, base.activeCollectionId, T0 + MIN);
    const m = mergeDb(base, { ...base, cards: [...base.cards, extra] }, T0);
    expect(m.cards).toHaveLength(3);
  });

  it("追加されたコレクションが両方に入る", () => {
    const base = seedDb();
    const col = { id: "col-x", name: "簿記", promptLabel: "?", createdAt: T0, updatedAt: T0, deletedAt: null };
    const m = mergeDb(base, { ...base, collections: [...base.collections, col] }, T0);
    expect(m.collections.some((c) => c.id === "col-x")).toBe(true);
  });
});

describe("設定", () => {
  it("新しく変更した方が丸ごと勝つ", () => {
    const base = seedDb();
    const a = { ...base, settings: { ...base.settings, setSize: 20, dailySets: 1 }, settingsUpdatedAt: T0 + MIN };
    const b = { ...base, settings: { ...base.settings, setSize: 5, dailySets: 7 }, settingsUpdatedAt: T0 + 2 * MIN };
    const m = mergeDb(a, b, T0);
    // 「setSizeはA、dailySetsはB」という誰も設定していない組み合わせを作らない
    expect(m.settings.setSize).toBe(5);
    expect(m.settings.dailySets).toBe(7);
  });
});

describe("開いているデッキは同期しない", () => {
  it("ローカルの選択が保たれる", () => {
    const base = seedDb();
    const col = { id: "col-x", name: "簿記", promptLabel: "?", createdAt: T0, updatedAt: T0, deletedAt: null };
    const a = { ...base, collections: [...base.collections, col] };
    const b = { ...a, activeCollectionId: "col-x" };
    expect(mergeDb(a, b, T0).activeCollectionId).toBe(a.activeCollectionId);
  });

  it("開いていたデッキが消えていたら生きている方へ寄せる", () => {
    const base = seedDb();
    const gone = base.collections.map((c) => ({ ...c, deletedAt: T0 + MIN, updatedAt: T0 + MIN }));
    const col = { id: "col-x", name: "簿記", promptLabel: "?", createdAt: T0, updatedAt: T0, deletedAt: null };
    const m = mergeDb(base, { ...base, collections: [...gone, col] }, T0);
    expect(m.activeCollectionId).toBe("col-x");
  });
});

describe("版が違う端末", () => {
  it("古い版のDBを受け取っても最新まで上げてから畳む", () => {
    const old = { version: 1, cards: [{ hint: "旧", pre: "", answer: "old", post: "", createdAt: T0, state: { reps: 2, interval: 3, ease: 2.5, due: T0 } }] };
    const m = mergeDb(seedDb(), old, T0);
    expect(m.version).toBe(SCHEMA_VERSION);
    expect(m.cards.some((c) => c.answer === "old")).toBe(true);
  });
});

// ------------------------------------------------------------------
// 合流後の作り直し
// ------------------------------------------------------------------

describe("rebuildMerged — 両端末の学習が両方とも効く", () => {
  it("合流したログからスケジュールを組み直す", () => {
    const base = seedDb();
    const id = base.cards[0].id;
    const a = { ...base, reviewLog: [review("r1", id, T0, true), review("r2", id, T0 + 60 * MIN, true)] };
    const b = { ...base, reviewLog: [review("r3", id, T0 + 120 * MIN, true)] };

    const merged = mergeDb(a, b, T0);
    const rebuilt = rebuildMerged(merged, changedCardsBetween(a.reviewLog, merged.reviewLog));
    const card = rebuilt.cards.find((c) => c.id === id);

    // 3回ぶんの学習が反映されている = まだ期限ではない
    expect(card.state.reps).toBeGreaterThanOrEqual(3);
    expect(isDue(card.state, T0 + 121 * MIN)).toBe(false);
  });

  it("同じログからは必ず同じ状態が出る — fuzzを切ってあるのはこのため", () => {
    const base = seedDb();
    const id = base.cards[0].id;
    const log = [review("r1", id, T0, true), review("r2", id, T0 + 60 * MIN, false), review("r3", id, T0 + 90 * MIN, true)];
    const x = rebuildMerged({ ...base, reviewLog: log });
    const y = rebuildMerged({ ...base, reviewLog: log });
    expect(x.cards.find((c) => c.id === id).state).toEqual(y.cards.find((c) => c.id === id).state);
  });

  it("ログが増えていないカードは触らない", () => {
    const base = seedDb();
    const untouched = base.cards[1];
    const rebuilt = rebuildMerged(base, new Set([base.cards[0].id]));
    expect(rebuilt.cards[1]).toBe(untouched);
  });
});

describe("changedCardsBetween", () => {
  it("ログが増えたカードだけを挙げる", () => {
    const before = [review("r1", "c1", T0, true)];
    const after = [...before, review("r2", "c2", T0 + MIN, true)];
    expect([...changedCardsBetween(before, after)]).toEqual(["c2"]);
  });
  it("変化が無ければ空", () => {
    const log = [review("r1", "c1", T0, true)];
    expect(changedCardsBetween(log, log).size).toBe(0);
  });
});
