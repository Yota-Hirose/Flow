export default function SessionComplete({ correct, total, bestCombo, streak, onRestart, onHome }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", animation: "riseIn .5s ease both" }}>
      <svg width="130" height="130" viewBox="0 0 120 120" style={{ marginBottom: 22 }}>
        <circle cx="60" cy="60" r="48" fill="none" stroke="#262a3a" strokeWidth="9" />
        <circle
          cx="60" cy="60" r="48" fill="none"
          stroke="var(--mint)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={302}
          strokeDashoffset={302 - (302 * correct) / Math.max(1, total)}
          transform="rotate(-90 60 60)"
          style={{ animation: "ringIn 1s cubic-bezier(.2,.8,.3,1) both", filter: "drop-shadow(0 0 8px rgba(124,231,196,.4))" }}
        />
        <text x="60" y="57" textAnchor="middle" fill="var(--ink)" fontSize="26" fontWeight="800" style={{ fontVariantNumeric: "tabular-nums" }}>
          {correct}/{total}
        </text>
        <text x="60" y="76" textAnchor="middle" fill="var(--dim)" fontSize="10" fontWeight="600">
          守った知識
        </text>
      </svg>

      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>セット完了!</div>
      <div style={{ fontSize: 14, color: "var(--dim)", lineHeight: 1.7, marginBottom: 6 }}>
        ベストコンボ <span style={{ color: "var(--gold)", fontWeight: 800 }}>⚡{bestCombo}</span>
        {streak > 1 && (
          <span style={{ marginLeft: 12 }}>
            連続 <span style={{ color: "var(--violet)", fontWeight: 800 }}>{streak}日</span>
          </span>
        )}
      </div>
      <div style={{ fontSize: 13, color: "var(--faint)", marginBottom: 30, maxWidth: 280, lineHeight: 1.7 }}>
        {correct === total
          ? "全問クリア。この単語たちはもう君のもの。"
          : `外した${total - correct}枚は、ちょうどいいタイミングで戻ってくる。`}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onHome}
          style={{ padding: "15px 26px", borderRadius: 16, border: "1px solid var(--edge)", background: "transparent", color: "var(--dim)", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
        >
          ホームへ
        </button>
        <button
          onClick={onRestart}
          style={{ padding: "15px 34px", borderRadius: 16, border: "none", background: "linear-gradient(135deg, var(--violet), #6c5ce7)", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: "0 8px 28px rgba(139,124,255,.27)" }}
        >
          もう1セット
        </button>
      </div>
    </div>
  );
}
