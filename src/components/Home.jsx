export default function Home({ dueCount, totalCards, canStart, stats, onStart, onAddCards }) {
  const hasDue = dueCount > 0;
  const empty = totalCards === 0;
  // 期限も無く、先取りの持ち駒も冷却中(T-04)。「ひと区切り」を出す状態。
  // 同じカードを続けて回させるより、終わったと言えるほうがいい(原則3)。
  const paused = !empty && !canStart;
  const disabled = empty || paused;

  const headline = empty ? "はじめよう" : hasDue ? "今日の5分、やる?" : paused ? "今日はここまで" : "今日の分は完了!";
  const subline = empty
    ? "まずはカードを追加しよう。"
    : hasDue
    ? "ちょうど思い出しどきのカードを1セットだけ用意した。"
    : paused
    ? "今できることは全部やった。少し寝かせたほうがよく定着する。"
    : "先取りで軽く1セット回すこともできる。";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", animation: "riseIn .3s ease both" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "var(--dim)", fontWeight: 600, marginBottom: 10 }}>
          {stats.streak > 1 ? `🔥 ${stats.streak}日連続` : "おかえり"}
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.4, marginBottom: 14 }}>{headline}</div>
        <div style={{ fontSize: 14, color: "var(--faint)", lineHeight: 1.7, maxWidth: 260, marginBottom: 36 }}>
          {subline}
        </div>

        <button
          onClick={onStart}
          disabled={disabled}
          style={{
            padding: "18px 52px",
            borderRadius: 18,
            border: "none",
            background: disabled ? "#262a3a" : "linear-gradient(135deg, var(--violet), #6c5ce7)",
            color: disabled ? "var(--faint)" : "#fff",
            fontSize: 17,
            fontWeight: 800,
            cursor: disabled ? "default" : "pointer",
            boxShadow: disabled ? "none" : "0 10px 34px rgba(139,124,255,.32)",
          }}
        >
          {hasDue ? "セット開始" : paused ? "また後で" : "先取り練習"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <StatChip label="総レビュー" value={stats.totalReviews} />
        <StatChip label="定着率" value={stats.totalReviews > 0 ? `${Math.round((stats.totalCorrect / stats.totalReviews) * 100)}%` : "—"} />
        <StatChip label="ベストコンボ" value={stats.bestCombo > 0 ? `⚡${stats.bestCombo}` : "—"} />
      </div>

      <button
        onClick={onAddCards}
        style={{ marginTop: 12, padding: "14px 0", borderRadius: 14, border: "1px solid var(--edge)", background: "transparent", color: "var(--dim)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
      >
        ＋ カードを追加 ({totalCards}枚)
      </button>
    </div>
  );
}

function StatChip({ label, value }) {
  return (
    <div style={{ flex: 1, borderRadius: 14, border: "1px solid var(--edge)", background: "var(--card-2)", padding: "12px 0", textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--faint)", fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
}
