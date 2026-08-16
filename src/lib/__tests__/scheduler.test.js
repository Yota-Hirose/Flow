import { describe, it, expect } from "vitest";
import { newCardState, rate, isDue, buildQueue, isRecentlyReviewed, RECENT_REVIEW_COOLDOWN_MS } from "../scheduler.js";
import { State } from "../fsrs.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000; // 固定の基準時刻(Date.now()に依存しない)

const card = (id, state) => ({ id, state });

describe("newCardState", () => {
  it("新規カードは即座に期限到来し、FSRSのNew状態から始まる", () => {
    const s = newCardState(T0);
    expect(s).toMatchObject({ due: T0, reps: 0, lapses: 0, fsrsState: State.New, lastReview: null });
    expect(isDue(s, T0)).toBe(true);
  });
});

describe("rate — 「できた」", () => {
  it("繰り返すほど間隔が伸びる", () => {
    let s = newCardState(T0);
    let t = T0;
    const gaps = [];
    for (let i = 0; i < 5; i++) {
      s = rate(s, true, t);
      gaps.push(s.due - t);
      t = s.due;
    }
    // 最初は学習ステップ(分単位)、そこから日単位で伸びていく
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    expect(gaps.at(-1)).toBeGreaterThan(30 * DAY);
  });

  it("2回目の正解で復習段階に上がる", () => {
    let s = rate(newCardState(T0), true, T0);
    expect(s.fsrsState).toBe(State.Learning);
    s = rate(s, true, s.due);
    expect(s.fsrsState).toBe(State.Review);
    expect(s.due - s.lastReview).toBeGreaterThan(DAY);
  });

  it("正解では失敗回数が増えない", () => {
    let s = newCardState(T0);
    let t = T0;
    for (let i = 0; i < 4; i++) { s = rate(s, true, t); t = s.due; }
    expect(s.lapses).toBe(0);
    expect(s.reps).toBe(4);
  });

  it("safety: Ease Hell が起きない — 失敗を挟んでも間隔は伸びていける", () => {
    // 旧SM-2では ease が下限1.3に張り付き、間隔が伸びなくなる沼があった。
    // FSRSでは失敗後も stability が回復し、間隔が伸びる。
    let s = newCardState(T0);
    let t = T0;
    for (let i = 0; i < 3; i++) { s = rate(s, true, t); t = s.due; }
    for (let i = 0; i < 5; i++) { s = rate(s, false, t); t = s.due; s = rate(s, true, t); t = s.due; }
    const before = s.scheduledDays;
    for (let i = 0; i < 4; i++) { s = rate(s, true, t); t = s.due; }
    expect(s.scheduledDays).toBeGreaterThan(before);
  });
});

describe("rate — 「まだ」", () => {
  it("復習中のカードを落とすと数分後に戻り、失敗回数が増える", () => {
    let s = newCardState(T0);
    let t = T0;
    for (let i = 0; i < 3; i++) { s = rate(s, true, t); t = s.due; }
    expect(s.lapses).toBe(0);

    const after = rate(s, false, t);
    expect(after.lapses).toBe(1);
    expect(after.fsrsState).toBe(State.Relearning);
    expect(after.due - t).toBeLessThanOrEqual(60 * 60 * 1000); // 1時間以内に戻る
    expect(after.due).toBeGreaterThan(t);
  });

  it("一度も覚えていない新規カードの失敗は lapses に数えない", () => {
    // 知らなかっただけで「忘れた」わけではない
    const s = rate(newCardState(T0), false, T0);
    expect(s.lapses).toBe(0);
    expect(s.due - T0).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("落とすと次の間隔が短くなる", () => {
    let s = newCardState(T0);
    let t = T0;
    for (let i = 0; i < 4; i++) { s = rate(s, true, t); t = s.due; }
    const longInterval = s.scheduledDays;
    s = rate(s, false, t);
    t = s.due;
    s = rate(s, true, t);
    expect(s.scheduledDays).toBeLessThan(longInterval);
  });
});

describe("rate — 同期の前提となる決定性", () => {
  it("同じ入力からは必ず同じ結果になる(fuzzを切ってある)", () => {
    const a = rate(newCardState(T0), true, T0);
    const b = rate(newCardState(T0), true, T0);
    expect(a).toEqual(b);
  });

  it("長い履歴を2回再生しても一致する", () => {
    const play = () => {
      let s = newCardState(T0);
      let t = T0;
      for (const good of [true, false, true, true, false, true, true, true]) {
        s = rate(s, good, t);
        t = s.due;
      }
      return s;
    };
    expect(play()).toEqual(play());
  });

  it("元のstateを破壊しない(純関数)", () => {
    const before = newCardState(T0);
    const snapshot = structuredClone(before);
    rate(before, true, T0);
    expect(before).toEqual(snapshot);
  });

  it("lastReview に評価時刻が入る", () => {
    expect(rate(newCardState(T0), true, T0 + 500).lastReview).toBe(T0 + 500);
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
