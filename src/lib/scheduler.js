// ------------------------------------------------------------------
// Flow scheduler: 2択(できた/まだ)用のシンプルなSM-2系スケジューラ。
// 将来 ts-fsrs(FSRS公式実装)に差し替える前提で、カードの状態は
// { reps, interval(日), ease, due(ms) } のみに絞ってある。
// ------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const RELEARN_DELAY_MS = 10 * 60 * 1000; // 「まだ」→ 10分後に同セッション内で再登場し得る

export function newCardState(now = Date.now()) {
  return { reps: 0, interval: 0, ease: 2.5, due: now };
}

export function rate(state, good, now = Date.now()) {
  const s = { ...state };
  if (good) {
    s.reps += 1;
    if (s.reps === 1) s.interval = 1;
    else if (s.reps === 2) s.interval = 3;
    else s.interval = Math.max(1, Math.round(s.interval * s.ease));
    s.due = now + s.interval * DAY;
  } else {
    s.reps = 0;
    s.interval = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.due = now + RELEARN_DELAY_MS;
  }
  return s;
}

export function isDue(state, now = Date.now()) {
  return state.due <= now;
}

// セッションのキュー: 期限が来ているカードを優先度順(期限が古い順)に。
// 空なら「先取り練習」として期限が近い順に貸し出す。
export function buildQueue(cards, size, now = Date.now()) {
  const due = cards.filter((c) => isDue(c.state, now));
  const pool = due.length > 0 ? due : [...cards];
  return pool
    .sort((a, b) => a.state.due - b.state.due)
    .slice(0, size);
}
