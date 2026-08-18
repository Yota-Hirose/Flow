import { describe, it, expect } from "vitest";
import {
  deriveStats,
  emptyBase,
  emptyStats,
  foldEntries,
  mergeBase,
  baseFromLegacyStats,
  dayKey,
  retentionRate,
  COMBO_GAP_MS,
} from "../stats.js";

const DAY = 24 * 60 * 60 * 1000;
const NOON = new Date(2026, 7, 16, 12, 0, 0).getTime();

let seq = 0;
const entry = (good, ts, cardId = "c1") => ({ id: `e${seq++}`, cardId, ts, good });

// 同じセット内の連続レビュー(1分間隔)
const run = (goods, from = NOON, cardId = "c1") =>
  goods.map((g, i) => entry(g, from + i * 60_000, cardId));

describe("deriveStats — ログから数え直す", () => {
  it("正解で総数と正解数が増える", () => {
    const s = deriveStats(run([true]));
    expect(s.totalReviews).toBe(1);
    expect(s.totalCorrect).toBe(1);
  });

  it("不正解では総数だけ増える", () => {
    const s = deriveStats(run([false]));
    expect(s.totalReviews).toBe(1);
    expect(s.totalCorrect).toBe(0);
  });

  it("セットを完走しなくても記録が残る(D-8)", () => {
    // 3枚だけ触って離脱したケース
    const s = deriveStats(run([true, false, true]));
    expect(s.totalReviews).toBe(3);
    expect(s.totalCorrect).toBe(2);
  });

  it("順不同で渡しても同じ結果になる", () => {
    const log = run([true, false, true, true]);
    const shuffled = [log[2], log[0], log[3], log[1]];
    expect(deriveStats(shuffled)).toEqual(deriveStats(log));
  });

  it("同じログを2回渡しても増えない — 冪等", () => {
    const log = run([true, true, false]);
    expect(deriveStats(log)).toEqual(deriveStats(log));
  });

  it("ログが空なら繰り越しがそのまま出る", () => {
    const base = { ...emptyBase(), totalReviews: 40, totalCorrect: 30, streak: 4, bestCombo: 7 };
    const s = deriveStats([], base);
    expect(s.totalReviews).toBe(40);
    expect(s.streak).toBe(4);
  });
});

describe("ベストコンボ — 連続正解の最長", () => {
  it("連続正解の長さを数える", () => {
    expect(deriveStats(run([true, true, true])).bestCombo).toBe(3);
  });

  it("不正解で切れる", () => {
    expect(deriveStats(run([true, true, false, true])).bestCombo).toBe(2);
  });

  it("最長のものを採る", () => {
    expect(deriveStats(run([true, false, true, true, true, false, true])).bestCombo).toBe(3);
  });

  it("30分空けば別セッション扱いで切れる", () => {
    const log = [
      ...run([true, true]),
      entry(true, NOON + 60_000 + COMBO_GAP_MS + 1000),
    ];
    expect(deriveStats(log).bestCombo).toBe(2);
  });

  it("繰り越しのベストは超えられないと残る", () => {
    const base = { ...emptyBase(), bestCombo: 12 };
    expect(deriveStats(run([true, true]), base).bestCombo).toBe(12);
  });
});

describe("ストリーク — 1枚でも触れば続く", () => {
  const day = (n, goods = [true]) => run(goods, NOON + n * DAY);

  it("初回は1日目", () => {
    expect(deriveStats(day(0)).streak).toBe(1);
  });

  it("同じ日に何度評価しても伸びない", () => {
    expect(deriveStats(run([true, true, false])).streak).toBe(1);
  });

  it("翌日に触れば伸びる", () => {
    expect(deriveStats([...day(0), ...day(1), ...day(2)]).streak).toBe(3);
  });

  it("1日空くと数え直す", () => {
    expect(deriveStats([...day(0), ...day(1), ...day(3)]).streak).toBe(1);
  });

  it("完走を条件にしない — 1枚でやめた日も続いたことになる", () => {
    expect(deriveStats([...day(0), ...day(1, [false])]).streak).toBe(2);
  });

  it("空白より前の連続は数えない", () => {
    const log = [...day(0), ...day(1), ...day(2), ...day(5), ...day(6)];
    expect(deriveStats(log).streak).toBe(2);
  });
});

