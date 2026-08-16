// ------------------------------------------------------------------
// 溜まったときの挙動 — 1日の上限(T-28)と休眠カード(T-15)。
//
// この2つは「溜まった状態でもアプリが終わりを言える」ためのもの。
// 上限だけだと繰り越しが積み上がり、休眠だけだと今日の終わりが来ない。
// ------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { reviewsToday, remainingToday, isDayComplete, dailyLimit, nextSetSize } from "../dailyBudget.js";
import { applyDormancy, dormantCount, isAwake, DAYS_OF_WORK_KEPT } from "../dormancy.js";
import { buildQueue, newCardState } from "../scheduler.js";
import { defaultSettings } from "../settings.js";

const DAY = 24 * 60 * 60 * 1000;
const NOON = new Date(2026, 7, 16, 12, 0, 0).getTime();

const logEntry = (ts) => ({ id: `e${ts}`, cardId: "c", ts, good: true, intervalBefore: 0 });

// overdueDays 日前に期限が来た復習カード
const overdue = (id, overdueDays, stability = 5) => ({
  id,
  deletedAt: null,
  dormantSince: null,
  state: { ...newCardState(NOON), due: NOON - overdueDays * DAY, stability, reps: 3, fsrsState: 2, lastReview: NOON - overdueDays * DAY },
});

// ------------------------------------------------------------------

describe("dailyLimit", () => {
  it("セット数 × 1セットの枚数", () => {
    expect(dailyLimit({ dailySets: 3, setSize: 10 })).toBe(30);
    expect(dailyLimit({ dailySets: 2, setSize: 25 })).toBe(50);
  });

  it("0 は無制限", () => {
    expect(dailyLimit({ dailySets: 0, setSize: 10 })).toBe(Infinity);
    expect(dailyLimit({})).toBe(Infinity);
  });
});

describe("reviewsToday — 復習ログから当日ぶんを数える", () => {
  it("今日のエントリだけ数える", () => {
    const log = [logEntry(NOON - 2 * DAY), logEntry(NOON - DAY), logEntry(NOON - 3600_000), logEntry(NOON)];
    expect(reviewsToday(log, NOON)).toBe(2);
  });

  it("ログが空なら0", () => {
    expect(reviewsToday([], NOON)).toBe(0);
  });

  it("日付が変われば0に戻る(専用カウンタを持たないので勝手にリセットされる)", () => {
    const log = [logEntry(NOON)];
    expect(reviewsToday(log, NOON)).toBe(1);
    expect(reviewsToday(log, NOON + DAY)).toBe(0);
  });
});

describe("remainingToday / isDayComplete", () => {
  const settings = { dailySets: 3, setSize: 10 }; // 30枚

  it("使った分だけ減る", () => {
    const log = Array.from({ length: 12 }, (_, i) => logEntry(NOON + i));
    expect(remainingToday(log, settings, NOON)).toBe(18);
  });

  it("上限に達したら0で「今日の分は終わり」", () => {
    const log = Array.from({ length: 30 }, (_, i) => logEntry(NOON + i));
    expect(remainingToday(log, settings, NOON)).toBe(0);
    expect(isDayComplete(log, settings, NOON)).toBe(true);
  });

  it("上限を超えて続けてもマイナスにならない(「それでも続ける」の後)", () => {
    const log = Array.from({ length: 45 }, (_, i) => logEntry(NOON + i));
    expect(remainingToday(log, settings, NOON)).toBe(0);
  });

  it("無制限なら常に終わらない", () => {
    const log = Array.from({ length: 500 }, (_, i) => logEntry(NOON + i));
    expect(remainingToday(log, { dailySets: 0, setSize: 10 }, NOON)).toBe(Infinity);
    expect(isDayComplete(log, { dailySets: 0, setSize: 10 }, NOON)).toBe(false);
  });

  it("翌日になれば予算が戻る", () => {
    const log = Array.from({ length: 30 }, (_, i) => logEntry(NOON + i));
    expect(isDayComplete(log, settings, NOON + DAY)).toBe(false);
    expect(remainingToday(log, settings, NOON + DAY)).toBe(30);
  });
});

describe("nextSetSize — 最後のセットは残りぶんだけ", () => {
  const settings = { dailySets: 3, setSize: 10 };

  it("余裕があれば通常の枚数", () => {
    expect(nextSetSize([], settings, NOON)).toBe(10);
  });

  it("残り5枚なら5枚のセットになる", () => {
    const log = Array.from({ length: 25 }, (_, i) => logEntry(NOON + i));
    expect(nextSetSize(log, settings, NOON)).toBe(5);
  });

  it("無制限なら常に通常の枚数", () => {
    expect(nextSetSize([], { dailySets: 0, setSize: 10 }, NOON)).toBe(10);
  });
});

// ------------------------------------------------------------------

