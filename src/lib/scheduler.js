// ------------------------------------------------------------------
// スケジューラ。中身は FSRS(ts-fsrs 公式実装)。
//
// アプリ側に見せる面は移行前と同じ4つに保ってある:
//   newCardState / rate / isDue / buildQueue
// UI もセッション管理も、内部が SM-2 から FSRS に変わったことを知らない。
//
// 評価は2択のまま。「まだ」= Again、「できた」= Good に写す。
// FSRS系のスケジューラは2択でも精度がほとんど落ちないことが知られており、
// 4択が生む毎カードの判断疲れを避ける(SPEC 原則4)。
// Hard / Easy は使わない。
//
// 「まだ」を押したカードは FSRS の再学習ステップ(既定10分)で戻ってくる。
// 移行前に自前で持っていた「10分後」と同じ挙動になる。
// ------------------------------------------------------------------

import { emptyState, schedule } from "./fsrs.js";

export function newCardState(now = Date.now()) {
  return emptyState(now);
}

export function rate(state, good, now = Date.now()) {
  return schedule(state, good, now);
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
// 冷却時間。失敗カードは due が数分後で全カード中いちばん近いため、
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
