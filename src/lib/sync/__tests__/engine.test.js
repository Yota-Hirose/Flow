import { describe, it, expect, vi } from "vitest";
import { syncOnce, sameContent, createSyncEngine, Status, conflictError, isConflict } from "../engine.js";
import { createMemoryServer } from "../memoryAdapter.js";
import { emptyDb } from "../../migrations.js";
import { makeCard } from "../../parser.js";
import { deriveStats } from "../../stats.js";
import { appendReview, makeLogEntry } from "../../reviewLog.js";
import { rate } from "../../scheduler.js";

const T0 = new Date(2026, 7, 16, 12, 0, 0).getTime();
const MIN = 60_000;

function device(name) {
  const db = emptyDb(T0);
  return {
    ...db,
    cards: [makeCard({ hint: "資料", pre: "the ", answer: "document", post: "." }, db.activeCollectionId, T0)],
    _name: name,
  };
}

// 1枚レビューした状態のDBを作る(App の handleRate と同じ手順)
function reviewOne(db, cardId, good, ts) {
  const card = db.cards.find((c) => c.id === cardId);
  return appendReview(
    {
      ...db,
      cards: db.cards.map((c) => (c.id === cardId ? { ...c, state: rate(c.state, good, ts), updatedAt: ts } : c)),
    },
    makeLogEntry(card, good, ts)
  );
}

describe("syncOnce — 初回", () => {
  it("サーバが空ならローカルをそのまま上げる", async () => {
    const server = createMemoryServer();
    const local = device("A");
    const res = await syncOnce({ adapter: server.connect(), local, now: T0 });
    expect(res.pushed).toBe(true);
    expect(server.db.cards).toHaveLength(1);
  });

  it("2回目は中身が同じなら送らない — 無駄な通信をしない", async () => {
    const server = createMemoryServer();
    const a = server.connect();
    const local = device("A");
    const first = await syncOnce({ adapter: a, local, now: T0 });
    const second = await syncOnce({ adapter: a, local: first.db, rev: first.rev, now: T0 });
    expect(second.pushed).toBe(false);
    expect(server.calls.push).toBe(1);
  });
});

describe("syncOnce — 2端末", () => {
  it("端末Bが端末Aのカードを受け取る", async () => {
    const server = createMemoryServer();
    const a = device("A");
    await syncOnce({ adapter: server.connect(), local: a, now: T0 });

    const b = emptyDb(T0);
    const res = await syncOnce({ adapter: server.connect(), local: b, now: T0 + MIN });
    expect(res.db.cards.some((c) => c.answer === "document")).toBe(true);
  });

  it("両方のレビューが合算される — 学習の実績が消えない", async () => {
    const server = createMemoryServer();
    const base = device("A");
    const id = base.cards[0].id;

    // 端末Aで2回
    let a = reviewOne(base, id, true, T0);
    a = reviewOne(a, id, true, T0 + 60 * MIN);
    const ra = await syncOnce({ adapter: server.connect(), local: a, now: T0 });

    // 端末Bは同期前の状態から1回(オフラインで進めたケース)
    const b = reviewOne(base, id, true, T0 + 30 * MIN);
    const rb = await syncOnce({ adapter: server.connect(), local: b, now: T0 + 120 * MIN });

    expect(rb.db.reviewLog).toHaveLength(3);
    expect(deriveStats(rb.db.reviewLog, rb.db.statsBase).totalReviews).toBe(3);
    // 3回ぶんの学習が state に効いている(合流ログから作り直した結果)
    expect(rb.db.cards.find((c) => c.id === id).state.reps).toBeGreaterThanOrEqual(3);

    // 端末Aが受け取り直しても同じ内容に収束する
    const back = await syncOnce({ adapter: server.connect(), local: ra.db, rev: ra.rev, now: T0 + 130 * MIN });
    expect(back.db.reviewLog.map((e) => e.id).sort()).toEqual(rb.db.reviewLog.map((e) => e.id).sort());
  });

  it("何度往復させても収束したまま — 冪等", async () => {
    const server = createMemoryServer();
    const a = server.connect();
    const b = server.connect();
    let dbA = device("A");
    let dbB = emptyDb(T0);

    for (let i = 0; i < 4; i++) {
      const ra = await syncOnce({ adapter: a, local: dbA, now: T0 });
      dbA = ra.db;
      const rb = await syncOnce({ adapter: b, local: dbB, now: T0 });
      dbB = rb.db;
    }
    expect(sameContent(dbA, dbB)).toBe(true);
  });
});

describe("syncOnce — 競合", () => {
  it("他端末が先に書いていたら pull し直して畳み直す", async () => {
    const server = createMemoryServer();
    const a = server.connect();
    const base = device("A");
    const first = await syncOnce({ adapter: a, local: base, now: T0 });

    // 別端末が割り込んで書く
    const other = server.connect();
    const b = reviewOne(base, base.cards[0].id, true, T0 + MIN);
    await syncOnce({ adapter: other, local: b, now: T0 + MIN });

    // 古い rev で押し込む → CONFLICT → 自動で畳み直して成功する
    const local = reviewOne(first.db, base.cards[0].id, false, T0 + 2 * MIN);
    const res = await syncOnce({ adapter: a, local, rev: first.rev, now: T0 + 3 * MIN });
    expect(res.pushed).toBe(true);
    expect(res.db.reviewLog).toHaveLength(2); // どちらのレビューも残っている
  });

  it("延々と競合し続ければ諦めて投げる(無限ループにしない)", async () => {
    const adapter = {
      isSignedIn: () => true,
      pull: async () => ({ db: emptyDb(T0), rev: 1 }),
      push: async () => {
        throw conflictError();
      },
    };
    await expect(syncOnce({ adapter, local: device("A"), now: T0 })).rejects.toSatisfy(isConflict);
  });
});

describe("createSyncEngine — 送るタイミング", () => {
  it("未ログインなら何もしない(異常ではない)", async () => {
    const server = createMemoryServer();
    const adapter = server.connect({ signedIn: false });
    const seen = [];
    const engine = createSyncEngine({ adapter, getDb: () => device("A"), onStatus: (s) => seen.push(s.status), debounceMs: 1 });
    engine.request();
    await engine.flush();
    expect(seen).toContain(Status.OFF);
    expect(server.calls.push).toBe(0);
  });

  it("連続した変更をまとめて1回で送る", async () => {
    vi.useFakeTimers();
    const server = createMemoryServer();
    const engine = createSyncEngine({ adapter: server.connect(), getDb: () => device("A"), debounceMs: 100 });
    engine.request();
    engine.request();
    engine.request();
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    expect(server.calls.push).toBe(1);
  });

  it("合流結果をアプリへ戻す", async () => {
    const server = createMemoryServer();
    await syncOnce({ adapter: server.connect(), local: device("A"), now: T0 });

    let got = null;
    const engine = createSyncEngine({
      adapter: server.connect(),
      getDb: () => emptyDb(T0),
      onDb: (db) => (got = db),
      debounceMs: 1,
    });
    await engine.flush();
    expect(got.cards.some((c) => c.answer === "document")).toBe(true);
  });

  it("失敗しても投げない — レビューは止まらない", async () => {
    const adapter = {
      isSignedIn: () => true,
      pull: async () => {
        throw new Error("network down");
      },
      push: async () => ({ rev: 1 }),
    };
    const seen = [];
    const engine = createSyncEngine({ adapter, getDb: () => device("A"), onStatus: (s) => seen.push(s.status), debounceMs: 1 });
    await expect(engine.flush()).resolves.toBeUndefined();
    expect(seen).toContain(Status.ERROR);
  });
});
