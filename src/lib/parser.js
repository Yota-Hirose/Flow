// ------------------------------------------------------------------
// Claudeとの学習フローで使っている形式をそのまま貼り付けて取り込む:
//
//   【日本語ヒント】 英文の一部 {{c1::answer}} 英文の残り|補足メモ
//
// 1行1カード。|以降(Back Extra)は省略可。
//
// NOTE: この一括貼り付けは T-25 でフォーム登録に主導線を譲り、玄人向けの
// 二次導線になる。パーサ自体の堅牢化(全角括弧・{{c2::}}・複数クローズ・
// 箇条書き記号など)と、noteから「出典:」を除去する修正(D-3)は T-05。
// ------------------------------------------------------------------

import { uuid } from "./id.js";
import { newCardState } from "./scheduler.js";

const LINE_RE = /^【(.+?)】\s*(.*?)\{\{c1::(.+?)\}\}(.*?)(?:\|(.*))?$/;

export function parseCardLines(text, collectionId, now = Date.now()) {
  const cards = [];
  const errors = [];
  // 行番号は原文の行番号を指す必要があるため、空行を除去する前に採番する
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  lines.forEach((line, i) => {
    if (!line) return;
    const m = line.match(LINE_RE);
    if (!m) {
      errors.push({ line: i + 1, text: line });
      return;
    }
    const [, hint, pre, answer, post, note] = m;
    cards.push(makeCard({ hint, pre, answer, post, note: note || "" }, collectionId, now));
  });

  return { cards, errors };
}

// カードの生成口を1箇所にまとめる。T-25のフォーム登録もここを通すことで、
// 同期メタ(id/updatedAt/deletedAt)の付け忘れを構造的に防ぐ。
export function makeCard({ hint, pre = "", answer, post = "", note = "", src }, collectionId, now = Date.now()) {
  const noteText = (note || "").trim();
  return {
    id: uuid(),
    collectionId,
    hint: hint.trim(),
    pre,
    answer: answer.trim(),
    post,
    note: noteText,
    src: src !== undefined ? src : extractSrc(noteText),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    state: newCardState(now),
  };
}

function extractSrc(note) {
  const m = note.match(/出典:\s*(.+)$/);
  return m ? m[1].trim() : "";
}
