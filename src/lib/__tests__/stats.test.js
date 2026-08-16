import { describe, it, expect } from "vitest";
import { applyReview, emptyStats, dayKey, retentionRate } from "../stats.js";

const DAY = 24 * 60 * 60 * 1000;
const NOON = new Date(2026, 7, 16, 12, 0, 0).getTime();

describe("applyReview — 1枚ごとの加算 (D-8の解消)", () => {
  it("正解で総数と正解数が1ずつ増える", () => {
    const s = applyReview(emptyStats(), { good: true, now: NOON });
    expect(s.totalReviews).toBe(1);
    expect(s.totalCorrect).toBe(1);
  });

  it("不正解では総数だけ増える", () => {
    const s = applyReview(emptyStats(), { good: false, now: NOON });
    expect(s.totalReviews).toBe(1);
    expect(s.totalCorrect).toBe(0);
  });

  it("セットを完走しなくても記録が残る", () => {
    // 3枚だけ触って離脱したケース
    let s = emptyStats();
    for (const good of [true, false, true]) s = applyReview(s, { good, now: NOON });
    expect(s.totalReviews).toBe(3);
    expect(s.totalCorrect).toBe(2);
  });

  it("ベストコンボは最大値だけ更新する", () => {
    let s = applyReview(emptyStats(), { good: true, combo: 5, now: NOON });
    expect(s.bestCombo).toBe(5);
    s = applyReview(s, { good: true, combo: 2, now: NOON });
    expect(s.bestCombo).toBe(5);
    s = applyReview(s, { good: true, combo: 9, now: NOON });
    expect(s.bestCombo).toBe(9);
  });

  it("元の統計を破壊しない", () => {
    const before = emptyStats();
    applyReview(before, { good: true, now: NOON });
    expect(before.totalReviews).toBe(0);
  });

  it("壊れた統計が入っていても既定値で埋めて動く", () => {
    expect(applyReview(undefined, { good: true, now: NOON }).totalReviews).toBe(1);
    expect(applyReview({}, { good: true, now: NOON }).totalCorrect).toBe(1);
  });
});

describe("ストリーク — 1枚でも触れば続く", () => {
  it("初回は1日目", () => {
    expect(applyReview(emptyStats(), { good: true, now: NOON }).streak).toBe(1);
  });

  it("同じ日に何度評価しても伸びない", () => {
    let s = applyReview(emptyStats(), { good: true, now: NOON });
    s = applyReview(s, { good: true, now: NOON + 3600_000 });
    s = applyReview(s, { good: false, now: NOON + 7200_000 });
    expect(s.streak).toBe(1);
    expect(s.totalReviews).toBe(3);
  });

  it("翌日に触れば伸びる", () => {
    let s = applyReview(emptyStats(), { good: true, now: NOON });
    s = applyReview(s, { good: true, now: NOON + DAY });
    s = applyReview(s, { good: true, now: NOON + 2 * DAY });
    expect(s.streak).toBe(3);
  });

  it("1日空くと1に戻る", () => {
    let s = applyReview(emptyStats(), { good: true, now: NOON });
    s = applyReview(s, { good: true, now: NOON + DAY });
    expect(s.streak).toBe(2);
    s = applyReview(s, { good: true, now: NOON + 3 * DAY });
    expect(s.streak).toBe(1);
  });

  it("完走を条件にしない — 1枚でやめた日も続いたことになる", () => {
    let s = applyReview(emptyStats(), { good: true, now: NOON });
    // 翌日、1枚だけ触って離脱
    s = applyReview(s, { good: false, now: NOON + DAY });
    expect(s.streak).toBe(2);
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
