// ------------------------------------------------------------------
// リーチカード検出(T-09 / SPEC §8 P1)。
//
// 調査で拾った声: **「80回失敗したドイツ語単語がある」**(SPEC §2.2 層C)。
// SRSは「弱点を見せる」のは得意だが、**同じカードで延々つまずいている
// ことをユーザーに教えてくれない**。落とすたびに間隔が縮み、また出て、
// また落とす。この輪から自力で降りるのは難しい。
//
// Ankiには leech タグと自動サスペンドがあるが、既定8回失敗で「タグを付けて
// 止める」だけ。**なぜ苦しいのかも、どうすればいいのかも言わない。**
// Flowは、失敗の多いカードは「覚えられない人が悪い」のではなく
// 「カードの作りが悪い」ことが多い、という立場を取る。だから提案は
// 「分解する?」から始める。1枚に詰め込みすぎた情報を2枚に割るだけで
// 抜けることが多い。
//
// 邪魔をしない設計:
//   - 提案は1セットにつき最大1枚。学習の流れを止めない
//   - 「そのまま」を選んだら一定期間は黙る(再提案の間隔は SNOOZE_MS)
//   - 提案は完了画面にだけ出す。想起中の画面は静かに保つ(原則2)
// ------------------------------------------------------------------

import { isActive } from "./scheduler.js";
import { logsByCard } from "./reviewLog.js";

// 何回落としたら「苦しんでいる」とみなすか。
// Ankiの既定(8)より早めに拾う。2択のFlowでは1回の失敗が重い意味を持つため。
export const LEECH_LAPSE_THRESHOLD = 5;

// この正答率を下回っていることも条件にする。失敗回数だけだと、
// よく復習していて時々落とすだけの健全なカードまで拾ってしまう。
export const LEECH_ACCURACY = 0.6;

// 「そのまま」を選ばれてから、次に提案するまで黙る期間
export const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export function accuracyOf(reviewLog, cardId) {
  const entries = logsByCard(reviewLog, cardId);
  if (entries.length === 0) return 1;
  return entries.filter((e) => e.good).length / entries.length;
}

export function isLeech(card, reviewLog, now = Date.now()) {
  if (!isActive(card)) return false;
  if (card.leechSnoozedUntil && card.leechSnoozedUntil > now) return false;
  if ((card.state?.lapses ?? 0) < LEECH_LAPSE_THRESHOLD) return false;
  return accuracyOf(reviewLog, card.id) < LEECH_ACCURACY;
}

// いま提案すべき1枚。いちばん苦しんでいるものを返す。無ければ null。
export function findLeech(cards, reviewLog, now = Date.now()) {
  const candidates = cards.filter((c) => isLeech(c, reviewLog, now));
  if (candidates.length === 0) return null;
  return candidates.reduce((worst, c) => (severity(c, reviewLog) > severity(worst, reviewLog) ? c : worst));
}

// そのセットで触ったカードに絞って探す。
// 目の前で落としたばかりのカードについて言われるほうが腑に落ちる。
export function findLeechInSession(cards, reviewLog, sessionCardIds, now = Date.now()) {
  const ids = new Set(sessionCardIds);
  return findLeech(cards.filter((c) => ids.has(c.id)), reviewLog, now);
}

function severity(card, reviewLog) {
  const lapses = card.state?.lapses ?? 0;
  // 失敗が多いほど、正答率が低いほど深刻
  return lapses * (1 - accuracyOf(reviewLog, card.id));
}

export function snooze(card, now = Date.now()) {
  return { ...card, leechSnoozedUntil: now + SNOOZE_MS, updatedAt: now };
}
