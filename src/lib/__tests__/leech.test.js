import { describe, it, expect } from "vitest";
import {
  isLeech,
  findLeech,
  findLeechInSession,
  accuracyOf,
  snooze,
  LEECH_LAPSE_THRESHOLD,
  LEECH_ACCURACY,
  SNOOZE_MS,
} from "../leech.js";
import { newCardState } from "../scheduler.js";

const T0 = 1_700_000_000_000;

const card = (id, lapses, extra = {}) => ({
  id,
  hint: `ヒント${id}`,
  deletedAt: null,
  dormantSince: null,
  leechSnoozedUntil: null,
  state: { ...newCardState(T0), lapses, reps: 3, fsrsState: 2 },
  ...extra,
});

// 指定した正誤で cardId のログを作る
const logFor = (cardId, results) =>
  results.map((good, i) => ({ id: `${cardId}-${i}`, cardId, ts: T0 + i * 1000, good, intervalBefore: 1 }));

// 落としてばかりのログ(正答率 1/6 ≒ 0.17)
const struggling = (id) => logFor(id, [false, false, false, false, false, true]);
// よく覚えているログ(正答率 5/6 ≒ 0.83)
const healthy = (id) => logFor(id, [true, true, true, false, true, true]);

describe("accuracyOf", () => {
  it("ログが無ければ1(まだ困っていない)", () => {
    expect(accuracyOf([], "x")).toBe(1);
  });

  it("正答率を返す", () => {
    expect(accuracyOf(logFor("a", [true, true, false, false]), "a")).toBe(0.5);
  });

  it("他のカードのログは混ざらない", () => {
    const log = [...logFor("a", [true, true]), ...logFor("b", [false, false])];
    expect(accuracyOf(log, "a")).toBe(1);
    expect(accuracyOf(log, "b")).toBe(0);
  });
});

describe("isLeech — 判定条件", () => {
  it("失敗が閾値を超え、かつ正答率が低いカードを拾う", () => {
    const c = card("a", LEECH_LAPSE_THRESHOLD);
    expect(isLeech(c, struggling("a"), T0)).toBe(true);
  });

  it("失敗回数が閾値未満なら拾わない", () => {
    const c = card("a", LEECH_LAPSE_THRESHOLD - 1);
    expect(isLeech(c, struggling("a"), T0)).toBe(false);
  });

  it("失敗が多くても正答率が高ければ拾わない(健全に復習しているカード)", () => {
    // よく復習していて時々落とすだけのカードを"苦しんでいる"と決めつけない
    const c = card("a", LEECH_LAPSE_THRESHOLD + 3);
    expect(accuracyOf(healthy("a"), "a")).toBeGreaterThan(LEECH_ACCURACY);
    expect(isLeech(c, healthy("a"), T0)).toBe(false);
  });

  it("削除済みカードは対象外", () => {
    const c = card("a", 10, { deletedAt: T0 });
    expect(isLeech(c, struggling("a"), T0)).toBe(false);
  });

  it("閾値がコードの1箇所に定義されている", () => {
    expect(LEECH_LAPSE_THRESHOLD).toBeGreaterThan(0);
    expect(LEECH_ACCURACY).toBeGreaterThan(0);
    expect(LEECH_ACCURACY).toBeLessThan(1);
  });
});

describe("「このままでいい」— 一定期間は黙る", () => {
  it("見送った直後は再提案しない", () => {
    const c = snooze(card("a", 10), T0);
    expect(isLeech(c, struggling("a"), T0 + 1000)).toBe(false);
  });

  it("期間が過ぎたらまた提案する", () => {
    const c = snooze(card("a", 10), T0);
    expect(isLeech(c, struggling("a"), T0 + SNOOZE_MS + 1)).toBe(true);
  });

  it("見送りは updatedAt を動かす(同期で伝わる)", () => {
    const c = snooze({ ...card("a", 10), updatedAt: 1 }, T0);
    expect(c.updatedAt).toBe(T0);
    expect(c.leechSnoozedUntil).toBe(T0 + SNOOZE_MS);
  });
});

describe("findLeech — 1枚だけ返す", () => {
  it("該当が無ければ null", () => {
    expect(findLeech([card("a", 0)], [], T0)).toBeNull();
  });

  it("複数あってもいちばん苦しんでいる1枚だけ(セットの流れを止めない)", () => {
    const cards = [card("mild", 6), card("worst", 20)];
    const log = [...logFor("mild", [false, false, true, true, true, false]), ...struggling("worst")];
    const found = findLeech(cards, log, T0);
    expect(found.id).toBe("worst");
  });

  it("失敗回数が同じなら正答率が低いほうを選ぶ", () => {
    const cards = [card("a", 6), card("b", 6)];
    const log = [
      ...logFor("a", [false, false, false, true, true, true]), // 0.5
      ...logFor("b", [false, false, false, false, false, true]), // 0.17
    ];
    expect(findLeech(cards, log, T0).id).toBe("b");
  });
});

describe("findLeechInSession — そのセットで触ったカードから探す", () => {
  it("セット外のカードは提案しない(目の前で落としたものについて言う)", () => {
    const cards = [card("inSet", 6), card("outSet", 30)];
    const log = [...struggling("inSet"), ...struggling("outSet")];
    expect(findLeechInSession(cards, log, ["inSet"], T0).id).toBe("inSet");
  });

  it("セット内に該当が無ければ null", () => {
    const cards = [card("clean", 0), card("bad", 30)];
    const log = [...struggling("bad")];
    expect(findLeechInSession(cards, log, ["clean"], T0)).toBeNull();
  });
});
