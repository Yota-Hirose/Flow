export default function Home({ dueCount, totalCards, canStart, canPush, dayDone, stats, onStart, onPush, onAddCards }) {
  const hasDue = dueCount > 0;
  const empty = totalCards === 0;
  // 期限も無く、先取りの持ち駒も冷却中(T-04)。「ひと区切り」を出す状態。
  // 同じカードを続けて回させるより、終わったと言えるほうがいい(原則3)。
  const paused = !empty && !canStart;
  const disabled = empty || paused;
  // 予算を使い切った状態(T-28)。溜まっていてもここで区切りが付く
  const budgetDone = paused && dayDone;

  const headline =
    empty ? "はじめよう"
    : hasDue && canStart ? "今日の5分、やる?"
    : budgetDone ? "今日の分は終わり"
    : paused ? "今日はここまで"
    : "今日の分は完了!";

  const subline =
    empty ? "まずはカードを追加しよう。"
    : hasDue && canStart ? "ちょうど思い出しどきのカードを1セットだけ用意した。"
    : budgetDone ? "今日のぶんはやり切った。残りは明日また出てくる。"
    : paused ? "今できることは全部やった。少し寝かせたほうがよく定着する。"
    : "先取りで軽く1セット回すこともできる。";

  // 「それでも続ける」。アプリからは促さないが、続けたい人は止めない。
  // 原則3が禁じているのは"アプリが要求すること"であって"ユーザーが選べること"
  // ではない(Ankiにも Custom Study がある)。
  const pushButton = paused && canPush && (
    <button
      onClick={onPush}
      style={{
        marginTop: 18, padding: "10px 18px", borderRadius: 12,
        border: "none", background: "transparent", color: "var(--faint)",
        fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "underline",
        textUnderlineOffset: 4, textDecorationColor: "var(--edge)",
      }}
    >
      それでも続ける
    </button>
  );

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
          {canStart && hasDue ? "セット開始" : paused ? "また明日" : "先取り練習"}
        </button>
        {pushButton}
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
