// ------------------------------------------------------------------
// セッション(1セット)のキュー管理。
//
// 旧実装はセッション開始時にID配列を固定し、位置を進めるだけだったため、
// 「まだ」と答えたカードが同じセットに二度と現れなかった(差異 D-1)。
// SRSで最も学習効果が高いのは、思い出せなかった直後にもう一度想起する
// 瞬間なので、そこを落としていた。
//
// 設計:
//   - SET_SIZE は「そのセットで触る"別々のカード"の枚数」。再出題では増えない
//   - 「まだ」のカードは数枚後ろに差し戻し、正解するまでセットが終わらない
//   - ただし maxSteps で必ず打ち切る。調子の悪い日にセットが終わらないのは
//     原則3(小さな約束)に反するため
//   - 進捗バーは「枚数」を映す。再出題で伸び縮みしない(§4-4)
// ------------------------------------------------------------------

export const DEFAULT_SET_SIZE = 10;
export const DEFAULT_RELEARN_GAP = 2; // 「まだ」→ 何枚後ろに差し戻すか
export const STEPS_PER_CARD = 2; // 打ち切り上限 = setSize × これ

export function createSession(cards, { relearnGap = DEFAULT_RELEARN_GAP, maxSteps } = {}) {
  const cardIds = cards.map((c) => c.id);
  return {
    cardIds, // 進捗バーの並び。セット中は不変
    queue: [...cardIds], // これから出すカード。再出題で伸びる
    results: Object.fromEntries(cardIds.map((id) => [id, "pending"])), // pending | good | again
    attempts: [], // { cardId, good } 評価のたびに1件
    steps: 0,
    relearnGap,
    maxSteps: maxSteps ?? cardIds.length * STEPS_PER_CARD,
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

  return {
    ...session,
    // 打ち切りに達したら差し戻さない。残りは次のセット以降に回す
    queue: good || hitCap ? rest : reinsert(rest, cardId, session.relearnGap),
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
