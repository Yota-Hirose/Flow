// ------------------------------------------------------------------
// 復習ログ(追記専用)。
//
// 3つの役割を1つの実装で兼ねる:
//   1. FSRSパラメータ最適化の原資(T-08)。FSRSの予測式は自分の復習実績で
//      チューニングできるが、材料は「いつ・どの間隔で・正解したか」の記録。
//      旧実装は due しか保存しておらず過去が消えていたため、移行を待たず
//      今から貯め始める。
//   2. リーチカード検出(T-09)の判定材料。
//   3. 同期の衝突解決を不要にする(T-21)。ログは追記専用なので、2端末の
//      ログを時刻順にマージするだけでよい。カードの現在状態はマージ後の
//      ログから再計算できる(rebuildState)ため、状態そのものを突き合わせる
//      必要がない。
// ------------------------------------------------------------------

import { uuid } from "./id.js";
import { newCardState, rate } from "./scheduler.js";
import { foldEntries } from "./stats.js";

// 容量上限。localStorageは端末あたり数MB程度しか使えないため、
// 際限なく貯めるとある日書き込みが失敗する。古いものから捨てる。
// IndexedDB移行(T-18)後はこの上限を大きく引き上げてよい。
export const MAX_LOG_ENTRIES = 20000;

export function makeLogEntry(card, good, now = Date.now()) {
  return {
    id: uuid(),
    cardId: card.id,
    ts: now,
    good,
    // FSRS移行後は scheduledDays。旧データ(SM-2)の interval もまだ読める
    intervalBefore: card.state?.scheduledDays ?? card.state?.interval ?? 0,
  };
}

export function appendLog(log, entry, max = MAX_LOG_ENTRIES) {
  const next = [...log, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

// 同じIDのエントリを重複させずに時刻順で束ねる。2端末のログを突き合わせる
// ときにそのまま使える(冪等)。
export function mergeLogs(a, b, max = MAX_LOG_ENTRIES) {
  const seen = new Map();
  for (const e of [...a, ...b]) seen.set(e.id, e);
  const merged = [...seen.values()].sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1));
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

// ログからカードの現在状態を再構築する。
// 同期後にサーバとローカルのログを合流させたとき、これを回せば状態が決まる。
export function rebuildState(entries, createdAt) {
  const ordered = [...entries].sort((a, b) => a.ts - b.ts);
  let state = newCardState(createdAt);
  for (const e of ordered) state = rate(state, e.good, e.ts);
  return state;
}

// ------------------------------------------------------------------
// DBへの追記。リングバッファから溢れたぶんを statsBase へ畳み込んでから
// 捨てる。畳み込まずに捨てると総レビュー数が減っていき、「積み上げたものが
// 目減りする」という一番やってはいけない見え方になる(stats.js 参照)。
// ------------------------------------------------------------------

export function appendReview(db, entry, max = MAX_LOG_ENTRIES) {
  const next = [...(db.reviewLog ?? []), entry];
  const overflow = next.length - max;
  if (overflow <= 0) return { ...db, reviewLog: next };
  return {
    ...db,
    reviewLog: next.slice(overflow),
    statsBase: foldEntries(db.statsBase, next.slice(0, overflow)),
  };
}

// マージ版。溢れた分の扱いは appendReview と同じ
export function mergeReviewLogs(statsBase, a, b, max = MAX_LOG_ENTRIES) {
  const seen = new Map();
  for (const e of [...(a ?? []), ...(b ?? [])]) seen.set(e.id, e);
  const merged = [...seen.values()].sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1));
  const overflow = merged.length - max;
  if (overflow <= 0) return { reviewLog: merged, statsBase };
  return {
    reviewLog: merged.slice(overflow),
    statsBase: foldEntries(statsBase, merged.slice(0, overflow)),
  };
}

export function logsByCard(log, cardId) {
  return log.filter((e) => e.cardId === cardId);
}
