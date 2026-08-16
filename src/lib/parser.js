// ------------------------------------------------------------------
// Claudeとの学習フローで使っている形式をそのまま貼り付けて取り込む:
//
//   【日本語ヒント】 英文の一部 {{c1::answer}} 英文の残り|補足メモ
//
// 1行1カード。|以降(Back Extra)は省略可。
// ------------------------------------------------------------------

import { newCardState } from "./scheduler.js";

const LINE_RE = /^【(.+?)】\s*(.*?)\{\{c1::(.+?)\}\}(.*?)(?:\|(.*))?$/;

export function parseCardLines(text, now = Date.now()) {
  const cards = [];
  const errors = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  lines.forEach((line, i) => {
    const m = line.match(LINE_RE);
    if (!m) {
      errors.push({ line: i + 1, text: line });
      return;
    }
    const [, hint, pre, answer, post, note] = m;
    cards.push({
      id: `card-${now}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      hint: hint.trim(),
      pre,
      answer: answer.trim(),
      post,
      note: (note || "").trim(),
      src: extractSrc(note || ""),
      createdAt: now,
      state: newCardState(now),
    });
  });

  return { cards, errors };
}

function extractSrc(note) {
  const m = note.match(/出典:\s*(.+)$/);
  return m ? m[1].trim() : "";
}
