import { useState, useRef, useEffect } from "react";

// ------------------------------------------------------------------
// カードの入力フォーム。**追加(T-25)と編集(T-06)で共有する。**
// 別々のUIを作ると、片方だけ直る事故が起きるため。
//
// Ankiから借りるのは「フォームで1枚ずつ作る」体験と、範囲選択で穴を開ける
// 操作(Ctrl+Shift+C 相当)、それと追加後もフォームに留まる挙動だけ。
// ノートタイプ・デッキ・タグといった設定の海は持ち込まない(原則4)。
//
// クローズと表・裏の両方に対応するが、**モード選択は出さない**:
//   英文に穴を開ければクローズ、開けなければ英文全体が答え(表・裏)。
//   データモデル上は後者も「pre/postが空でanswerが文全体」なので同じ形。
// ------------------------------------------------------------------

const HIDE_MARK_OPEN = "{{";
const HIDE_MARK_CLOSE = "}}";

// 表示用に pre/answer/post を1本の文字列へ戻す({{ }} で答えを囲う)
export function toSentence(card) {
  if (!card) return "";
  if (!card.pre && !card.post) return card.answer;
  return `${card.pre}${HIDE_MARK_OPEN}${card.answer}${HIDE_MARK_CLOSE}${card.post}`;
}

// 入力された1本の文字列を pre/answer/post に割る
export function fromSentence(sentence) {
  const open = sentence.indexOf(HIDE_MARK_OPEN);
  const close = sentence.indexOf(HIDE_MARK_CLOSE, open + 2);
  if (open === -1 || close === -1) {
    // 穴が無い = 表・裏カード。文全体が答えになる
    return { pre: "", answer: sentence.trim(), post: "" };
  }
  return {
    pre: sentence.slice(0, open),
    answer: sentence.slice(open + 2, close).trim(),
    post: sentence.slice(close + 2),
  };
}

const field = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid var(--edge)",
  background: "var(--card-2)",
  color: "var(--ink)",
  padding: "12px 14px",
  fontSize: 14,
  lineHeight: 1.7,
  fontFamily: "inherit",
  outline: "none",
  resize: "none",
};

const label = { fontSize: 11, color: "var(--faint)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 };

export default function CardEditor({ card, promptLabel, submitText = "追加", onSubmit, onCancel, onDelete }) {
  const [hint, setHint] = useState(card?.hint ?? "");
  const [sentence, setSentence] = useState(toSentence(card));
  const [note, setNote] = useState(card?.note ?? "");
  const [src, setSrc] = useState(card?.src ?? "");
  const [sel, setSel] = useState(null);
  const hintRef = useRef(null);
  const sentenceRef = useRef(null);

  useEffect(() => {
    setHint(card?.hint ?? "");
    setSentence(toSentence(card));
    setNote(card?.note ?? "");
    setSrc(card?.src ?? "");
    setSel(null);
  }, [card]);

  const parts = fromSentence(sentence);
  const hasHole = Boolean(parts.pre || parts.post);
  const ready = hint.trim() && parts.answer;

  // 選択範囲を {{ }} で囲む。モバイルの標準選択メニューと競合しないよう、
  // 選択そのものはOSに任せ、確定後にボタンで囲む方式にしてある。
  const hide = () => {
    const el = sentenceRef.current;
    const s = sel ?? (el ? { start: el.selectionStart, end: el.selectionEnd } : null);
    if (!s || s.start === s.end) return;
    setSentence(
      sentence.slice(0, s.start) + HIDE_MARK_OPEN + sentence.slice(s.start, s.end) + HIDE_MARK_CLOSE + sentence.slice(s.end)
    );
    setSel(null);
  };

  const clearHole = () => setSentence(sentence.replaceAll(HIDE_MARK_OPEN, "").replaceAll(HIDE_MARK_CLOSE, ""));

  const submit = () => {
    if (!ready) return;
    onSubmit({ hint: hint.trim(), ...parts, note: note.trim(), src: src.trim() });
    if (!card) {
      // 追加モードでは入力欄を空にして留まる(Ankiの追加ダイアログと同じ)
      setHint("");
      setSentence("");
      setNote("");
      hintRef.current?.focus();
    }
  };

  const trackSel = (e) => setSel({ start: e.target.selectionStart, end: e.target.selectionEnd });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={label}>ヒント（日本語）</div>
        <input
          ref={hintRef}
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="通常は・たいてい"
          style={field}
        />
      </div>

      <div>
        <div style={{ ...label, display: "flex", justifyContent: "space-between" }}>
          <span>英文</span>
          <span style={{ letterSpacing: 0, fontWeight: 600 }}>
            {hasHole ? "穴埋めカード" : "全文が答え"}
          </span>
        </div>
        <textarea
          ref={sentenceRef}
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          onSelect={trackSel}
          onKeyUp={trackSel}
          onMouseUp={trackSel}
          rows={3}
          placeholder="We typically post a new build every other month."
          spellCheck={false}
          style={{ ...field, minHeight: 84 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={hide} style={ghost}>
            選んだ部分を隠す
          </button>
          {hasHole && (
            <button onClick={clearHole} style={ghost}>
              穴を戻す
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 8, lineHeight: 1.6 }}>
          隠したい語を選んでボタンを押すと穴埋めになる。選ばなければ文全体が答えになる。
        </div>
      </div>

      <div>
        <div style={label}>メモ（任意）</div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="usuallyのフォーマル版" style={field} />
      </div>

      <div>
        <div style={label}>出典（任意）</div>
        <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="TD UserGuide" style={field} />
      </div>

      {/* プレビュー: 実際のレビュー画面と同じ見え方を出す */}
      <div style={{ borderRadius: 14, border: "1px solid var(--edge)", background: "var(--card)", padding: "16px 18px" }}>
        <div style={{ fontSize: 10, color: "var(--faint)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 10 }}>
          {src || "マイカード"}
        </div>
        <div style={{ fontSize: 11, color: "var(--violet)", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>
          {promptLabel || "英語で言うと?"}
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.35, marginBottom: 12 }}>
          {hint || "（ヒント）"}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.75, color: "var(--dim)" }}>
          {parts.pre}
          <span style={{ color: "transparent", borderBottom: "2px dashed var(--faint)", display: "inline-block", minWidth: 60 }}>
            {parts.answer || "____"}
          </span>
          {parts.post}
        </div>
        {note && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 10, lineHeight: 1.6 }}>{note}</div>}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {onCancel && (
          <button onClick={onCancel} style={{ ...ghost, flex: 1, padding: "14px 0" }}>
            {card ? "やめる" : "戻る"}
          </button>
        )}
        <button
          onClick={submit}
          disabled={!ready}
          style={{
            flex: 1.6,
            padding: "14px 0",
            borderRadius: 14,
            border: "none",
            background: ready ? "linear-gradient(135deg, var(--violet), #6c5ce7)" : "#262a3a",
            color: ready ? "#fff" : "var(--faint)",
            fontSize: 15,
            fontWeight: 800,
            cursor: ready ? "pointer" : "default",
          }}
        >
          {submitText}
        </button>
      </div>

      {onDelete && (
        <button onClick={onDelete} style={{ ...ghost, color: "var(--red)", borderColor: "rgba(242,131,122,.27)" }}>
          このカードを削除
        </button>
      )}
    </div>
  );
}

const ghost = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid var(--edge)",
  background: "transparent",
  color: "var(--dim)",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};
