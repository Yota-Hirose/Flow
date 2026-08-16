import { describe, it, expect } from "vitest";
import { newCardState, rate, isDue, buildQueue, isRecentlyReviewed, RECENT_REVIEW_COOLDOWN_MS } from "../scheduler.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000; // 固定の基準時刻(Date.now()に依存しない)

const card = (id, state) => ({ id, state });

describe("newCardState", () => {
  it("新規カードは即座に期限到来し、easeは2.5から始まる", () => {
    const s = newCardState(T0);
    expect(s).toEqual({ reps: 0, interval: 0, ease: 2.5, due: T0, lapses: 0, lastReview: null });
    expect(isDue(s, T0)).toBe(true);
  });
});

describe("rate — 「できた」の間隔遷移", () => {
  it("1回目の正解で1日後", () => {
    const s = rate(newCardState(T0), true, T0);
    expect(s.reps).toBe(1);
    expect(s.interval).toBe(1);
    expect(s.due).toBe(T0 + 1 * DAY);
  });

  it("2回目の正解で3日後", () => {
    let s = rate(newCardState(T0), true, T0);
    s = rate(s, true, T0);
    expect(s.reps).toBe(2);
    expect(s.interval).toBe(3);
    expect(s.due).toBe(T0 + 3 * DAY);
  });

  it("3回目以降は 前回interval × ease に伸びる", () => {
    let s = rate(newCardState(T0), true, T0);
    s = rate(s, true, T0);
    s = rate(s, true, T0); // 3 * 2.5 = 7.5 → 8
    expect(s.reps).toBe(3);
    expect(s.interval).toBe(8);
    expect(s.due).toBe(T0 + 8 * DAY);

    s = rate(s, true, T0); // 8 * 2.5 = 20
    expect(s.interval).toBe(20);
  });

  it("正解でも ease は変化しない", () => {
    let s = newCardState(T0);
    for (let i = 0; i < 5; i++) s = rate(s, true, T0);
    expect(s.ease).toBe(2.5);
  });

  it("intervalは最低1日を下回らない", () => {
    // easeが下限まで落ちた状態でも interval は 1 以上
    let s = { reps: 3, interval: 1, ease: 1.3, due: T0, lapses: 5, lastReview: T0 };
    s = rate(s, true, T0);
    expect(s.interval).toBeGreaterThanOrEqual(1);
  });
});

describe("rate — 「まだ」の挙動", () => {
  it("repsとintervalがリセットされ、10分後に再出題される", () => {
    let s = rate(newCardState(T0), true, T0);
    s = rate(s, true, T0);
    expect(s.reps).toBe(2);

    s = rate(s, false, T0);
    expect(s.reps).toBe(0);
    expect(s.interval).toBe(0);
    expect(s.due).toBe(T0 + 10 * 60 * 1000);
  });

  it("easeが0.2ずつ下がる", () => {
    let s = rate(newCardState(T0), false, T0);
    expect(s.ease).toBeCloseTo(2.3, 10);
    s = rate(s, false, T0);
    expect(s.ease).toBeCloseTo(2.1, 10);
  });

  it("easeの下限は1.3", () => {
    let s = newCardState(T0);
    for (let i = 0; i < 20; i++) s = rate(s, false, T0);
    expect(s.ease).toBe(1.3);
  });
});

describe("rate — 復習ログのための記録 (T-03)", () => {
  it("失敗するたびに lapses が増える", () => {
    let s = newCardState(T0);
    expect(s.lapses).toBe(0);
    s = rate(s, false, T0);
    expect(s.lapses).toBe(1);
    s = rate(s, true, T0);
    expect(s.lapses).toBe(1); // 正解では増えない
    s = rate(s, false, T0);
    expect(s.lapses).toBe(2);
  });

  it("lastReview に評価時刻が入る", () => {
    const s = rate(newCardState(T0), true, T0 + 500);
    expect(s.lastReview).toBe(T0 + 500);
  });

  it("元のstateを破壊しない(純関数)", () => {
    const before = newCardState(T0);
    const snapshot = { ...before };
    rate(before, true, T0);
    expect(before).toEqual(snapshot);
  });
});

describe("isDue", () => {
  it("dueが現在時刻以下なら期限到来", () => {
    expect(isDue({ due: T0 }, T0)).toBe(true);
    expect(isDue({ due: T0 - 1 }, T0)).toBe(true);
    expect(isDue({ due: T0 + 1 }, T0)).toBe(false);
  });
});

