import { useState, useEffect, useMemo, useCallback } from "react";
import Home from "./components/Home.jsx";
import ReviewCard from "./components/ReviewCard.jsx";
import SessionComplete from "./components/SessionComplete.jsx";
import AddCards from "./components/AddCards.jsx";
import CardList from "./components/CardList.jsx";
import Settings from "./components/Settings.jsx";
import { makeSeedCards } from "./data/seedCards.js";
import { rate, isDue, buildQueue, isActive } from "./lib/scheduler.js";
import { makeLogEntry, appendReview } from "./lib/reviewLog.js";
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
} from "./lib/session.js";
import { makeCollection } from "./lib/migrations.js";
import { deriveStats } from "./lib/stats.js";
import { useNow } from "./lib/useNow.js";
import { normalizeSettings } from "./lib/settings.js";
import { dailyLimit, isDayComplete, nextSetSize } from "./lib/dailyBudget.js";
import { applyDormancy } from "./lib/dormancy.js";
import { findLeechInSession, snooze } from "./lib/leech.js";
import { parseImportHash, clearImportHash } from "./lib/importLink.js";
import { loadDb, saveDb, emptyDb } from "./lib/storage.js";
import { useSync } from "./lib/sync/useSync.js";

// 初回起動: 空のDBを作り、シード10枚を既定のコレクションへ入れる。
// 空のアプリを見せない(SPEC §4.7 / 層Aの「これだけやって、これ?」回避)。
function initialDb() {
  const db = emptyDb();
  return { ...db, cards: makeSeedCards(db.activeCollectionId) };
}

// 取り込みリンク(T-29)。フラグメントはサーバに送られないので、
// カードの中身はブラウザの外に出ない
const initialImport = typeof location !== "undefined" ? parseImportHash(location.hash) : null;

