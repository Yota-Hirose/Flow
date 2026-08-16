import { useState, useRef, useEffect, useCallback } from "react";

const SWIPE_THRESHOLD = 90;

export default function ReviewCard({ card, promptLabel, secured, total, onRate }) {
  const [revealed, setRevealed] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [flying, setFlying] = useState(null);
  const [particles, setParticles] = useState([]);
  const dragStart = useRef(null);
  const pid = useRef(0);

  useEffect(() => {
    setRevealed(false);
    setDragY(0);
    setFlying(null);
  }, [card.id]);

  const spawnParticles = useCallback(() => {
    const items = [];
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 110;
      items.push({
        id: pid.current++,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist - 40,
        size: 4 + Math.random() * 7,
        color: ["var(--mint)", "var(--violet)", "var(--gold)"][Math.floor(Math.random() * 3)],
        delay: Math.random() * 60,
      });
    }
    setParticles(items);
    setTimeout(() => setParticles([]), 900);
  }, []);

  const commit = useCallback(
    (good) => {
      if (flying) return;
      setFlying(good ? "up" : "down");
      if (navigator.vibrate) navigator.vibrate(good ? [18] : [8, 40, 8]);
      if (good) spawnParticles();
      setTimeout(() => onRate(good), 260);
    },
    [flying, onRate, spawnParticles]
  );

  const onPointerDown = (e) => {
    if (!revealed || flying) return;
    dragStart.current = e.clientY;
  };
  const onPointerMove = (e) => {
    if (dragStart.current === null || flying) return;
    setDragY(e.clientY - dragStart.current);
  };
  const onPointerUp = useCallback(() => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    setDragY((y) => {
      if (y < -SWIPE_THRESHOLD) commit(true);
      else if (y > SWIPE_THRESHOLD) commit(false);
      return y < -SWIPE_THRESHOLD || y > SWIPE_THRESHOLD ? y : 0;
    });
  }, [commit]);

  useEffect(() => {
    window.addEventListener("pointerup", onPointerUp);
    return () => window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerUp]);

  const flyOffset = flying === "up" ? -720 : flying === "down" ? 720 : 0;
  const y = flying ? flyOffset : dragY;
  const rot = flying ? (flying === "up" ? -7 : 7) : dragY * 0.04;
  const goodGlow = Math.max(0, Math.min(1, -dragY / SWIPE_THRESHOLD));
  const badGlow = Math.max(0, Math.min(1, dragY / SWIPE_THRESHOLD));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", touchAction: "none" }}>
      <div style={{ position: "absolute", top: -6, left: 0, right: 0, textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--mint)", opacity: revealed ? 0.25 + goodGlow * 0.75 : 0, transition: "opacity .15s", transform: `scale(${1 + goodGlow * 0.25})` }}>
        ↑ できた
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => !revealed && setRevealed(true)}
        style={{
          marginTop: 18,
          marginBottom: 18,
          flex: 1,
          minHeight: 340,
          borderRadius: 24,
          background: "linear-gradient(160deg, var(--card) 0%, var(--card-2) 100%)",
          border: `1px solid ${
            goodGlow > 0.05 ? `rgba(124,231,196,${0.25 + goodGlow * 0.6})`
            : badGlow > 0.05 ? `rgba(242,131,122,${0.25 + badGlow * 0.6})`
            : "var(--edge)"
          }`,
          boxShadow:
            goodGlow > 0.05
              ? `0 0 ${30 * goodGlow}px rgba(124,231,196,.28), 0 20px 50px rgba(0,0,0,.5)`
              : badGlow > 0.05
              ? `0 0 ${30 * badGlow}px rgba(242,131,122,.28), 0 20px 50px rgba(0,0,0,.5)`
              : "0 20px 50px rgba(0,0,0,.5)",
          padding: "30px 26px",
          display: "flex",
          flexDirection: "column",
          cursor: revealed ? "grab" : "pointer",
          transform: `translateY(${y}px) rotate(${rot}deg)`,
          transition: flying
            ? "transform .26s cubic-bezier(.5,0,.8,.4), opacity .26s"
            : dragStart.current !== null
            ? "none"
            : "transform .25s cubic-bezier(.2,.9,.3,1.2)",
          opacity: flying ? 0 : 1,
          position: "relative",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <div style={{ position: "absolute", left: "50%", top: "42%", pointerEvents: "none" }}>
          {particles.map((p) => (
            <span
              key={p.id}
              className="particle"
              style={{
                width: p.size,
                height: p.size,
                background: p.color,
                "--dx": `${p.x}px`,
                "--dy": `${p.y}px`,
                animationDelay: `${p.delay}ms`,
                boxShadow: `0 0 8px ${p.color}`,
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--faint)", letterSpacing: "0.08em", fontWeight: 600 }}>
          <span>{card.src || "マイカード"}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{secured} / {total}</span>
        </div>

        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 12, color: "var(--violet)", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>
            {promptLabel || "英語で言うと?"}
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.35 }}>{card.hint}</div>
        </div>

        <div style={{ marginTop: "auto", fontSize: 17, lineHeight: 1.75, color: "var(--dim)", fontWeight: 500 }}>
          {card.pre}
          {revealed ? (
            <span style={{ color: "var(--mint)", fontWeight: 800, borderBottom: "2px solid rgba(124,231,196,.33)", animation: "riseIn .3s ease both", display: "inline-block" }}>
              {card.answer}
            </span>
          ) : (
            <span style={{ display: "inline-block", minWidth: 90, borderBottom: "2px dashed var(--faint)", color: "transparent" }}>
              ____
            </span>
          )}
          {card.post}
        </div>

        <div style={{ marginTop: 18, minHeight: 38, fontSize: 13, lineHeight: 1.6, color: revealed ? "var(--dim)" : "transparent", animation: revealed ? "riseIn .35s .05s ease both" : "none" }}>
          {card.note}
        </div>

        {!revealed && (
          <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center", fontSize: 12, color: "var(--faint)", fontWeight: 600 }}>
            頭の中で答えてから、タップ
          </div>
        )}
      </div>

      <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--red)", opacity: revealed ? 0.25 + badGlow * 0.75 : 0, transition: "opacity .15s", transform: `scale(${1 + badGlow * 0.25})`, marginBottom: 8 }}>
        ↓ まだ
      </div>

      {revealed && !flying ? (
        <div style={{ display: "flex", gap: 10, animation: "riseIn .25s ease both" }}>
          <button
            onClick={() => commit(false)}
            style={{ flex: 1, padding: "14px 0", borderRadius: 14, border: "1px solid rgba(242,131,122,.27)", background: "transparent", color: "var(--red)", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
          >
            まだ
          </button>
          <button
            onClick={() => commit(true)}
            style={{ flex: 1.6, padding: "14px 0", borderRadius: 14, border: "none", background: "linear-gradient(135deg, var(--mint), #5bc9a8)", color: "#0a2018", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: "0 6px 22px rgba(124,231,196,.2)" }}
          >
            できた ↑
          </button>
        </div>
      ) : (
        <div style={{ height: 50 }} />
      )}
    </div>
  );
}
