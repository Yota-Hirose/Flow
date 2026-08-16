import { useState, useEffect, useMemo, useCallback } from "react";
import Home from "./components/Home.jsx";
import ReviewCard from "./components/ReviewCard.jsx";
import SessionComplete from "./components/SessionComplete.jsx";
import AddCards from "./components/AddCards.jsx";
import { makeSeedCards } from "./data/seedCards.js";
import { rate, isDue, buildQueue, isActive } from "./lib/scheduler.js";
import { makeLogEntry, appendLog } from "./lib/reviewLog.js";
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
  DEFAULT_SET_SIZE,
} from "./lib/session.js";
import { loadDb, saveDb, emptyDb, dayKey } from "./lib/storage.js";

// 「そのセットで触る"別々のカード"の枚数」。再出題では増えない(T-04)。
// 設定から変更できるようにするのは T-24。
const SET_SIZE = DEFAULT_SET_SIZE;

// 初回起動: 空のDBを作り、シード10枚を既定のコレクションへ入れる。
// 空のアプリを見せない(SPEC §4.7 / 層Aの「これだけやって、これ?」回避)。
function initialDb() {
  const db = emptyDb();
  return { ...db, cards: makeSeedCards(db.activeCollectionId) };
}

export default function App() {
  const [db, setDb] = useState(() => loadDb() ?? initialDb());
  const [view, setView] = useState("home"); // home | session | complete | add
  const [session, setSession] = useState(null);
  const [comboPulse, setComboPulse] = useState(0);

  // 波括弧は必須。saveDb は成否の真偽値を返すので、そのまま返すと
  // React がクリーンアップ関数と誤認して "destroy is not a function" で落ちる。
  useEffect(() => {
    saveDb(db);
  }, [db]);

  const { cards, stats, collections, activeCollectionId } = db;

  const activeCollection = useMemo(
    () => collections.find((c) => c.id === activeCollectionId) ?? collections[0],
    [collections, activeCollectionId]
  );

  // 出題対象はアクティブなコレクションの、生きているカードだけ(§4-7)。
  // 他コレクションの枚数・期限はどこにも表示しない(原則3)。
  const activeCards = useMemo(
    () => cards.filter((c) => isActive(c) && c.collectionId === activeCollectionId),
    [cards, activeCollectionId]
  );

  // NOTE: 時刻の経過では再計算されない(差異 D-7)。ライブ更新は T-07。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dueCount = useMemo(() => activeCards.filter((c) => isDue(c.state)).length, [activeCards, view]);

  // 次のセットを組めるか。期限ゼロかつ先取りの持ち駒も冷却中だと組めない(T-04)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const canStart = useMemo(() => buildQueue(activeCards, SET_SIZE).length > 0, [activeCards, view]);

  const startSession = useCallback(() => {
    const picked = buildQueue(activeCards, SET_SIZE);
    if (picked.length === 0) return;
    setSession(createSession(picked));
    setView("session");
  }, [activeCards]);

  const handleRate = useCallback(
    (good) => {
      if (!session) return;
      const cardId = currentCardId(session);
      if (!cardId) return;

      const now = Date.now();
      const nextSession = rateSession(session, good);
      const finished = isComplete(nextSession);

      setDb((prev) => {
        const card = prev.cards.find((c) => c.id === cardId);
        if (!card) return prev;

        // 1レビュー = 1エントリ。FSRS移行(T-08)とリーチカード検出(T-09)の
        // 原資であり、同期(T-21)のマージ単位でもある。
        const entry = makeLogEntry(card, good, now);

        const next = {
          ...prev,
          cards: prev.cards.map((c) =>
            c.id === cardId ? { ...c, state: rate(c.state, good, now), updatedAt: now } : c
          ),
          reviewLog: appendLog(prev.reviewLog, entry),
        };

        // NOTE: 統計はセット完走時にしか加算されない(差異 D-8)。
        // 逐次保存への変更と中断導線の追加は T-07。
        if (!finished) return next;

        const today = dayKey(now);
        const yesterday = dayKey(now - 86400000);
        const s = prev.stats;
        const streak =
          s.lastReviewDay === today ? s.streak
          : s.lastReviewDay === yesterday ? s.streak + 1
          : 1;

        return {
          ...next,
          stats: {
            // 再出題を含めた「実際にめくった回数」で数える。
            // 落としてから取り返したカードは 1失敗 + 1正解として記録される。
            totalReviews: s.totalReviews + nextSession.attempts.length,
            totalCorrect: s.totalCorrect + nextSession.attempts.filter((a) => a.good).length,
            bestCombo: Math.max(s.bestCombo, bestComboOf(nextSession)),
            lastReviewDay: today,
            streak,
          },
        };
      });

      setSession(nextSession);
      if (good) setComboPulse((p) => p + 1);
      if (finished) setView("complete");
    },
    [session]
  );

  const handleAddCards = useCallback((newCards) => {
    setDb((prev) => ({ ...prev, cards: [...prev.cards, ...newCards] }));
  }, []);

  const currentCard =
    view === "session" && session ? cards.find((c) => c.id === currentCardId(session)) : null;
  const segments = session ? progressSegments(session) : [];
  const combo = session ? currentCombo(session) : 0;

  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", overflow: "hidden" }}>
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", padding: "20px 20px 28px", position: "relative", minHeight: "100vh" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div
            onClick={() => view !== "session" && setView("home")}
            style={{ fontWeight: 800, letterSpacing: "0.16em", fontSize: 13, color: "var(--dim)", cursor: view !== "session" ? "pointer" : "default" }}
          >
            FLOW<span style={{ color: "var(--violet)" }}>.</span>
          </div>
          {view === "session" && (
            <div
              key={comboPulse}
              style={{
                fontSize: 13,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                color: combo >= 3 ? "var(--gold)" : "var(--dim)",
                animation: combo > 0 ? "pop .35s ease" : "none",
                textShadow: combo >= 5 ? "0 0 14px rgba(255,213,131,.53)" : "none",
              }}
            >
              {combo > 0 ? `⚡ ${combo} コンボ` : "今日の5分セット"}
            </div>
          )}
        </div>

        {/* progress — 1セグメント = 1枚。再出題では増減しない(T-04) */}
        {view === "session" && (
          <div style={{ display: "flex", gap: 4, marginBottom: 26 }}>
            {segments.map((seg) => (
              <div
                key={seg.id}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background:
                    seg.status === "good" ? "var(--mint)"
                    : seg.status === "again" ? "var(--red)"
                    : seg.status === "current" ? "var(--violet)"
                    : "#262a3a",
                  transition: "background .3s",
                }}
              />
            ))}
          </div>
        )}

        {view === "home" && (
          <Home
            dueCount={dueCount}
            totalCards={activeCards.length}
            canStart={canStart}
            stats={stats}
            onStart={startSession}
            onAddCards={() => setView("add")}
          />
        )}

        {view === "session" && currentCard && (
          <ReviewCard
            card={currentCard}
            promptLabel={activeCollection?.promptLabel}
            secured={securedCount(session)}
            total={session.cardIds.length}
            onRate={handleRate}
          />
        )}

        {view === "complete" && session && (
          <SessionComplete
            correct={securedCount(session)}
            total={session.cardIds.length}
            stumbled={stumbledCount(session)}
            bestCombo={bestComboOf(session)}
            streak={stats.streak}
            canRestart={canStart}
            onRestart={startSession}
            onHome={() => setView("home")}
          />
        )}

        {view === "add" && (
          <AddCards collectionId={activeCollectionId} onAdd={handleAddCards} onBack={() => setView("home")} />
        )}
      </div>
    </div>
  );
}