describe("buildQueue", () => {
  it("期限到来カードを期限の古い順に返す", () => {
    const cards = [
      card("a", { ...newCardState(T0), due: T0 - 100 }),
      card("b", { ...newCardState(T0), due: T0 - 300 }),
      card("c", { ...newCardState(T0), due: T0 - 200 }),
    ];
    expect(buildQueue(cards, 10, T0).map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("size で打ち切る", () => {
    const cards = Array.from({ length: 25 }, (_, i) =>
      card(`c${i}`, { ...newCardState(T0), due: T0 - i })
    );
    expect(buildQueue(cards, 10, T0)).toHaveLength(10);
  });

  it("期限到来が1枚も無いときは全カードから期限が近い順(先取り練習)", () => {
    const cards = [
      card("a", { ...newCardState(T0), due: T0 + 5 * DAY }),
      card("b", { ...newCardState(T0), due: T0 + 1 * DAY }),
      card("c", { ...newCardState(T0), due: T0 + 3 * DAY }),
    ];
    expect(buildQueue(cards, 10, T0).map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("期限到来が1枚でもあれば、未到来カードは混ざらない", () => {
    const cards = [
      card("due", { ...newCardState(T0), due: T0 - 1 }),
      card("future", { ...newCardState(T0), due: T0 + DAY }),
    ];
    expect(buildQueue(cards, 10, T0).map((c) => c.id)).toEqual(["due"]);
  });

  it("カードが空なら空のキュー", () => {
    expect(buildQueue([], 10, T0)).toEqual([]);
  });

  it("入力配列を破壊しない", () => {
    const cards = [
      card("a", { ...newCardState(T0), due: T0 + 2 }),
      card("b", { ...newCardState(T0), due: T0 + 1 }),
    ];
    buildQueue(cards, 10, T0);
    expect(cards.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("削除済みカード(deletedAt)は出題されない", () => {
    const cards = [
      { ...card("alive", { ...newCardState(T0), due: T0 - 1 }), deletedAt: null },
      { ...card("gone", { ...newCardState(T0), due: T0 - 2 }), deletedAt: T0 },
    ];
    expect(buildQueue(cards, 10, T0).map((c) => c.id)).toEqual(["alive"]);
  });
});

describe("buildQueue — 先取り練習で直前のカードが戻らない (D-2の解消)", () => {
  it("「もう1セット」で、たった今落としたカードが先頭に来ない", () => {
    // 失敗カードは due が now+10分 で全カード中いちばん近いため、
    // 素朴な先取りフォールバックだと真っ先に選ばれてしまっていた
    const justFailed = card("justFailed", { ...newCardState(T0), due: T0 + 10 * 60 * 1000, lastReview: T0 });
    const untouched = card("untouched", { ...newCardState(T0), due: T0 + 5 * DAY, lastReview: null });
    const queue = buildQueue([justFailed, untouched], 10, T0 + 1000);
    expect(queue.map((c) => c.id)).toEqual(["untouched"]);
  });

  it("直前のセットで正解したカードも先取りに混ざらない", () => {
    const justPassed = card("justPassed", { ...newCardState(T0), due: T0 + DAY, lastReview: T0 });
    const untouched = card("untouched", { ...newCardState(T0), due: T0 + 3 * DAY, lastReview: null });
    expect(buildQueue([justPassed, untouched], 10, T0 + 1000).map((c) => c.id)).toEqual(["untouched"]);
  });

  it("冷却時間を過ぎたカードは先取りに戻ってくる", () => {
    const c = card("c", { ...newCardState(T0), due: T0 + DAY, lastReview: T0 });
    const later = T0 + RECENT_REVIEW_COOLDOWN_MS + 1;
    expect(buildQueue([c], 10, later).map((x) => x.id)).toEqual(["c"]);
  });

  it("全部が直近レビュー済みなら空を返す(同じカードを続けて回させない)", () => {
    // 詰め込みは分散学習の否定。「今日の約束は終わった」と言えることを優先する
    const a = card("a", { ...newCardState(T0), due: T0 + DAY, lastReview: T0 });
    const b = card("b", { ...newCardState(T0), due: T0 + 2 * DAY, lastReview: T0 });
    expect(buildQueue([a, b], 10, T0 + 1000)).toEqual([]);
  });

  it("期限到来カードがあるときは冷却を無視する(復習が最優先)", () => {
    const dueNow = card("dueNow", { ...newCardState(T0), due: T0 - 1, lastReview: T0 - 100 });
    const untouched = card("untouched", { ...newCardState(T0), due: T0 + DAY, lastReview: null });
    expect(buildQueue([dueNow, untouched], 10, T0).map((c) => c.id)).toEqual(["dueNow"]);
  });
});

describe("isRecentlyReviewed", () => {
  it("未レビューのカードは対象外", () => {
    expect(isRecentlyReviewed(card("c", newCardState(T0)), T0)).toBe(false);
  });

  it("冷却時間の内か外かで切り替わる", () => {
    const c = card("c", { ...newCardState(T0), lastReview: T0 });
    expect(isRecentlyReviewed(c, T0 + 1000)).toBe(true);
    expect(isRecentlyReviewed(c, T0 + RECENT_REVIEW_COOLDOWN_MS + 1)).toBe(false);
  });
});