describe("applyDormancy — 抱えきれない分を寝かせる", () => {
  const limit = 30; // 1日30枚 → 7日分 = 210枚まで抱える

  it("消化できる範囲なら何も起きない", () => {
    const cards = Array.from({ length: 50 }, (_, i) => overdue(`c${i}`, i + 1));
    expect(applyDormancy(cards, { dailyLimit: limit, now: NOON })).toBe(cards);
  });

  it("7日分を超えたら超過分だけ休眠に落ちる", () => {
    const capacity = limit * DAYS_OF_WORK_KEPT;
    const cards = Array.from({ length: capacity + 40 }, (_, i) => overdue(`c${i}`, 1 + (i % 60)));
    const after = applyDormancy(cards, { dailyLimit: limit, now: NOON });
    expect(dormantCount(after)).toBe(40);
    expect(after.filter(isAwake)).toHaveLength(capacity);
  });

  it("寝かせるのは「最も忘れている」もの — 予定間隔に対する超過が大きい順", () => {
    const cards = [
      overdue("よく覚えている", 1, 30), // 30日間隔の1日遅れ
      overdue("忘れかけ", 10, 20),
      overdue("完全に忘れた", 300, 2), // 2日間隔の300日遅れ
    ];
    const after = applyDormancy(cards, { dailyLimit: 1 / DAYS_OF_WORK_KEPT, now: NOON }); // capacity=1
    const sleeping = after.filter((c) => !isAwake(c)).map((c) => c.id);
    expect(sleeping).toContain("完全に忘れた");
    expect(sleeping).not.toContain("よく覚えている");
  });

  it("休眠カードは出題キューに出てこない", () => {
    const cards = [overdue("a", 5), { ...overdue("b", 9), dormantSince: NOON }];
    expect(buildQueue(cards, 10, NOON).map((c) => c.id)).toEqual(["a"]);
  });

  it("余裕が出たら静かに戻る(期限の古い順)", () => {
    const sleeping = [
      { ...overdue("古い", 100), dormantSince: NOON - DAY },
      { ...overdue("新しい", 2), dormantSince: NOON - DAY },
    ];
    const after = applyDormancy(sleeping, { dailyLimit: limit, now: NOON });
    expect(after.every(isAwake)).toBe(true);
    expect(buildQueue(after, 10, NOON)).toHaveLength(2);
  });

  it("上限が無制限なら休眠もしない(ユーザーが自分で制御している状態)", () => {
    const cards = Array.from({ length: 1000 }, (_, i) => overdue(`c${i}`, i + 1));
    expect(applyDormancy(cards, { dailyLimit: Infinity, now: NOON })).toBe(cards);
    expect(applyDormancy(cards, { dailyLimit: 0, now: NOON })).toBe(cards);
  });

  it("削除済みカードは休眠の対象にも数にも入らない", () => {
    const cards = [
      ...Array.from({ length: 5 }, (_, i) => overdue(`live${i}`, i + 1)),
      ...Array.from({ length: 100 }, (_, i) => ({ ...overdue(`dead${i}`, i + 1), deletedAt: NOON })),
    ];
    const after = applyDormancy(cards, { dailyLimit: 1 / DAYS_OF_WORK_KEPT, now: NOON });
    expect(after.filter((c) => c.deletedAt && !isAwake(c))).toHaveLength(0);
  });

  it("繰り返し適用しても振動しない(冪等)", () => {
    const cards = Array.from({ length: 300 }, (_, i) => overdue(`c${i}`, 1 + (i % 50)));
    const once = applyDormancy(cards, { dailyLimit: limit, now: NOON });
    const twice = applyDormancy(once, { dailyLimit: limit, now: NOON });
    expect(dormantCount(twice)).toBe(dormantCount(once));
  });

  it("休眠しても updatedAt が動くので同期で伝わる", () => {
    const cards = Array.from({ length: 300 }, (_, i) => ({ ...overdue(`c${i}`, i + 1), updatedAt: 1 }));
    const after = applyDormancy(cards, { dailyLimit: limit, now: NOON });
    expect(after.filter((c) => !isAwake(c)).every((c) => c.updatedAt === NOON)).toBe(true);
  });
});

describe("溜まった状態の通し", () => {
  it("500枚溜まっていても、1日の上限で必ず終わりが来る", () => {
    const settings = { ...defaultSettings(), dailySets: 3, setSize: 10 }; // 30枚/日
    let cards = Array.from({ length: 500 }, (_, i) => overdue(`c${i}`, 1 + (i % 90)));
    cards = applyDormancy(cards, { dailyLimit: dailyLimit(settings), now: NOON });

    let log = [];
    let sets = 0;
    while (!isDayComplete(log, settings, NOON) && sets < 100) {
      const size = nextSetSize(log, settings, NOON);
      const queue = buildQueue(cards, size, NOON);
      if (queue.length === 0) break;
      for (let i = 0; i < queue.length; i++) log = [...log, logEntry(NOON + log.length)];
      cards = cards.map((c) => (queue.some((q) => q.id === c.id) ? { ...c, state: { ...c.state, due: NOON + DAY } } : c));
      sets++;
    }

    expect(sets).toBe(3); // 50セットではなく3セットで今日は終わり
    expect(isDayComplete(log, settings, NOON)).toBe(true);
    expect(reviewsToday(log, NOON)).toBe(30);
  });

  it("抱える量には上限がかかり、無限には増えない", () => {
    const settings = { ...defaultSettings(), dailySets: 3, setSize: 10 };
    const cards = Array.from({ length: 500 }, (_, i) => overdue(`c${i}`, 1 + (i % 90)));
    const after = applyDormancy(cards, { dailyLimit: dailyLimit(settings), now: NOON });
    // 30枚/日 × 7日 = 210枚まで。残り290枚は休眠
    expect(after.filter(isAwake)).toHaveLength(210);
    expect(dormantCount(after)).toBe(290);
  });
});