describe("foldEntries — リングバッファから溢れた分を繰り越す", () => {
  it("捨てられたレビューも総数に残る", () => {
    const dropped = run([true, true, false]);
    const base = foldEntries(emptyBase(), dropped);
    expect(base.totalReviews).toBe(3);
    expect(base.totalCorrect).toBe(2);
  });

  it("畳み込んだ後にログを数えても二重にならない", () => {
    const all = run([true, false, true, true]);
    const dropped = all.slice(0, 2);
    const kept = all.slice(2);
    const s = deriveStats(kept, foldEntries(emptyBase(), dropped));
    expect(s.totalReviews).toBe(4);
    expect(s.totalCorrect).toBe(3);
  });

  it("繰り越しに繰り越しても積み上がる", () => {
    let base = foldEntries(emptyBase(), run([true, true]));
    base = foldEntries(base, run([true], NOON + DAY));
    expect(base.totalReviews).toBe(3);
  });
});

describe("baseFromLegacyStats — v3からの移行で数字が変わらない", () => {
  it("累積statsとログが重なっていても二重に数えない", () => {
    const log = run([true, true, false]);
    const old = { totalReviews: 100, totalCorrect: 80, bestCombo: 9, lastReviewDay: dayKey(NOON), streak: 5 };
    expect(deriveStats(log, baseFromLegacyStats(old, log)).totalReviews).toBe(100);
    expect(deriveStats(log, baseFromLegacyStats(old, log)).totalCorrect).toBe(80);
  });

  it("ログが数日ぶんあってもストリークが保たれる", () => {
    const log = [...run([true], NOON - 2 * DAY), ...run([true], NOON - DAY), ...run([true], NOON)];
    const old = { totalReviews: 500, totalCorrect: 400, bestCombo: 12, lastReviewDay: dayKey(NOON), streak: 30 };
    expect(deriveStats(log, baseFromLegacyStats(old, log)).streak).toBe(30);
  });

  it("ログが空(v1からの移行組)でも数字が残る", () => {
    const old = { totalReviews: 42, totalCorrect: 33, bestCombo: 6, lastReviewDay: "2026-8-1", streak: 3 };
    const s = deriveStats([], baseFromLegacyStats(old, []));
    expect(s.totalReviews).toBe(42);
    expect(s.streak).toBe(3);
    expect(s.lastReviewDay).toBe("2026-8-1");
  });

  it("壊れた統計でも例外を投げない", () => {
    expect(() => baseFromLegacyStats(undefined, [])).not.toThrow();
    expect(baseFromLegacyStats(null, []).totalReviews).toBe(0);
  });
});

describe("mergeBase — 繰り越し同士の突き合わせ", () => {
  it("大きいほうを採る", () => {
    const a = { ...emptyBase(), totalReviews: 100, totalCorrect: 80, bestCombo: 5 };
    const b = { ...emptyBase(), totalReviews: 60, totalCorrect: 50, bestCombo: 9 };
    const m = mergeBase(a, b);
    expect(m.totalReviews).toBe(100);
    expect(m.bestCombo).toBe(9);
  });

  it("順序を入れ替えても同じ — 可換", () => {
    const a = { ...emptyBase(), totalReviews: 100, lastReviewAt: NOON, streak: 3 };
    const b = { ...emptyBase(), totalReviews: 60, lastReviewAt: NOON - DAY, streak: 9 };
    expect(mergeBase(a, b)).toEqual(mergeBase(b, a));
  });
});

describe("dayKey", () => {
  it("同じ日なら同じキー", () => {
    expect(dayKey(NOON)).toBe(dayKey(NOON + 11 * 3600_000));
  });
  it("日が変わればキーも変わる", () => {
    expect(dayKey(NOON)).not.toBe(dayKey(NOON + DAY));
  });
});

describe("retentionRate", () => {
  it("レビューが無ければnull", () => {
    expect(retentionRate(emptyStats())).toBeNull();
  });
  it("百分率で返す", () => {
    expect(retentionRate({ totalReviews: 8, totalCorrect: 6 })).toBe(75);
  });
});
