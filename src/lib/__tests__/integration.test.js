// ------------------------------------------------------------------
// 通しの動作確認: 初回起動 → 1セット消化 → 保存 → 再読み込み。
// UIを介さずに、App.jsx が踏む経路と同じ順序でデータ層を動かす。
// ------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeSeedCards } from "../../data/seedCards.js";
import { emptyDb } from "../migrations.js";
import { loadDb, saveDb } from "../storage.js";
import { rate, buildQueue, isActive, RECENT_REVIEW_COOLDOWN_MS } from "../scheduler.js";
import { makeLogEntry, appendLog, rebuildState, logsByCard } from "../reviewLog.js";
import { parseCardLines } from "../parser.js";
import { createSession, currentCardId, isComplete, rateSession, securedCount } from "../session.js";

const T0 = 1_700_000_000_000;

function installStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  installStorage();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.localStorage;
});

function initialDb(now = T0) {
  const db = emptyDb(now);
  return { ...db, cards: makeSeedCards(db.activeCollectionId, now) };
}

describe("初回起動", () => {
  it("シード10枚が既定のコレクションに入り、全部が期限到来している", () => {
    const db = initialDb();
    expect(db.cards).toHaveLength(10);
    expect(db.cards.every((c) => c.collectionId === db.activeCollectionId)).toBe(true);
    expect(buildQueue(db.cards, 10, T0)).toHaveLength(10);
  });

  it("シードのIDが端末ごとに異なる(旧 seed-0 の衝突問題の解消)", () => {
    const a = initialDb();
    const b = initialDb();
    const idsA = new Set(a.cards.map((c) => c.id));
    expect(b.cards.some((c) => idsA.has(c.id))).toBe(false);
  });
});

describe("1セット消化して保存・再読み込み", () => {
  it("評価結果とログが保存され、リロード後も一致する", () => {
    let db = initialDb();
    const queue = buildQueue(db.cards, 10, T0).map((c) => c.id);
    const answers = [true, true, false, true, true, false, true, true, true, true];

    queue.forEach((cardId, i) => {
      const now = T0 + i * 1000;
      const card = db.cards.find((c) => c.id === cardId);
      const entry = makeLogEntry(card, answers[i], now);
      db = {
        ...db,
        cards: db.cards.map((c) =>
          c.id === cardId ? { ...c, state: rate(c.state, answers[i], now), updatedAt: now } : c
        ),
        reviewLog: appendLog(db.reviewLog, entry),
      };
    });

    expect(db.reviewLog).toHaveLength(10);
    saveDb(db);
    expect(loadDb(T0)).toEqual(db);
  });

  it("失敗したカードは lapses が増え、10分後に再出題される", () => {
    let db = initialDb();
    const target = db.cards[0];
    const now = T0 + 5000;
    db = { ...db, cards: db.cards.map((c) => (c.id === target.id ? { ...c, state: rate(c.state, false, now) } : c)) };
    const after = db.cards[0];
    expect(after.state.lapses).toBe(1);
    expect(after.state.due).toBe(now + 10 * 60 * 1000);
  });

  it("ログからカード状態を再構築すると、逐次評価の結果と一致する(同期の前提)", () => {
    let db = initialDb();
    const cardId = db.cards[0].id;
    const answers = [true, false, true, true];

    answers.forEach((good, i) => {
      const now = T0 + i * 60000;
      const card = db.cards.find((c) => c.id === cardId);
      db = {
        ...db,
        cards: db.cards.map((c) => (c.id === cardId ? { ...c, state: rate(c.state, good, now) } : c)),
        reviewLog: appendLog(db.reviewLog, makeLogEntry(card, good, now)),
      };
    });

    const stored = db.cards.find((c) => c.id === cardId);
    const rebuilt = rebuildState(logsByCard(db.reviewLog, cardId), stored.createdAt);
    expect(rebuilt).toEqual(stored.state);
  });
});

