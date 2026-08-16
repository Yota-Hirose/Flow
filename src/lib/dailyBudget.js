// ------------------------------------------------------------------
// 1日の上限(T-28)。
//
// **なぜ要るか**
//   期限カードがある限り無限にセットを出し続ける実装だと、2週間サボって
//   500枚溜まったとき50セット出続ける。アプリは一度も「今日はもう十分」と
//   言わない。原則3が消したかったのは「1,247枚」という数字の恐怖だが、
//   数字を隠しただけでは**「終わらなさ」として同じ恐怖が戻ってくる**。
//   「今日の5分」という約束を有限にするには、終わりを宣言する必要がある。
//
// **数え方**
//   復習ログ(T-03)から当日ぶんを数える。専用のカウンタを別に持つと、
//   中断・リロード・同期のたびに実態とずれる。ログが唯一の真実。
//
// **コレクションをまたいで1本**
//   予算は「その人の1日」に対するもので、デッキごとではない。分類ごとに
//   予算を持たせると「全部やらなきゃ」が復活する(ストリークと同じ判断)。
//
// **上限は壁ではない**
//   達しても「それでも続ける」で超えられる。原則3が禁じているのは
//   "アプリが要求すること"であって、"ユーザーが選べること"ではない。
// ------------------------------------------------------------------

import { dayKey } from "./stats.js";

// 今日すでに評価した枚数
export function reviewsToday(reviewLog, now = Date.now()) {
  const today = dayKey(now);
  let n = 0;
  // 新しい方から数えて、日付が変わったら止める(ログは時刻順に積まれている)
  for (let i = reviewLog.length - 1; i >= 0; i--) {
    if (dayKey(reviewLog[i].ts) !== today) break;
    n++;
  }
  return n;
}

// 1日に触れるカードの上限。0 や未設定は「無制限」
export function dailyLimit(settings) {
  const sets = settings?.dailySets ?? 0;
  if (!sets) return Infinity;
  return sets * (settings?.setSize ?? 10);
}

// 今日あと何枚できるか
export function remainingToday(reviewLog, settings, now = Date.now()) {
  const limit = dailyLimit(settings);
  if (!Number.isFinite(limit)) return Infinity;
  return Math.max(0, limit - reviewsToday(reviewLog, now));
}

// 今日の分をやり切ったか
export function isDayComplete(reviewLog, settings, now = Date.now()) {
  return remainingToday(reviewLog, settings, now) === 0;
}

// そのセットで出す枚数。予算の残りで切り詰める(30枚中25枚済みなら最後は5枚)
export function nextSetSize(reviewLog, settings, now = Date.now()) {
  const remaining = remainingToday(reviewLog, settings, now);
  const size = settings?.setSize ?? 10;
  return Number.isFinite(remaining) ? Math.min(size, remaining) : size;
}
