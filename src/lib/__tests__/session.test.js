import { describe, it, expect } from "vitest";
import {
  createSession,
  currentCardId,
  isComplete,
  rateSession,
  progressSegments,
  securedCount,
  stumbledCount,
  bestComboOf,
  currentCombo,
  DEFAULT_RELEARN_GAP,
  STEPS_PER_CARD,
} from "../session.js";

const cards = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));

// 指定した正誤の並びでセッションを進める
function play(session, answers) {
  return answers.reduce((s, good) => rateSession(s, good), session);
}

describe("createSession", () => {
  it("渡されたカードの順にキューを組む", () => {
    const s = createSession(cards(3));
    expect(s.queue).toEqual(["c0", "c1", "c2"]);
    expect(currentCardId(s)).toBe("c0");
    expect(isComplete(s)).toBe(false);
  });

  it("打ち切り上限が枚数から決まる", () => {
    expect(createSession(cards(10)).maxSteps).toBe(10 * STEPS_PER_CARD);
  });

  it("上限を明示的に指定できる(設定から変更する前提 / T-24)", () => {
    expect(createSession(cards(10), { maxSteps: 12 }).maxSteps).toBe(12);
  });
});

describe("全問正解の流れ", () => {
  it("枚数ぶんの評価でセットが終わる", () => {
    const s = play(createSession(cards(3)), [true, true, true]);
    expect(isComplete(s)).toBe(true);
    expect(s.attempts).toHaveLength(3);
    expect(securedCount(s)).toBe(3);
    expect(stumbledCount(s)).toBe(0);
  });

  it("カードは順番どおりに出る", () => {
    let s = createSession(cards(3));
    const seen = [];
    while (!isComplete(s)) {
      seen.push(currentCardId(s));
      s = rateSession(s, true);
    }
    expect(seen).toEqual(["c0", "c1", "c2"]);
  });
});

describe("「まだ」の再出題 — D-1の解消", () => {
  it("失敗したカードが同じセット内でもう一度出る", () => {
    let s = createSession(cards(5));
    s = rateSession(s, false); // c0 を落とす
    expect(s.queue).toContain("c0");
    expect(isComplete(s)).toBe(false);
  });

  it("既定では2枚後ろに差し戻される", () => {
    let s = createSession(cards(5));
    s = rateSession(s, false); // c0
    expect(s.queue).toEqual(["c1", "c2", "c0", "c3", "c4"]);
    expect(DEFAULT_RELEARN_GAP).toBe(2);
  });

  it("キューが短ければ末尾に置かれ、必ず再出題される", () => {
    let s = createSession(cards(1));
    s = rateSession(s, false);
    expect(currentCardId(s)).toBe("c0");
    expect(isComplete(s)).toBe(false);
  });

  it("正解するまでセットが終わらない", () => {
    let s = createSession(cards(2));
    s = play(s, [false, true]); // c0を落とし、c1は正解
    expect(isComplete(s)).toBe(false); // c0がまだ残っている
    s = rateSession(s, true); // c0を取り返す
    expect(isComplete(s)).toBe(true);
    expect(securedCount(s)).toBe(2);
  });

  it("再出題しても、そのセットの「枚数」は増えない", () => {
    let s = createSession(cards(3));
    s = play(s, [false, true, true, true]);
    expect(s.cardIds).toHaveLength(3);
    expect(progressSegments(s)).toHaveLength(3);
    expect(s.attempts).toHaveLength(4); // 評価回数だけが増える
  });

  it("何度落としても最後に取り返せば確保できる", () => {
    let s = createSession(cards(2), { maxSteps: 99 });
    // c0を落とす → c1は正解 → c0をさらに2回落として、最後に取り返す
    s = play(s, [false, true, false, false, true]);
    expect(securedCount(s)).toBe(2);
    expect(stumbledCount(s)).toBe(1); // 引っかかったのはc0だけ
    expect(isComplete(s)).toBe(true);
  });
});

describe("打ち切り上限 — 原則3(小さな約束)を守る", () => {
  it("上限に達したらセットが終わる", () => {
    let s = createSession(cards(3), { maxSteps: 4 });
    s = play(s, [false, false, false, false]);
    expect(isComplete(s)).toBe(true);
    expect(s.steps).toBe(4);
  });

  it("上限に達したカードは差し戻されない(次のセットに回す)", () => {
    let s = createSession(cards(2), { maxSteps: 2 });
    s = rateSession(s, false); // c0を落とす → まだ上限前なので差し戻される
    expect(s.queue).toEqual(["c1", "c0"]);

    s = rateSession(s, false); // c1を落とす → ここで上限。差し戻さない
    expect(s.queue).toEqual(["c0"]); // c1は増えていない
    expect(isComplete(s)).toBe(true);
    expect(securedCount(s)).toBe(0); // 確保できたのは0枚。残りは次のセットへ
  });

  it("全部落とし続けても評価回数は上限で止まる", () => {
    let s = createSession(cards(10));
    let taps = 0;
    while (!isComplete(s) && taps < 500) {
      s = rateSession(s, false);
      taps++;
    }
    expect(taps).toBe(10 * STEPS_PER_CARD);
  });
});

describe("progressSegments — 進捗バーが再出題で破綻しない", () => {
  it("セグメント数は常にセットの枚数と同じ", () => {
    let s = createSession(cards(4));
    expect(progressSegments(s)).toHaveLength(4);
    s = play(s, [false, false, true]);
    expect(progressSegments(s)).toHaveLength(4);
  });

  it("現在のカードが current になる", () => {
    const s = createSession(cards(3));
    expect(progressSegments(s).map((x) => x.status)).toEqual(["current", "pending", "pending"]);
  });

  it("落としたカードは again、取り返すと good に戻る", () => {
    let s = createSession(cards(3));
    s = rateSession(s, false); // c0 → again
    expect(progressSegments(s).find((x) => x.id === "c0").status).toBe("again");

    s = play(s, [true, true, true]); // c1, c2, そして戻ってきた c0
    expect(progressSegments(s).find((x) => x.id === "c0").status).toBe("good");
  });

  it("バーの並びはセット中ずっと変わらない", () => {
    let s = createSession(cards(4));
    const order = progressSegments(s).map((x) => x.id);
    s = play(s, [false, false, true, true]);
    expect(progressSegments(s).map((x) => x.id)).toEqual(order);
  });
});

describe("コンボ", () => {
  it("連続正解で伸び、失敗でリセットされる", () => {
    let s = createSession(cards(6), { maxSteps: 99 });
    s = play(s, [true, true, true]);
    expect(currentCombo(s)).toBe(3);
    s = rateSession(s, false);
    expect(currentCombo(s)).toBe(0);
  });

  it("ベストコンボはセット中の最長連続", () => {
    const s = play(createSession(cards(8), { maxSteps: 99 }), [true, true, false, true, true, true, false]);
    expect(bestComboOf(s)).toBe(3);
    expect(currentCombo(s)).toBe(0);
  });

  it("評価が無ければ0", () => {
    expect(bestComboOf(createSession(cards(3)))).toBe(0);
  });
});

describe("不変性", () => {
  it("rateSession は元のセッションを破壊しない", () => {
    const s = createSession(cards(3));
    const before = structuredClone(s);
    rateSession(s, false);
    expect(s).toEqual(before);
  });

  it("完了後にさらに評価しても壊れない", () => {
    let s = play(createSession(cards(1)), [true]);
    expect(isComplete(s)).toBe(true);
    expect(rateSession(s, true)).toEqual(s);
  });
});
