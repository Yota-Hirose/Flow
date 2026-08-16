import { describe, it, expect } from "vitest";
import { makeLogEntry, appendLog, mergeLogs, rebuildState, logsByCard, MAX_LOG_ENTRIES } from "../reviewLog.js";
import { newCardState, rate } from "../scheduler.js";

const T0 = 1_700_000_000_000;
const MIN = 60 * 1000;

const card = (id = "c1", state = newCardState(T0)) => ({ id, state });

describe("makeLogEntry", () => {
  it("カードID・時刻・正誤・評価前の間隔を記録する", () => {
    const c = card("c1", { ...newCardState(T0), interval: 8 });
    const e = makeLogEntry(c, true, T0 + MIN);
    expect(e).toMatchObject({ cardId: "c1", ts: T0 + MIN, good: true, intervalBefore: 8 });
    expect(e.id).toMatch(/^[0-9a-f]{8}-/);
  });

  it("エントリごとにIDが一意(マージ時の重複判定に使う)", () => {
    const c = card();
    const ids = new Set(Array.from({ length: 100 }, () => makeLogEntry(c, true, T0).id));
    expect(ids.size).toBe(100);
  });
});

describe("appendLog", () => {
  it("追記専用で、元の配列を破壊しない", () => {
    const log = [];
    const next = appendLog(log, makeLogEntry(card(), true, T0));
    expect(log).toHaveLength(0);
    expect(next).toHaveLength(1);
  });

  it("上限を超えたら古いものから捨てる(localStorage枯渇の予防)", () => {
    let log = [];
    for (let i = 0; i < 15; i++) log = appendLog(log, makeLogEntry(card(), true, T0 + i), 10);
    expect(log).toHaveLength(10);
    expect(log[0].ts).toBe(T0 + 5); // 古い5件が落ちている
    expect(log[9].ts).toBe(T0 + 14);
  });

  it("既定の上限が設定されている", () => {
    expect(MAX_LOG_ENTRIES).toBeGreaterThan(0);
  });
});

describe("mergeLogs — 同期の衝突解決", () => {
  it("2端末のログを時刻順に束ねる", () => {
    const c = card();
    const a = [makeLogEntry(c, true, T0 + 1), makeLogEntry(c, false, T0 + 3)];
    const b = [makeLogEntry(c, true, T0 + 2)];
    const merged = mergeLogs(a, b);
    expect(merged.map((e) => e.ts)).toEqual([T0 + 1, T0 + 2, T0 + 3]);
  });

  it("同じエントリが両方にあっても重複しない(冪等)", () => {
    const c = card();
    const shared = makeLogEntry(c, true, T0);
    const a = [shared, makeLogEntry(c, false, T0 + 1)];
    const b = [shared];
    expect(mergeLogs(a, b)).toHaveLength(2);
  });

  it("何度マージしても結果が変わらない", () => {
    const c = card();
    const a = [makeLogEntry(c, true, T0), makeLogEntry(c, false, T0 + 5)];
    const b = [makeLogEntry(c, true, T0 + 2)];
    const once = mergeLogs(a, b);
    expect(mergeLogs(once, b)).toEqual(once);
    expect(mergeLogs(once, once)).toEqual(once);
  });

  it("マージ順を入れ替えても同じ結果になる", () => {
    const c = card();
    const a = [makeLogEntry(c, true, T0), makeLogEntry(c, false, T0 + 5)];
    const b = [makeLogEntry(c, true, T0 + 2)];
    expect(mergeLogs(a, b)).toEqual(mergeLogs(b, a));
  });
});

describe("rebuildState — ログからカード状態を復元する", () => {
  it("逐次評価した結果と完全に一致する", () => {
    const answers = [true, true, false, true, true, true, false, true];
    let state = newCardState(T0);
    const log = [];
    let c = card("c1", state);

    answers.forEach((good, i) => {
      const ts = T0 + i * MIN;
      log.push(makeLogEntry(c, good, ts));
      state = rate(state, good, ts);
      c = card("c1", state);
    });

    expect(rebuildState(log, T0)).toEqual(state);
  });

  it("ログの並び順が崩れていても復元できる(同期後のマージを想定)", () => {
    const answers = [true, false, true, true];
    let state = newCardState(T0);
    const log = [];
    let c = card("c1", state);
    answers.forEach((good, i) => {
      const ts = T0 + i * MIN;
      log.push(makeLogEntry(c, good, ts));
      state = rate(state, good, ts);
      c = card("c1", state);
    });

    const shuffled = [log[2], log[0], log[3], log[1]];
    expect(rebuildState(shuffled, T0)).toEqual(state);
  });

  it("ログが空なら新規カードの状態", () => {
    expect(rebuildState([], T0)).toEqual(newCardState(T0));
  });

  it("失敗回数がログから正しく数え直される", () => {
    const c = card();
    const log = [
      makeLogEntry(c, false, T0),
      makeLogEntry(c, true, T0 + MIN),
      makeLogEntry(c, false, T0 + 2 * MIN),
      makeLogEntry(c, false, T0 + 3 * MIN),
    ];
    expect(rebuildState(log, T0).lapses).toBe(3);
  });
});

describe("logsByCard", () => {
  it("指定カードのエントリだけを取り出す", () => {
    const log = [
      makeLogEntry(card("a"), true, T0),
      makeLogEntry(card("b"), true, T0 + 1),
      makeLogEntry(card("a"), false, T0 + 2),
    ];
    expect(logsByCard(log, "a")).toHaveLength(2);
    expect(logsByCard(log, "z")).toHaveLength(0);
  });
});
