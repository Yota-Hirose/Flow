// ------------------------------------------------------------------
// 永続化層。MVPはlocalStorage。カード数が数千を超える頃にIndexedDBへ。
// ------------------------------------------------------------------

const KEY = "flow.cards.v1";
const STATS_KEY = "flow.stats.v1";

export function loadCards() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCards(cards) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards));
  } catch (e) {
    console.error("Failed to save cards", e);
  }
}

export function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : { totalReviews: 0, totalCorrect: 0, bestCombo: 0, lastReviewDay: null, streak: 0 };
  } catch {
    return { totalReviews: 0, totalCorrect: 0, bestCombo: 0, lastReviewDay: null, streak: 0 };
  }
}

export function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    console.error("Failed to save stats", e);
  }
}

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
