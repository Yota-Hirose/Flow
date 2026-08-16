import { useState } from "react";
import { parseCardLines } from "../lib/parser.js";

const PLACEHOLDER = `1行1カードで貼り付け:

【資料・書類】 I'll send the {{c1::document}} tomorrow.|仕事の「資料送ります」はこれ一語でOK / 出典: AIドリル

AI(Claude等)に「Anki穴埋め形式で出力して」と頼んだ結果をそのまま貼れます。`;

export default function AddCards({ collectionId, onAdd, onBack }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);

  const handleImport = () => {
    const { cards, errors } = parseCardLines(text, collectionId);
    if (cards.length > 0) onAdd(cards);
    setResult({ added: cards.length, errors });
    if (cards.length > 0) setText("");
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", animation: "riseIn .3s ease both" }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>カードを追加</div>
      <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.7, marginBottom: 16 }}>
        多読・AIドリルで詰まった表現を、いつもの形式のまま貼り付け。
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        spellCheck={false}
        style={{
          flex: 1,
          minHeight: 220,
          resize: "none",
          borderRadius: 16,
          border: "1px solid var(--edge)",
          background: "var(--card-2)",
          color: "var(--ink)",
          padding: 16,
          fontSize: 13,
          lineHeight: 1.7,
          fontFamily: "inherit",
          outline: "none",
        }}
      />

      {result && (
        <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6 }}>
          {result.added > 0 && (
            <span style={{ color: "var(--mint)", fontWeight: 700 }}>✓ {result.added}枚を追加しました</span>
          )}
          {result.errors.length > 0 && (
            <div style={{ color: "var(--red)", marginTop: 4 }}>
              {result.errors.length}行を読み取れませんでした(形式:【ヒント】文 {"{{c1::答え}}"} 文|メモ)
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button
          onClick={onBack}
          style={{ flex: 1, padding: "14px 0", borderRadius: 14, border: "1px solid var(--edge)", background: "transparent", color: "var(--dim)", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
        >
          戻る
        </button>
        <button
          onClick={handleImport}
          disabled={!text.trim()}
          style={{
            flex: 1.6, padding: "14px 0", borderRadius: 14, border: "none",
            background: text.trim() ? "linear-gradient(135deg, var(--violet), #6c5ce7)" : "#262a3a",
            color: text.trim() ? "#fff" : "var(--faint)",
            fontSize: 15, fontWeight: 800, cursor: text.trim() ? "pointer" : "default",
          }}
        >
          取り込む
        </button>
      </div>
    </div>
  );
}
