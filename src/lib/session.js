// ------------------------------------------------------------------
// セッション(1セット)のキュー管理。
//
// 旧実装はセッション開始時にID配列を固定し、位置を進めるだけだったため、
// 「まだ」と答えたカードが同じセットに二度と現れなかった(差異 D-1)。
// SRSで最も学習効果が高いのは、思い出せなかった直後にもう一度想起する
// 瞬間なので、そこを落としていた。
//
// 設計:
//   - SET_SIZE は「そのセットで触る"別々のカード"の枚数」
//   - **既定では同セット内で再出題しない。** 10枚セットは必ず10タップで終わる
//   - 「まだ」のカードは10分後に期限が来て、次のセットで戻ってくる
//   - 進捗バーは「枚数」を映す(§4-4)
//
// なぜ再出題を既定オフにしたか(2026-08-16の判断):
//   一度は「2枚後ろに差し戻し、正解するまで終わらない」で実装した。だが
//   10枚セットでの2枚後ろは体感20〜30秒しかなく、**答えを見た直後の再提示は
//   想起ではなく再認のテストになる**。原則1が守ろうとしている「思い出す努力」
//   が発生しないうえ、しつこさだけが残る。
//   Ankiも失敗カードを同セッションに戻すが、あれは最短でも1分の時間ベースで、
//   かつ待ち行列が大きいので実際には何十枚も後ろに埋もれる。位置ベースで2枚後ろ
//   はそれとは別物だった。
//   仕組み自体は relearnInSet オプションとして残してあり、設定(T-24)から
//   有効にできる。
// ------------------------------------------------------------------

export const DEFAULT_SET_SIZE = 10;
export const DEFAULT_RELEARN_IN_SET = false; // 同セット内で再出題するか
export const DEFAULT_RELEARN_GAP = 4; // 有効にした場合、何枚後ろに差し戻すか
export const STEPS_PER_CARD = 2; // 再出題を有効にしたときの打ち切り上限の係数

export function createSession(
  cards,
  { relearnInSet = DEFAULT_RELEARN_IN_SET, relearnGap = DEFAULT_RELEARN_GAP, maxSteps } = {}
) {
  const cardIds = cards.map((c) => c.id);
  return {
    cardIds, // 進捗バーの並び。セット中は不変
    queue: [...cardIds], // これから出すカード
    results: Object.fromEntries(cardIds.map((id) => [id, "pending"])), // pending | good | again
    attempts: [], // { cardId, good } 評価のたびに1件
    steps: 0,
    relearnInSet,
    relearnGap,
    // 再出題しないなら、枚数ぶんのタップで必ず終わる
    maxSteps: maxSteps ?? (relearnInSet ? cardIds.length * STEPS_PER_CARD : cardIds.length),
  };
}

export function currentCardId(session) {
  return session.queue[0] ?? null;
}

export function isComplete(session) {
  return session.queue.length === 0 || session.steps >= session.maxSteps;
}

export function rateSession(session, good) {
  const cardId = currentCardId(session);
  if (cardId === null) return session;

  const rest = session.queue.slice(1);
  const steps = session.steps + 1;
  const hitCap = steps >= session.maxSteps;

  const putBack = !good && session.relearnInSet && !hitCap;

  return {
    ...session,
    // 差し戻さない場合、落としたカードは10分後に期限が来て次のセットで戻る
    queue: putBack ? reinsert(rest, cardId, session.relearnGap) : rest,
    results: { ...session.results, [cardId]: good ? "good" : "again" },
    attempts: [...session.attempts, { cardId, good }],
    steps,
  };
}

// 数枚後ろに差し戻す。キューが短ければ末尾に置く(= 次に出る)。
function reinsert(queue, cardId, gap) {
  const at = Math.min(gap, queue.length);
  return [...queue.slice(0, at), cardId, ...queue.slice(at)];
}

// ------------------------------------------------------------------
// 表示用の導出
// ------------------------------------------------------------------

// 進捗バーのセグメント。1枚 = 1セグメントで固定。
// 「まだ」で赤くなったセグメントは、取り返すとミントに戻る。
export function progressSegments(session) {
  const current = currentCardId(session);
  return session.cardIds.map((id) => ({
    id,
    status: id === current ? "current" : session.results[id],
  }));
}

// 確保できた枚数(そのセットを「できた」で終えたカード)
export function securedCount(session) {
  return session.cardIds.filter((id) => session.results[id] === "good").length;
}

// 一度でも引っかかったが、その場で取り返した枚数
export function stumbledCount(session) {
  const failed = new Set(session.attempts.filter((a) => !a.good).map((a) => a.cardId));
  return [...failed].filter((id) => session.results[id] === "good").length;
}

// 連続正解の最長。評価の並び順で数える
export function bestComboOf(session) {
  let best = 0;
  let run = 0;
  for (const a of session.attempts) {
    run = a.good ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

export function currentCombo(session) {
  let run = 0;
  for (const a of session.attempts) run = a.good ? run + 1 : 0;
  return run;
}
