import { useState, useEffect, useMemo, useCallback } from "react";
import Home from "./components/Home.jsx";
import ReviewCard from "./components/ReviewCard.jsx";
import SessionComplete from "./components/SessionComplete.jsx";
import AddCards from "./components/AddCards.jsx";
import { makeSeedCards } from "./data/seedCards.js";
import { rate, isDue, buildQueue } from "./lib/scheduler.js";
import { loadCards, saveCards, loadStats, saveStats, dayKey } from "./lib/storage.js";

const SET_SIZE = 10;

export default function App() {
  const [cards, setCards] = useState(() => loadCards() ?? makeSeedCards());
  const [stats, setStats] = useState(() => loadStats());
  const [view, setView] = useState("home"); // home | session | complete | add
  const [queue, setQueue] = useState([]);
  const [pos, setPos] = useState(0);
  const [results, setResults] = useState([]);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [comboPulse, setComboPulse] = useState(0);

  useEffect(() => saveCards(cards), [cards]);
  useEffect(() => saveStats(stats), [stats]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dueCount = useMemo(() => cards.filter((c) => isDue(c.state)).length, [cards, view]);

  const startSession = useCallback(() => {
    const q = buildQueue(cards, SET_SIZE);
    if (q.length === 0) return;
    setQueue(q.map((c) => c.id));
    setPos(0);
    setResults([]);
    setCombo(0);
    setBestCombo(0);
    setView("session");
  }, [cards]);

  const handleRate = useCallback(
    (good) => {
      const cardId = queue[pos];
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, state: rate(c.state, good) } : c))
      );
      const newResults = [...results, good];
      setResults(newResults);
      const newCombo = good ? combo + 1 : 0;
      const newBest = Math.max(bestCombo, newCombo);
      setCombo(newCombo);
      setBestCombo(newBest);
      if (good) setComboPulse((p) => p + 1);

      if (pos + 1 >= queue.length) {
        setStats((s) => {
          const today = dayKey();
          const yesterday = dayKey(Date.now() - 86400000);
          const streak =
            s.lastReviewDay === today ? s.streak
            : s.lastReviewDay === yesterday ? s.streak + 1
            : 1;
          return {
            totalReviews: s.totalReviews + queue.length,
            totalCorrect: s.totalCorrect + newResults.filter(Boolean).length,
            bestCombo: Math.max(s.bestCombo, newBest),
            lastReviewDay: today,
            streak,
          };
        });
        setView("complete");
      } else {
        setPos((p) => p + 1);
      }
    },
    [queue, pos, results, combo, bestCombo]
  );

  const handleAddCards = useCallback((newCards) => {
    setCards((prev) => [...prev, ...newCards]);
  }, []);

  const currentCard = view === "session" ? cards.find((c) => c.id === queue[pos]) : null;
  const correct = results.filter(Boolean).length;

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

        {/* progress (session only) */}
        {view === "session" && (
          <div style={{ display: "flex", gap: 4, marginBottom: 26 }}>
            {queue.map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background:
                    i < results.length ? (results[i] ? "var(--mint)" : "var(--red)")
                    : i === pos ? "var(--violet)"
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
            totalCards={cards.length}
            stats={stats}
            onStart={startSession}
            onAddCards={() => setView("add")}
          />
        )}

        {view === "session" && currentCard && (
          <ReviewCard
            card={currentCard}
            index={pos}
            total={queue.length}
            onRate={handleRate}
          />
        )}

        {view === "complete" && (
          <SessionComplete
            correct={correct}
            total={queue.length}
            bestCombo={bestCombo}
            streak={stats.streak}
            onRestart={startSession}
            onHome={() => setView("home")}
          />
        )}

        {view === "add" && (
          <AddCards onAdd={handleAddCards} onBack={() => setView("home")} />
        )}
      </div>
    </div>
  );
}
