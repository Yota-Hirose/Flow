// ------------------------------------------------------------------
// 統計とストリーク。
//
// 旧実装はセット完走時にしか加算していなかった(差異 D-8)。リロードや
// 離脱で抜けると、カードのスケジュールだけ進んで統計が置き去りになり、
// 総レビュー数が実態から乖離していく。**1枚評価するたびに加算する。**
//
// ストリークも「セットを完走した日」ではなく「1枚でも触った日」で数える。
// 完走を条件にすると、忙しくて3枚でやめた日が"サボった日"になり、
// 罰しない方針(SPEC §8 / 復帰ボーナスの考え方)と噛み合わない。
// ------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function emptyStats() {
  return { totalReviews: 0, totalCorrect: 0, bestCombo: 0, lastReviewDay: null, streak: 0 };
}

// 1回の評価を統計へ反映する。combo はそのセットのベストコンボ。
export function applyReview(stats, { good, combo = 0, now = Date.now() } = {}) {
  const s = { ...emptyStats(), ...stats };
  const today = dayKey(now);
  const yesterday = dayKey(now - DAY);

  return {
    totalReviews: s.totalReviews + 1,
    totalCorrect: s.totalCorrect + (good ? 1 : 0),
    bestCombo: Math.max(s.bestCombo, combo),
    lastReviewDay: today,
    // 同じ日に何度評価しても伸びない。前日に触っていれば+1、間が空けば1から
    streak:
      s.lastReviewDay === today ? Math.max(1, s.streak)
      : s.lastReviewDay === yesterday ? s.streak + 1
      : 1,
  };
}

export function retentionRate(stats) {
  if (!stats?.totalReviews) return null;
  return Math.round((stats.totalCorrect / stats.totalReviews) * 100);
}
