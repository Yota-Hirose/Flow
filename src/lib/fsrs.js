// ------------------------------------------------------------------
// FSRS(ts-fsrs 公式実装)との境界。
//
// **なぜ自前のSM-2をやめたか**
//   旧スケジューラは「正解で interval × ease、失敗で ease -= 0.2」という
//   SM-2系だった。Ankiコミュニティで長年指摘されている "Ease Hell"
//   (Againを繰り返すと ease が下限に張り付き、間隔が伸びなくなる沼)は
//   この式の構造的な帰結で、パラメータ調整では直らない。FSRSへ移すのが
//   本質的な解決になる(SPEC §4.5 / §8 P1)。
//
// **境界を1枚挟む理由**
//   ts-fsrs の Card は Date を持つ。localStorage と同期(T-21)に載せるには
//   数値(ms)で持ちたい。ここで相互変換し、アプリ側は数値だけを扱う。
//
// **fuzz を切っている理由**
//   FSRSは既定で間隔に揺らぎを入れて、同じ日にカードが固まるのを防ぐ。
//   だが Flow は「復習ログを正としてカード状態を再計算できる」ことを
//   同期の土台にしている(reviewLog.rebuildState)。揺らぎが入ると
//   2端末で同じログから違う状態が出うるので、決定性を優先して切る。
//   カードが固まる問題は、1セットの枚数で上限が効くため実害が小さい。
// ------------------------------------------------------------------

import { fsrs, createEmptyCard, generatorParameters, Rating, State } from "ts-fsrs";

const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

export { State };

const DAY = 24 * 60 * 60 * 1000;

// ts-fsrs の Card → 保存用の素の数値オブジェクト
export function toState(card) {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps ?? 0,
    reps: card.reps,
    lapses: card.lapses,
    fsrsState: card.state,
    lastReview: card.last_review ? card.last_review.getTime() : null,
  };
}

// 保存用オブジェクト → ts-fsrs の Card
export function toCard(state, now = Date.now()) {
  return {
    due: new Date(state.due ?? now),
    stability: state.stability ?? 0,
    difficulty: state.difficulty ?? 0,
    elapsed_days: state.elapsedDays ?? 0,
    scheduled_days: state.scheduledDays ?? 0,
    learning_steps: state.learningSteps ?? 0,
    reps: state.reps ?? 0,
    lapses: state.lapses ?? 0,
    state: state.fsrsState ?? State.New,
    last_review: state.lastReview ? new Date(state.lastReview) : undefined,
  };
}

export function emptyState(now = Date.now()) {
  return toState(createEmptyCard(new Date(now)));
}

// 2択をFSRSの評価へ。SPEC 付録Bの運用ルールどおり、
// 「口から出なかったが意味は分かっていた」も Good に寄せる(Hardは使わない)。
export function schedule(state, good, now = Date.now()) {
  const { card } = scheduler.next(toCard(state, now), new Date(now), good ? Rating.Good : Rating.Again);
  return toState(card);
}

// ------------------------------------------------------------------
// SM-2 の状態を FSRS へ寄せる(v2 → v3 マイグレーション用)
//
// 過去の復習実績は残っていない(v1は due しか保存していなかった)ので、
// **厳密な復元は不可能**。ここでやるのは「次に出る日を1日たりとも動かさず、
// 以降の計算をFSRSに引き継ぐ」こと。stability と difficulty は現行の
// interval と ease からの推定値で、正確さより連続性を優先している。
// 精度は、T-03から貯め始めた復習ログが溜まった後の最適化で取り戻す。
// ------------------------------------------------------------------
export function fromSm2(sm2, now = Date.now()) {
  const reps = sm2?.reps ?? 0;
  const lapses = sm2?.lapses ?? 0;
  const interval = sm2?.interval ?? 0;
  const ease = sm2?.ease ?? 2.5;
  const lastReview = sm2?.lastReview ?? null;
  const due = sm2?.due ?? now;

  // 一度も触っていないカードは、そのまま新規として扱う
  if (reps === 0 && lapses === 0 && !lastReview) {
    return { ...emptyState(now), due };
  }

  return {
    due,
    // 旧intervalは「次に出すまでの日数」= だいたい保持率90%の間隔なので
    // stability の近似として使える
    stability: Math.max(0.5, interval || 1),
    // ease 2.5(初期値) を難易度5(中央)に対応させ、easeが落ちた分だけ難しくする
    difficulty: clamp(1, 10, 5 + (2.5 - ease) * 2.5),
    elapsedDays: lastReview ? Math.max(0, Math.round((now - lastReview) / DAY)) : 0,
    scheduledDays: interval,
    learningSteps: 0,
    reps,
    lapses,
    // interval が 0 = 直前に落として学習中。それ以外は復習段階
    fsrsState: interval > 0 ? State.Review : State.Relearning,
    lastReview,
  };
}

function clamp(lo, hi, v) {
  return Math.min(hi, Math.max(lo, v));
}
