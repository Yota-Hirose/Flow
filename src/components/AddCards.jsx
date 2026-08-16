import { useState, useMemo } from "react";
import { parseCardLines, makeCard } from "../lib/parser.js";
import CardEditor, { toSentence } from "./CardEditor.jsx";

// ------------------------------------------------------------------
// カード追加。**既定はフォームで1枚ずつ(§4-6 / T-25)。**
// 貼り付け一括取り込みは玄人向けの二次導線として残す(原則5)。
// ------------------------------------------------------------------

const PLACEHOLDER = `AI(Claude等)に「Anki穴埋め形式で出力して」と頼んだ結果を、そのまま貼れます。

【資料・書類】 I'll send the {{c1::document}} tomorrow.|仕事の「資料送ります」はこれ一語でOK / 出典: AIドリル`;

export default function AddCards({ collectionId, promptLabel, initialText = "", onAdd, onBack }) {
  // 取り込みリンク(T-29)から来たときは、貼り付けタブをプレビュー済みで開く
  const [tab, setTab] = useState(initialText ? "paste" : "form");
  const [text, setText] = useState(initialText);
  const [added, setAdded] = useState(0);

  // 貼り付けは取り込む前にプレビューする。以前は件数しか出しておらず、
  // どの行を直せばいいか分からなかった(差異 D-15)。
  const preview = useMemo(
    () => (text.trim() ? parseCardLines(text, collectionId) : { cards: [], errors: [] }),
    [text, collectionId]
  );

  const importAll = () => {
    if (preview.cards.length === 0) return;
    onAdd(preview.cards);
    setAdded((n) => n + preview.cards.length);
    // 失敗行だけを残す。そのまま直して再取り込みできる
    setText(preview.errors.map((e) => e.text).join("\n"));
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", animation: "riseIn .3s ease both", minHeight: 0, overflowY: "auto" }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>カードを追加</div>
      {initialText && added === 0 && (
        <div style={{
          fontSize: 12, color: "var(--violet)", fontWeight: 700, lineHeight: 1.6,
          borderRadius: 12, border: "1px solid rgba(139,124,255,.25)", background: "rgba(139,124,255,.07)",
          padding: "10px 12px", marginBottom: 12,
        }}>
          リンクからカードを受け取った。中身を確かめて取り込む。
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <Tab active={tab === "form"} onClick={() => setTab("form")}>1枚ずつ</Tab>
        <Tab active={tab === "paste"} onClick={() => setTab("paste")}>まとめて取り込む</Tab>
      </div>

      {tab === "form" ? (
        <>
          <CardEditor
            promptLabel={promptLabel}
            submitText="追加"
            onSubmit={(fields) => {
              onAdd([makeCard(fields, collectionId)]);
              setAdded((n) => n + 1);
            }}
            onCancel={onBack}
          />
          {added > 0 && (
            <div style={{ fontSize: 13, color: "var(--mint)", fontWeight: 700, marginTop: 12, textAlign: "center" }}>
              ✓ {added}枚を追加しました
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.7, marginBottom: 12 }}>
            多読・AIドリルで詰まった表現を、いつもの形式のまま貼り付け。
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            style={{
              minHeight: 160, resize: "none", borderRadius: 16, border: "1px solid var(--edge)",
              background: "var(--card-2)", color: "var(--ink)", padding: 16, fontSize: 13,
              lineHeight: 1.7, fontFamily: "inherit", outline: "none",
            }}
          />

          {text.trim() && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: "var(--faint)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>
                プレビュー — {preview.cards.length}枚
                {preview.errors.length > 0 && ` / 読み取れない ${preview.errors.length}行`}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {preview.cards.slice(0, 20).map((c) => (
                  <div key={c.id} style={{ borderRadius: 10, border: "1px solid var(--edge)", background: "var(--card-2)", padding: "10px 12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{c.hint}</div>
                    <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 3, lineHeight: 1.5, wordBreak: "break-word" }}>
                      {toSentence(c)}
                    </div>
                  </div>
                ))}
                {preview.cards.length > 20 && (
                  <div style={{ fontSize: 11, color: "var(--faint)", textAlign: "center" }}>
                    ほか {preview.cards.length - 20}枚
                  </div>
                )}

                {preview.errors.map((e) => (
                  <div key={e.line} style={{ borderRadius: 10, border: "1px solid rgba(242,131,122,.27)", padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: "var(--red)", fontWeight: 700 }}>
                      {e.line}行目 — {e.reason}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 3, wordBreak: "break-word" }}>{e.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {added > 0 && (
            <div style={{ fontSize: 13, color: "var(--mint)", fontWeight: 700, marginTop: 12 }}>
              ✓ {added}枚を追加しました
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={onBack} style={{
              flex: 1, padding: "14px 0", borderRadius: 14, border: "1px solid var(--edge)",
              background: "transparent", color: "var(--dim)", fontSize: 15, fontWeight: 700, cursor: "pointer",
            }}>
              戻る
            </button>
            <button
              onClick={importAll}
              disabled={preview.cards.length === 0}
              style={{
                flex: 1.6, padding: "14px 0", borderRadius: 14, border: "none",
                background: preview.cards.length ? "linear-gradient(135deg, var(--violet), #6c5ce7)" : "#262a3a",
                color: preview.cards.length ? "#fff" : "var(--faint)",
                fontSize: 15, fontWeight: 800, cursor: preview.cards.length ? "pointer" : "default",
              }}
            >
              {preview.cards.length > 0 ? `${preview.cards.length}枚を取り込む` : "取り込む"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "10px 0", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
        border: `1px solid ${active ? "var(--violet)" : "var(--edge)"}`,
        background: active ? "rgba(139,124,255,.12)" : "transparent",
        color: active ? "var(--ink)" : "var(--dim)", fontSize: 13, fontWeight: 700,
      }}
    >
      {children}
    </button>
  );
}