describe("1セットの通し (T-04)", () => {
  // App.jsx の handleRate と同じ順序でデータ層を動かす
  function runSet(db, answers, startAt = T0) {
    let session = createSession(buildQueue(db.cards, 10, startAt));
    let step = 0;
    while (!isComplete(session) && step < answers.length) {
      const cardId = currentCardId(session);
      const now = startAt + step * 1000;
      const card = db.cards.find((c) => c.id === cardId);
      const good = answers[step];

      db = {
        ...db,
        cards: db.cards.map((c) =>
          c.id === cardId ? { ...c, state: rate(c.state, good, now), updatedAt: now } : c
        ),
        reviewLog: appendLog(db.reviewLog, makeLogEntry(card, good, now)),
      };
      session = rateSession(session, good);
      step++;
    }
    return { db, session };
  }

  it("落としても同セット内では戻らず、枚数ぶんのタップで終わる", () => {
    const base = { ...emptyDb(T0), cards: makeSeedCards(emptyDb(T0).activeCollectionId, T0).slice(0, 3) };
    const { db, session } = runSet(base, [false, true, true]);

    expect(isComplete(session)).toBe(true);
    expect(session.attempts).toHaveLength(3); // 3枚 = 3タップ
    expect(securedCount(session)).toBe(2); // 落とした1枚は確保できていない
    expect(db.reviewLog).toHaveLength(3);
  });

  it("落としたカードは10分後に期限が来て、次のセットで戻ってくる", () => {
    const base = { ...emptyDb(T0), cards: makeSeedCards(emptyDb(T0).activeCollectionId, T0).slice(0, 3) };
    const { db, session } = runSet(base, [false, true, true]);
    const failedId = session.cardIds[0];
    const card = db.cards.find((c) => c.id === failedId);

    expect(card.state.lapses).toBe(1);
    expect(card.state.reps).toBe(0);
    expect(card.state.due).toBe(T0 + 10 * 60 * 1000);

    // 10分後には期限が来て、次のセットの先頭に並ぶ
    const later = T0 + 10 * 60 * 1000 + 1;
    expect(buildQueue(db.cards, 10, later).map((c) => c.id)).toEqual([failedId]);
  });

  it("完了直後に「もう1セット」を押しても、たった今のカードは出ない (D-2)", () => {
    const base = { ...emptyDb(T0), cards: makeSeedCards(emptyDb(T0).activeCollectionId, T0) };
    const { db } = runSet(base, Array(10).fill(true));

    // 10枚すべて触った直後。期限到来はゼロなので先取り練習に落ちる
    const nextPick = buildQueue(db.cards, 10, T0 + 20000);
    expect(nextPick).toHaveLength(0);
  });

  it("冷却時間が過ぎれば先取り練習で戻ってくる", () => {
    const base = { ...emptyDb(T0), cards: makeSeedCards(emptyDb(T0).activeCollectionId, T0) };
    const { db } = runSet(base, Array(10).fill(true));
    const later = T0 + RECENT_REVIEW_COOLDOWN_MS + 1;
    expect(buildQueue(db.cards, 10, later).length).toBeGreaterThan(0);
  });

  it("全部落としてもセットは10タップで終わる", () => {
    const base = { ...emptyDb(T0), cards: makeSeedCards(emptyDb(T0).activeCollectionId, T0) };
    const { session } = runSet(base, Array(200).fill(false));
    expect(isComplete(session)).toBe(true);
    expect(session.attempts.length).toBe(10);
    expect(securedCount(session)).toBe(0);
  });

  it("「それでも続ける」を押せば、冷却を無視して回せる", () => {
    const base = { ...emptyDb(T0), cards: makeSeedCards(emptyDb(T0).activeCollectionId, T0) };
    const { db } = runSet(base, Array(10).fill(true));
    const justAfter = T0 + 20000;

    // 既定では止まる(アプリからは促さない)
    expect(buildQueue(db.cards, 10, justAfter)).toHaveLength(0);
    // ユーザーが明示的に選べば回せる(原則3が禁じているのは"要求すること")
    expect(buildQueue(db.cards, 10, justAfter, { ignoreCooldown: true })).toHaveLength(10);
  });
});

describe("カード取り込み", () => {
  it("貼り付けたカードがアクティブなコレクションに入り、次のセットに出る", () => {
    let db = { ...emptyDb(T0), cards: [] };
    const { cards, errors } = parseCardLines(
      "【資料・書類】 I'll send the {{c1::document}} tomorrow.|仕事の定番",
      db.activeCollectionId,
      T0
    );
    expect(errors).toEqual([]);
    db = { ...db, cards: [...db.cards, ...cards] };

    const queue = buildQueue(db.cards, 10, T0);
    expect(queue).toHaveLength(1);
    expect(queue[0].collectionId).toBe(db.activeCollectionId);
  });
});

describe("ソフト削除", () => {
  it("削除したカードは出題されないが、tombstoneとして残る(同期用)", () => {
    let db = initialDb();
    const victim = db.cards[0].id;
    db = { ...db, cards: db.cards.map((c) => (c.id === victim ? { ...c, deletedAt: T0 + 1 } : c)) };

    expect(db.cards).toHaveLength(10); // 配列からは消えない
    expect(db.cards.filter(isActive)).toHaveLength(9);
    expect(buildQueue(db.cards, 10, T0).some((c) => c.id === victim)).toBe(false);

    saveDb(db);
    expect(loadDb(T0).cards).toHaveLength(10); // 保存・復元後も残る
  });
});
