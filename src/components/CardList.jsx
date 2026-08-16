import { useState, useMemo } from "react";
import CardEditor, { toSentence } from "./CardEditor.jsx";

// ------------------------------------------------------------------
// カード一覧・編集・削除(T-06 / 差異 D-6)。
//
// 削除はソフト削除(deletedAt)。配列からは消さない——同期(T-21)で
// 「端末Aで消したカードが端末Bで復活する」のを防ぐ tombstone になる。
//
// 原則3の注意: ここは「所持しているカードの一覧」であって、
// 未消化枚数(バックログ)ではない。期限や残り枚数は出さない。
// ------------------------------------------------------------------

export default function CardList({ cards, promptLabel, onUpdate, onDelete, onBack }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const alive = cards.filter((c) => !c.deletedAt);
    if (!needle) return alive;
    return alive.filter((c) =>
      [c.hint, c.pre, c.answer, c.post, c.note, c.src].join(" ").toLowerCase().includes(needle)
    );
  }, [cards, q]);

  if (editing) {
    const card = cards.find((c) => c.id === editing);
    if (!card) {
      setEditing(null);
      return null;
    }
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", animation: "riseIn .3s ease both", overflowY: "auto" }}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>カードを編集</div>
        <CardEditor
          card={card}
          promptLabel={promptLabel}
          submitText="保存"
          onSubmit={(fields) => {
            onUpdate(card.id, fields);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
          onDelete={() => {
            onDelete(card.id);
            setEditing(null);
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", animation: "riseIn .3s ease both", minHeight: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>カード一覧</div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="検索"
        style={{
          width: "100%", borderRadius: 12, border: "1px solid var(--edge)", background: "var(--card-2)",
          color: "var(--ink)", padding: "10px 14px", fontSize: 14, fontFamily: "inherit", outline: "none", marginBottom: 12,
        }}
      />

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ color: "var(--faint)", fontSize: 13, textAlign: "center", padding: "32px 0" }}>
            {q ? "見つからなかった。" : "まだカードがない。"}
          </div>
        )}
        {filtered.map((c) => (
          <button
            key={c.id}
            onClick={() => setEditing(c.id)}
            style={{
              textAlign: "left", borderRadius: 12, border: "1px solid var(--edge)", background: "var(--card-2)",
              padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", color: "var(--ink)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{c.hint}</div>
            <div style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.5, wordBreak: "break-word" }}>
              {toSentence(c)}
            </div>
            {c.src && <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 6 }}>{c.src}</div>}
          </button>
        ))}
      </div>

      <button onClick={onBack} style={{
        marginTop: 12, padding: "14px 0", borderRadius: 14, border: "1px solid var(--edge)",
        background: "transparent", color: "var(--dim)", fontSize: 15, fontWeight: 700, cursor: "pointer",
      }}>
        戻る
      </button>
    </div>
  );
}
