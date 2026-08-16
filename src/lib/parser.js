// ------------------------------------------------------------------
// AIとの学習会話で使っている形式を、そのまま貼り付けて取り込む。
//
//   【日本語ヒント】 英文の一部 {{c1::answer}} 英文の残り|補足メモ / 出典: ソース名
//
// 原則5(既存の学習フローに接続する)の実装なので、**AI出力のゆらぎを
// こちらが吸収する**のが仕事。ユーザーに整形させた時点で負けている。
// 成功指標「多読→AI→取り込みの1サイクル < 2分」に直結する。
//
// 吸収するゆらぎ(T-05):
//   - 全角の ｛｛ ｝｝ ：：
//   - 行頭の箇条書き記号 ( - * ・ 1. 1) )
//   - コードフェンス行 ``` と、その中身
//   - {{c2::}} 以降の番号
//   - 1行に複数のクローズ → 番号ごとに1枚へ展開(Ankiと同じ挙動)
//   - Ankiのヒント記法 {{c1::答え::ヒント}} (ヒント部分は捨てる)
//
// NOTE: この一括貼り付けは T-25 のフォーム登録に主導線を譲り、玄人向けの
// 二次導線になる。
// ------------------------------------------------------------------

import { uuid } from "./id.js";
import { newCardState } from "./scheduler.js";

const HINT_RE = /^【(.+?)】\s*(.*)$/;
const CLOZE_RE = /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g;
const SRC_RE = /(?:\/\s*)?出典[:：]\s*(.+?)\s*$/;
const BULLET_RE = /^\s*(?:[-*+・]|\d+[.)])\s*/;
const FENCE_RE = /^\s*```/;

export function parseCardLines(text, collectionId, now = Date.now()) {
  const cards = [];
  const errors = [];
  // 行番号は原文の行番号を指す必要があるため、空行を除く前に採番する
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, i) => {
    // フェンス行自体は捨てる。中身は取り込む(AIがコードブロックで返すため)
    if (FENCE_RE.test(raw)) return;
    const line = stripBullet(normalizeWidth(raw)).trim();
    if (!line) return;

    const parsed = parseLine(line, collectionId, now);
    if (parsed.error) errors.push({ line: i + 1, text: raw.trim(), reason: parsed.error });
    else cards.push(...parsed.cards);
  });

  return { cards, errors };
}

function parseLine(line, collectionId, now) {
  const m = line.match(HINT_RE);
  if (!m) return { error: "【ヒント】が見つかりません" };

  const hint = m[1].trim();
  const rest = m[2];

  // メモは最初の | 以降。英文中に | が入ることはまず無い
  const bar = rest.indexOf("|");
  const body = bar === -1 ? rest : rest.slice(0, bar);
  const rawNote = bar === -1 ? "" : rest.slice(bar + 1);

  const tokens = tokenize(body);
  const numbers = [...new Set(tokens.filter((t) => t.type === "cloze").map((t) => t.num))];
  if (numbers.length === 0) return { error: "{{c1::答え}} が見つかりません" };

  const { note, src } = splitSrc(rawNote.trim());

  // 番号ごとに1枚。同じ番号が複数回出る場合は最初の1つを空所にし、
  // 残りは答えの文字列として描画する(pre/answer/post の3分割で表せる形に落とす)
  const cards = numbers.map((num) => {
    const target = tokens.findIndex((t) => t.type === "cloze" && t.num === num);
    return makeCard(
      {
        hint,
        pre: render(tokens.slice(0, target)),
        answer: tokens[target].text,
        post: render(tokens.slice(target + 1)),
        note,
        src,
      },
      collectionId,
      now
    );
  });

  return { cards };
}

// 本文を「素のテキスト」と「クローズ」の並びに分解する
function tokenize(body) {
  const tokens = [];
  let last = 0;
  CLOZE_RE.lastIndex = 0;
  let m;
  while ((m = CLOZE_RE.exec(body)) !== null) {
    if (m.index > last) tokens.push({ type: "text", text: body.slice(last, m.index) });
    tokens.push({ type: "cloze", num: Number(m[1]), text: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < body.length) tokens.push({ type: "text", text: body.slice(last) });
  return tokens;
}

// 対象でないクローズは、答えの文字列として見せる(Ankiと同じ)
function render(tokens) {
  return tokens.map((t) => t.text).join("");
}

function normalizeWidth(s) {
  return s
    .replace(/｛/g, "{")
    .replace(/｝/g, "}")
    .replace(/：/g, ":")
    .replace(/｜/g, "|");
}

function stripBullet(s) {
  return s.replace(BULLET_RE, "");
}

// 出典をメモから取り出し、**メモ側からは取り除く**。
// 以前は抽出するだけだったため、カード左上のソースラベルと下部のメモに
// 「出典: X」が二重表示されていた(差異 D-3)。
export function splitSrc(note) {
  const m = note.match(SRC_RE);
  if (!m) return { note, src: "" };
  return { note: note.slice(0, m.index).replace(/[\s/]+$/, ""), src: m[1].trim() };
}

// カードの生成口を1箇所にまとめる。T-25のフォーム登録もここを通すことで、
// 同期メタ(id/updatedAt/deletedAt)の付け忘れを構造的に防ぐ。
export function makeCard({ hint, pre = "", answer, post = "", note = "", src = "" }, collectionId, now = Date.now()) {
  return {
    id: uuid(),
    collectionId,
    hint: hint.trim(),
    pre,
    answer: answer.trim(),
    post,
    note: note.trim(),
    src: src.trim(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    state: newCardState(now),
  };
}
