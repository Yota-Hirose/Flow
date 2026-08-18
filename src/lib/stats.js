// ------------------------------------------------------------------
// 統計とストリーク。**復習ログから導出する。**
//
// 経緯: 旧実装は stats を独立した累積値として持ち、1枚評価するたびに
// 加算していた(差異 D-8 の解消)。数字は正しかったが、同期(T-21)に入ると
// 破綻する — 端末Aで5枚、端末Bで3枚やったとき、両方の stats をどう
// 突き合わせても正しい8にならない。max を取れば5、足せば重複同期で
// 二重に増える。**累積値はマージできない。**
//
// 復習ログは追記専用でエントリIDが一意なので、和集合が常に正しい。
// そこから統計を「毎回そのつど数え直す」ことにすれば、統計の衝突解決は
// 存在しなくなる。20,000件の走査は1ms未満で、レビュー中の描画にも間に合う。
//
// statsBase — ログに残っていない分の繰り越し
//   1. v1からの移行組(統計はあるがログが空)の数字を失わないため
//   2. リングバッファ(MAX_LOG_ENTRIES)が古いエントリを捨てたとき、
//      捨てる直前に base へ畳み込むため
// base が無ければ全部ゼロから数えるだけで、壊れはしない。
// ------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

// 連続正解が途切れたとみなす間隔。ログにはセットの区切りが記録されて
// いないので、時間の空きで代用する。30分空けば別のセッション扱い。
export const COMBO_GAP_MS = 30 * 60 * 1000;

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// 暦日の境界。DSTのある地域でも 24h 引き算でずれないよう Date で作る
function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function prevDay(dayStart) {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
}

export function emptyStats() {
  return { totalReviews: 0, totalCorrect: 0, bestCombo: 0, lastReviewDay: null, streak: 0 };
}

// 繰り越し。lastReviewDayStart は「baseの最終日」をミリ秒で持つ。
// ストリークをログの先頭から base へ繋げられるかの判定に要る。
export function emptyBase() {
  return { totalReviews: 0, totalCorrect: 0, bestCombo: 0, lastReviewDay: null, lastReviewAt: null, streak: 0 };
}

function normBase(base) {
  return { ...emptyBase(), ...(base && typeof base === "object" ? base : null) };
}

// ------------------------------------------------------------------
// 導出
// ------------------------------------------------------------------

