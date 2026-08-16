import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { loadDb, saveDb, dayKey } from "../storage.js";
import { emptyDb, SCHEMA_VERSION } from "../migrations.js";

const T0 = 1_700_000_000_000;

// localStorage の最小モック。容量超過も再現できるようにしてある。
function installStorage({ failOnSet = false } = {}) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (failOnSet) {
        const e = new Error("QuotaExceededError");
        e.name = "QuotaExceededError";
        throw e;
      }
      store.set(k, v);
    },
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

let store;
beforeEach(() => {
  store = installStorage();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.localStorage;
});

describe("loadDb", () => {
  it("何も保存されていなければ null(呼び出し側がシードで初期化する)", () => {
    expect(loadDb(T0)).toBeNull();
  });

  it("保存したDBをそのまま読み戻せる", () => {
    const db = emptyDb(T0);
    saveDb(db);
    expect(loadDb(T0)).toEqual(db);
  });

  it("旧キー(flow.cards.v1 / flow.stats.v1)から自動で移行する", () => {
    store.set(
      "flow.cards.v1",
      JSON.stringify([
        { id: "seed-0", hint: "比較", pre: "For a ", answer: "comparison", post: ".", note: "", src: "TD", createdAt: T0, state: { reps: 2, interval: 3, ease: 2.5, due: T0 } },
      ])
    );
    store.set("flow.stats.v1", JSON.stringify({ totalReviews: 9, totalCorrect: 7, bestCombo: 4, lastReviewDay: "2026-8-15", streak: 2 }));

    const db = loadDb(T0);
    expect(db.version).toBe(SCHEMA_VERSION);
    expect(db.cards).toHaveLength(1);
    expect(db.cards[0].state).toMatchObject({ reps: 2, due: T0 }); // dueは動かさない
    expect(db.cards[0].id).not.toBe("seed-0");
    expect(db.stats.totalReviews).toBe(9);
  });

  it("移行結果が新キーに書き込まれ、旧キーは復旧用に残る", () => {
    store.set("flow.cards.v1", JSON.stringify([]));
    loadDb(T0);
    expect(store.has("flow.db")).toBe(true);
    expect(store.has("flow.cards.v1")).toBe(true);
  });

  it("保存データが壊れていてもクラッシュせず null を返す", () => {
    store.set("flow.db", "{これはJSONではない");
    expect(loadDb(T0)).toBeNull();
  });

  it("旧キーが壊れていてもクラッシュしない", () => {
    store.set("flow.cards.v1", "こわれている");
    expect(loadDb(T0)).toBeNull();
  });

  it("localStorage が使えない環境でも落ちない", () => {
    delete globalThis.localStorage;
    expect(loadDb(T0)).toBeNull();
  });
});

describe("saveDb", () => {
  it("成功したら true", () => {
    expect(saveDb(emptyDb(T0))).toBe(true);
  });

  it("容量超過でも例外を投げず false を返す", () => {
    installStorage({ failOnSet: true });
    expect(saveDb(emptyDb(T0))).toBe(false);
  });
});

describe("dayKey", () => {
  it("同じ日なら同じキー、日が変われば変わる", () => {
    const noon = new Date(2026, 7, 16, 12, 0, 0).getTime();
    const evening = new Date(2026, 7, 16, 23, 59, 0).getTime();
    const nextDay = new Date(2026, 7, 17, 0, 1, 0).getTime();
    expect(dayKey(noon)).toBe(dayKey(evening));
    expect(dayKey(noon)).not.toBe(dayKey(nextDay));
  });
});