export default function App() {
  const [db, setDb] = useState(() => loadDb() ?? initialDb());
  const [pendingImport, setPendingImport] = useState(initialImport);
  const [view, setView] = useState(initialImport ? "add" : "home"); // home | session | complete | add | list | settings
  const [session, setSession] = useState(null);
  const [comboPulse, setComboPulse] = useState(0);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);

  // ホームにいる間だけ「今」を刻む。期限が来たら文言とボタンが自動で変わる(D-7)
  const now = useNow(view === "home");

  // 読んだらフラグメントを消す。残すとリロードのたびに取り込み画面が開く
  useEffect(() => {
    if (initialImport) clearImportHash();
  }, []);

  // アプリを開いたまま別のリンクを踏んだときも拾う
  useEffect(() => {
    const onHash = () => {
      const text = parseImportHash(location.hash);
      if (!text) return;
      clearImportHash();
      setPendingImport(text);
      setView("add");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 波括弧は必須。saveDb は成否の真偽値を返すので、そのまま返すと
  // React がクリーンアップ関数と誤認して "destroy is not a function" で落ちる。
  useEffect(() => {
    saveDb(db);
  }, [db]);

  // 同期(T-20 / T-21)。**ここで await しない。** ローカルが常に正で、
  // 同期は後追い。ログインしていなければ何も起きない(原則6)
  const sync = useSync(db, setDb);

  const { cards, collections, activeCollectionId, reviewLog } = db;
  const settings = normalizeSettings(db.settings);

  // 統計はログから数え直す。累積値を持たないので、同期で合流しても
  // 二重に増えたり片方が消えたりしない(stats.js)
  const stats = useMemo(() => deriveStats(reviewLog, db.statsBase), [reviewLog, db.statsBase]);

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

  const dueCount = useMemo(() => activeCards.filter((c) => isDue(c.state, now)).length, [activeCards, now]);

  // 今日の分をやり切ったか(T-28)。溜まっていても「終わり」が来るようにする
  const dayDone = useMemo(() => isDayComplete(reviewLog, settings, now), [reviewLog, settings, now]);

  // 次のセットを組めるか。予算切れ、または期限ゼロかつ先取りも冷却中だと組めない
  const canStart = useMemo(
    () => !dayDone && buildQueue(activeCards, settings.setSize, now).length > 0,
    [dayDone, activeCards, settings.setSize, now]
  );

  // 上限や冷却を無視すれば回せるか。「それでも続ける」を出すかの判定に使う。
  const canPush = useMemo(
    () => buildQueue(activeCards, settings.setSize, now, { ignoreCooldown: true }).length > 0,
    [activeCards, settings.setSize, now]
  );

  // ignoreCooldown は「それでも続ける」を押したときだけ真。上限も一緒に無視する。
  const startSession = useCallback(
    (ignoreCooldown = false) => {
      const at = Date.now();
      // 抱えきれないぶんを寝かせてからキューを組む(T-15)。
      // セット開始時にだけ走らせる — 画面を開くたびに動かすと落ち着かない
      const limit = dailyLimit(settings);
      const adjusted = applyDormancy(db.cards, { dailyLimit: limit, now: at });

      const pool = adjusted.filter((c) => isActive(c) && c.collectionId === activeCollectionId);
      const size = ignoreCooldown ? settings.setSize : nextSetSize(db.reviewLog, settings, at);
      const picked = buildQueue(pool, size, at, { ignoreCooldown });
      if (picked.length === 0) return;

      if (adjusted !== db.cards) setDb((prev) => ({ ...prev, cards: adjusted }));
      setSession(createSession(picked, { relearnInSet: settings.relearnInSet }));
      setConfirmAbort(false);
      setView("session");
    },
    [db.cards, db.reviewLog, activeCollectionId, settings]
  );

  const handleRate = useCallback(
    (good) => {
      if (!session) return;
      const cardId = currentCardId(session);
      if (!cardId) return;

      const reviewedAt = Date.now();
      const nextSession = rateSession(session, good);
      const finished = isComplete(nextSession);

      setDb((prev) => {
        const card = prev.cards.find((c) => c.id === cardId);
        if (!card) return prev;

        // 1レビュー = 1エントリ。FSRS移行(T-08)とリーチカード検出(T-09)の
        // 原資であり、同期(T-21)のマージ単位でもある。
        const entry = makeLogEntry(card, good, reviewedAt);

        // 統計はここでは触らない。ログに1件積めば導出側が拾う。
        // セットを完走しなくても記録が残る(差異 D-8)のは変わらない
        return appendReview(
          {
            ...prev,
            cards: prev.cards.map((c) =>
              c.id === cardId ? { ...c, state: rate(c.state, good, reviewedAt), updatedAt: reviewedAt } : c
            ),
          },
          entry
        );
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

  const handleUpdateCard = useCallback((id, fields) => {
    const now = Date.now();
    setDb((prev) => ({
      ...prev,
      cards: prev.cards.map((c) => (c.id === id ? { ...c, ...fields, updatedAt: now } : c)),
    }));
  }, []);

  // ソフト削除。配列からは消さない — 同期(T-21)で削除を伝えるtombstoneになる
  const handleDeleteCard = useCallback((id) => {
    const now = Date.now();
    setDb((prev) => ({
      ...prev,
      cards: prev.cards.map((c) => (c.id === id ? { ...c, deletedAt: now, updatedAt: now } : c)),
    }));
  }, []);

  // settingsUpdatedAt は同期の新旧判定用。設定はログではないので
  // タイムスタンプが無いとどちらが新しいか決められない
  const handleSettings = useCallback((patch) => {
    setDb((prev) => ({
      ...prev,
      settings: normalizeSettings({ ...normalizeSettings(prev.settings), ...patch }),
      settingsUpdatedAt: Date.now(),
    }));
  }, []);

  const handleAddCollection = useCallback((name) => {
    const col = makeCollection({ name });
    setDb((prev) => ({ ...prev, collections: [...prev.collections, col], activeCollectionId: col.id }));
  }, []);

  const handleRenameCollection = useCallback((id, patch) => {
    const now = Date.now();
    setDb((prev) => ({
      ...prev,
      collections: prev.collections.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: now } : c)),
    }));
  }, []);

  const handleSelectCollection = useCallback((id) => {
    setDb((prev) => ({ ...prev, activeCollectionId: id }));
  }, []);

  // リーチカード(T-09)。そのセットで触ったカードの中から最大1枚だけ提案する
  const leech = useMemo(
    () => (view === "complete" && session ? findLeechInSession(activeCards, reviewLog, session.cardIds) : null),
    [view, session, activeCards, reviewLog]
  );

  // 「このままでいい」— 一定期間は黙る。何度も同じ提案をされるほうが苦しい
  const handleKeepLeech = useCallback((id) => {
    setDb((prev) => ({ ...prev, cards: prev.cards.map((c) => (c.id === id ? snooze(c) : c)) }));
  }, []);

  // 「分解する」— 編集画面をそのカードで開く。割る作業自体は人間がやる
  const handleBreakDownLeech = useCallback((id) => {
    setEditingCardId(id);
    setView("list");
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
          {view === "home" && (
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {/* コレクション名。切り替えは設定の中(ホームに一覧を出すと原則3が崩れる) */}
              {collections.filter((c) => !c.deletedAt).length > 1 && (
                <span style={{ fontSize: 12, color: "var(--faint)", fontWeight: 700 }}>{activeCollection?.name}</span>
              )}
              <button onClick={() => { setEditingCardId(null); setView("list"); }} style={headerBtn}>カード</button>
              <button onClick={() => setView("settings")} style={headerBtn}>設定</button>
            </div>
          )}
          {view === "session" && (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* 中断導線(D-8)。誤タップで抜けないよう二段階にする */}
              <button
                onClick={() => {
                  if (confirmAbort) {
                    setConfirmAbort(false);
                    setView("home");
                  } else {
                    setConfirmAbort(true);
                    setTimeout(() => setConfirmAbort(false), 3000);
                  }
                }}
                style={{ ...headerBtn, color: confirmAbort ? "var(--red)" : "var(--faint)" }}
              >
                {confirmAbort ? "本当にやめる?" : "やめる"}
              </button>
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
            canPush={canPush}
            dayDone={dayDone}
            stats={stats}
            onStart={() => startSession(false)}
            onPush={() => startSession(true)}
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
            canPush={canPush}
            dayDone={dayDone}
            leech={leech}
            onRestart={() => startSession(false)}
            onPush={() => startSession(true)}
            onBreakDownLeech={handleBreakDownLeech}
            onDeleteLeech={handleDeleteCard}
            onKeepLeech={handleKeepLeech}
            onHome={() => setView("home")}
          />
        )}

        {view === "add" && (
          <AddCards
            key={pendingImport ? "import" : "add"}
            collectionId={activeCollectionId}
            promptLabel={activeCollection?.promptLabel}
            initialText={pendingImport ?? ""}
            onAdd={handleAddCards}
            onBack={() => {
              setPendingImport(null);
              setView("home");
            }}
          />
        )}

        {view === "list" && (
          <CardList
            key={editingCardId ?? "list"}
            cards={activeCards}
            promptLabel={activeCollection?.promptLabel}
            initialEditingId={editingCardId}
            onUpdate={handleUpdateCard}
            onDelete={handleDeleteCard}
            onBack={() => {
              setEditingCardId(null);
              setView("home");
            }}
          />
        )}

        {view === "settings" && (
          <Settings
            db={db}
            settings={settings}
            collections={collections}
            activeCollectionId={activeCollectionId}
            sync={sync}
            onChange={handleSettings}
            onReplaceDb={setDb}
            onSelectCollection={handleSelectCollection}
            onAddCollection={handleAddCollection}
            onRenameCollection={handleRenameCollection}
            onBack={() => setView("home")}
          />
        )}
      </div>
    </div>
  );
}

const headerBtn = {
  border: "none",
  background: "transparent",
  color: "var(--dim)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
  fontFamily: "inherit",
};
