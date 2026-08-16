// ------------------------------------------------------------------
// 休眠カード(T-15 / SPEC §8 P3)。
//
// SPECの言葉では「溜まりすぎたカードを自動で休眠に落とし、余裕が出たら
// 再浮上。**『全部やらなきゃ』を仕様レベルで不可能にする**」。
//
// 1日の上限(T-28)だけでは、消化しきれない分が翌日へ繰り越されて積み上がる。
// 見せていないので不安は生まれないが、実態としての借金は増え続ける。
// 休眠はその借金に上限をかける仕組みで、上限とセットで初めて意味を持つ。
//
// **どれを寝かせるか: 最も忘れているものから**
//   直感に反するが、いちばん忘れているカードを後回しにする。理由は、
//   完全に忘れたカードをやり直すコストは新規学習とほとんど同じで、
//   「今日やる」ことの価値が薄いから。逆に、まだ薄っすら覚えている
//   カードは今日やれば安く救える。限られた時間はそちらに使う。
//
// **原則3の遵守**
//   休眠している枚数はどこにも表示しない。静かに落ちて、静かに戻る。
//   ユーザーが知る必要があるのは「今日やること」だけ。
// ------------------------------------------------------------------

import { isDue, isActive } from "./scheduler.js";

// 「何日ぶんの作業までなら抱えていられるか」。これを超えた分が休眠に落ちる
export const DAYS_OF_WORK_KEPT = 7;

export function isAwake(card) {
  return !card.dormantSince;
}

// 期限が来ていて、いま出せるカード
export function activeDue(cards, now = Date.now()) {
  return cards.filter((c) => isActive(c) && isAwake(c) && isDue(c.state, now));
}

// 忘れている度合いが高い順。overdueが長いほど、stabilityが低いほど先に寝る
function forgottenFirst(now) {
  return (a, b) => forgottenScore(b, now) - forgottenScore(a, now);
}

function forgottenScore(card, now) {
  const overdueDays = Math.max(0, (now - card.state.due) / 86400000);
  const stability = Math.max(0.1, card.state.stability ?? 0.1);
  // 予定間隔に対してどれだけ超過しているか。大きいほど忘れている
  return overdueDays / stability;
}

// 休眠を適用する。セッション開始時に呼ぶ。
// 返り値は新しいカード配列(変化が無ければ同じ参照を返す)。
export function applyDormancy(cards, { dailyLimit, now = Date.now() } = {}) {
  // 上限が無いなら休眠もしない。ユーザーが自分で制御している状態
  if (!dailyLimit || !Number.isFinite(dailyLimit)) return cards;

  const capacity = dailyLimit * DAYS_OF_WORK_KEPT;
  const live = cards.filter(isActive);
  const due = live.filter((c) => isAwake(c) && isDue(c.state, now));

  if (due.length > capacity) {
    const victims = new Set(
      [...due].sort(forgottenFirst(now)).slice(0, due.length - capacity).map((c) => c.id)
    );
    return cards.map((c) => (victims.has(c.id) ? { ...c, dormantSince: now, updatedAt: now } : c));
  }

  // 余裕があるぶんだけ起こす。期限が古い順に戻す
  const room = capacity - due.length;
  if (room <= 0) return cards;

  const sleeping = live
    .filter((c) => !isAwake(c))
    .sort((a, b) => a.state.due - b.state.due)
    .slice(0, room);
  if (sleeping.length === 0) return cards;

  const waking = new Set(sleeping.map((c) => c.id));
  return cards.map((c) => (waking.has(c.id) ? { ...c, dormantSince: null, updatedAt: now } : c));
}

export function dormantCount(cards) {
  return cards.filter((c) => isActive(c) && !isAwake(c)).length;
}
