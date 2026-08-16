// ------------------------------------------------------------------
// Flow scheduler: 2択(できた/まだ)用のシンプルなSM-2系スケジューラ。
//
// 将来 ts-fsrs(FSRS公式実装)に差し替える(T-08)。FSRSは stability /
// difficulty / lapses / last_review を要求するため、移行時にスキーマ変更は
// どのみち避けられない。そこで T-03 の時点で lapses と lastReview を持たせ、
// 併せて追記専用の復習ログ(reviewLog.js)を貯め始めている。
// ログはFSRSのパラメータ最適化の原資になるので、移行を待たず今から溜める。
// ------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const RELEARN_DELAY_MS = 10 * 60 * 1000; // 「まだ」→ 10分後

export function newCardState(now = Date.now()) {
  return { reps: 0, interval: 0, ease: 2.5, due: now, lapses: 0, lastReview: null };
}

export function rate(state, good, now = Date.now()) {
  // 旧スキーマのstate(lapses/lastReviewを持たない)が渡っても壊れないよう既定値で埋める
  const s = { ...newCardState(now), ...state };
  if (good) {
    s.reps += 1;
    if (s.reps === 1) s.interval = 1;
    else if (s.reps === 2) s.interval = 3;
    else s.interval = Math.max(1, Math.round(s.interval * s.ease));
    s.due = now + s.interval * DAY;
  } else {
    s.reps = 0;
    s.interval = 0;
    // 浮動小数の誤差が蓄積すると ease が 2.0999999 のような値になるため丸める
    s.ease = Math.max(1.3, Math.round((s.ease - 0.2) * 100) / 100);
    s.lapses += 1;
    s.due = now + RELEARN_DELAY_MS;
  }
  s.lastReview = now;
  return s;
}

export function isDue(state, now = Date.now()) {
  return state.due <= now;
}

// 生きているカードだけを対象にする。ソフト削除(T-02)されたカードは
// 同期のtombstoneとして配列に残るため、出題対象からは常に除外する。
export function isActive(card) {
  return !card.deletedAt;
}

// 「もう1セット」を押した直後に、たった今回したカードが戻ってくるのを防ぐ
// 冷却時間。失敗カードは due が now+10分 で全カード中いちばん近いため、
// 先取り練習のフォールバックだと真っ先に選ばれてしまう(差異 D-2)。
export const RECENT_REVIEW_COOLDOWN_MS = 30 * 60 * 1000;

// セッションのキュー: 期限が来ているカードを優先度順(期限が古い順)に。
// 空なら「先取り練習」として期限が近い順に貸し出す。
//
// 同セット内での再出題は session.js が担当する(T-04)。ここは
// 「そのセットで触る別々のカード」を選ぶところまで。
// コレクションでの絞り込みは呼び出し側(App.jsx)で行う。
export function buildQueue(cards, size, now = Date.now(), { ignoreCooldown = false } = {}) {
  const alive = cards.filter(isActive);
  const due = alive.filter((c) => isDue(c.state, now));

  // 先取り練習。既定では直近に触ったカードを外し、空になったら空のまま返す。
  // 呼び出し側は「今日はここまで」を出す(アプリからは促さない)。
  //
  // ignoreCooldown は「それでも続ける」をユーザーが自分で押したときだけ真になる。
  // 原則3が禁じているのは"アプリが要求すること"であって、"ユーザーが選べること"
  // ではない。Ankiにも Custom Study があり、日次上限を明示的に超えられる。
  const pool =
    due.length > 0 ? due
    : ignoreCooldown ? alive
    : alive.filter((c) => !isRecentlyReviewed(c, now));

  return [...pool].sort((a, b) => a.state.due - b.state.due).slice(0, size);
}

export function isRecentlyReviewed(card, now = Date.now(), cooldown = RECENT_REVIEW_COOLDOWN_MS) {
  const last = card.state?.lastReview;
  return typeof last === "number" && now - last < cooldown;
}