export function deriveStats(reviewLog = [], base = emptyBase()) {
  const b = normBase(base);
  const log = Array.isArray(reviewLog) ? [...reviewLog].sort((x, y) => x.ts - y.ts) : [];

  let totalCorrect = b.totalCorrect;
  let run = 0;
  let best = b.bestCombo;
  let prevTs = b.lastReviewAt ?? null;
  const days = new Set();

  for (const e of log) {
    if (e.good) {
      totalCorrect += 1;
      // 前の1枚から離れていれば、そこでコンボは切れている
      if (prevTs != null && e.ts - prevTs > COMBO_GAP_MS) run = 0;
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    prevTs = e.ts;
    days.add(startOfDay(e.ts));
  }

  const lastEntry = log[log.length - 1];
  const lastReviewDay = lastEntry ? dayKey(lastEntry.ts) : b.lastReviewDay;

  return {
    totalReviews: b.totalReviews + log.length,
    totalCorrect,
    bestCombo: best,
    lastReviewDay,
    streak: deriveStreak(days, b),
  };
}

// ログにある日を最終日から遡って数える。ログの先頭より前へ抜けたときだけ
// base の連続日数を足す(移行組・リングバッファ切り詰めの救済)。
function deriveStreak(days, base) {
  if (days.size === 0) return base.streak;

  const sorted = [...days].sort((a, b) => a - b);
  let cursor = sorted[sorted.length - 1];
  let n = 0;
  while (days.has(cursor)) {
    n += 1;
    cursor = prevDay(cursor);
  }
  // cursor はもう「ログに無い日」。それが base の最終日なら繋がっている
  const baseLast = base.lastReviewAt != null ? startOfDay(base.lastReviewAt) : null;
  if (baseLast != null && baseLast === cursor) n += base.streak;
  return n;
}

// ------------------------------------------------------------------
// 繰り越しへの畳み込み
//
// リングバッファが古いエントリを捨てるとき、捨てる前にここへ通す。
// 通さないと総レビュー数が減っていき、「積み上げたものが目減りする」という
// 一番やってはいけない見え方になる。
//
// 捨てられるのは常に**最も古い側**なので、base の最終日より後ろの日付しか
// 来ない。ストリークはこの前提で計算している。
// ------------------------------------------------------------------

export function foldEntries(base, entries = []) {
  const b = normBase(base);
  const log = [...entries].sort((x, y) => x.ts - y.ts);
  if (log.length === 0) return b;

  const derived = deriveStats(log, b);
  const lastTs = log[log.length - 1].ts;

  return {
    totalReviews: derived.totalReviews,
    totalCorrect: derived.totalCorrect,
    bestCombo: derived.bestCombo,
    lastReviewDay: derived.lastReviewDay,
    lastReviewAt: Math.max(b.lastReviewAt ?? 0, lastTs) || lastTs,
    streak: derived.streak,
  };
}

// 2端末の繰り越しを突き合わせる。累積値なので厳密には合流できない
// (同じレビューが両方の base に畳み込まれていたら重複する)が、
// base に入るのは「20,000件を超えて捨てられた分」だけで、両端末が同じ
// エントリを捨てている場合がほとんど。**大きいほうを採る**のが実害が最小。
export function mergeBase(a, b) {
  const x = normBase(a);
  const y = normBase(b);
  const pick = x.totalReviews >= y.totalReviews ? x : y;
  return {
    totalReviews: Math.max(x.totalReviews, y.totalReviews),
    totalCorrect: Math.max(x.totalCorrect, y.totalCorrect),
    bestCombo: Math.max(x.bestCombo, y.bestCombo),
    lastReviewAt: Math.max(x.lastReviewAt ?? 0, y.lastReviewAt ?? 0) || null,
    lastReviewDay: (x.lastReviewAt ?? 0) >= (y.lastReviewAt ?? 0) ? x.lastReviewDay : y.lastReviewDay,
    streak: pick.streak,
  };
}

// ------------------------------------------------------------------
// 旧スキーマ(v3以前)の累積 stats を繰り越しへ変換する。
//
// 既存ユーザーの reviewLog には、旧 stats に**すでに数えられている**
// レビューが入っている。単純に stats をそのまま base にすると二重に
// 数えてしまうので、ログぶんを差し引く。
//
// ストリークは「ログから数え直せる分」を引いた残りだけを繰り越し、
// ログの連続部分の1日前を base の最終日として置く。こうすると
// deriveStats の遡りがちょうど base に接続し、移行前後で数字が変わらない。
// ------------------------------------------------------------------

export function baseFromLegacyStats(old, reviewLog = []) {
  const s = { ...emptyStats(), ...(old && typeof old === "object" ? old : null) };
  const log = (Array.isArray(reviewLog) ? [...reviewLog] : []).sort((a, b) => a.ts - b.ts);

  let goodInLog = 0;
  const days = new Set();
  for (const e of log) {
    if (e.good) goodInLog += 1;
    days.add(startOfDay(e.ts));
  }

  const fromLog = deriveStreak(days, emptyBase());

  // ログに無い最初の日。ここを base の最終日にすると遡りが繋がる
  let anchor = null;
  if (days.size > 0) {
    const sorted = [...days].sort((a, b) => a - b);
    let cursor = sorted[sorted.length - 1];
    while (days.has(cursor)) cursor = prevDay(cursor);
    anchor = cursor;
  }

  return {
    totalReviews: Math.max(0, s.totalReviews - log.length),
    totalCorrect: Math.max(0, s.totalCorrect - goodInLog),
    bestCombo: s.bestCombo,
    lastReviewDay: s.lastReviewDay,
    lastReviewAt: anchor,
    streak: Math.max(0, s.streak - fromLog),
  };
}

export function retentionRate(stats) {
  if (!stats?.totalReviews) return null;
  return Math.round((stats.totalCorrect / stats.totalReviews) * 100);
}

export { DAY, startOfDay };
