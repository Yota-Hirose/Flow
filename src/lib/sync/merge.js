// ------------------------------------------------------------------
// 2つのDBを1つに畳む。同期(T-21)の心臓部。
//
// **設計の芯: マージはバックエンドを知らない。**
// ここは純関数で、ネットワークもSupabaseも登場しない。同期で一番壊れやすい
// のは「どちらのデータを残すか」の判断であって通信ではないので、そこだけを
// 切り出してテストできるようにしてある。バックエンドを差し替えても
// このファイルは変わらない。
//
// **満たすべき2つの性質**
//   1. 可換(convergence): mergeDb(A,B) と mergeDb(B,A) が同じ結果になる。
//      これが崩れると、2端末が互いに同期し続けても永久に一致しない。
//   2. 冪等(idempotence): mergeDb(X,X) === X。同じ内容を2回受け取っても
//      増えない。再送・オフライン復帰で必ず起きる。
//
// **要素ごとの方針**
//   カード/コレクション … updatedAt の新しい方(LWW)。同時刻の引き分けは
//     内容のハッシュ順で決める。「ローカル優先」にすると端末Aでは
//     Aが勝ち端末BではBが勝ち、永久に収束しないため。
//   復習ログ … 和集合。追記専用でIDが一意なので衝突しない。
//     **これが同期の衝突をほぼ消している。** 学習の実績はマージで
//     失われない、という保証がここに集約されている。
//   統計 … マージしない。合流後のログから数え直す(stats.js)。
//   設定 … settingsUpdatedAt による LWW。
//   activeCollectionId … **同期しない。** 端末ごとに別のデッキを開いて
//     いてよい。同期する意味がないうえ、片方の画面が勝手に切り替わる。
//
// 削除は tombstone(deletedAt)で伝わる。配列から消していないので、
// 「片方で消したカードがもう片方から復活する」が起きない。
// ------------------------------------------------------------------

import { migrate, SCHEMA_VERSION } from "../migrations.js";
import { mergeReviewLogs, rebuildState, logsByCard } from "../reviewLog.js";
import { mergeBase } from "../stats.js";
import { normalizeSettings } from "../settings.js";

// キー順に依存しない安定した文字列化。引き分けの決着に使うので、
// 端末によって結果が変わってはいけない。
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

// 新しい方を採る。同時刻なら内容順 — 役割(local/remote)では決めない
export function pickNewer(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ta = a.updatedAt ?? 0;
  const tb = b.updatedAt ?? 0;
  if (ta !== tb) return ta > tb ? a : b;
  return stableStringify(a) <= stableStringify(b) ? a : b;
}

function mergeById(listA = [], listB = []) {
  const out = new Map();
  for (const item of listA) if (item?.id) out.set(item.id, item);
  for (const item of listB) {
    if (!item?.id) continue;
    out.set(item.id, pickNewer(out.get(item.id), item));
  }
  // IDでソートして配列の順序も決定的にする(可換性のため)
  return [...out.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

// 設定は1つのオブジェクトなので、フィールドごとではなく丸ごとLWW。
// フィールドごとにすると「setSizeはA、dailySetsはB」という誰も設定して
// いない組み合わせが生まれる。
function mergeSettings(a, b) {
  const ta = a?.settingsUpdatedAt ?? 0;
  const tb = b?.settingsUpdatedAt ?? 0;
  if (ta !== tb) {
    const win = ta > tb ? a : b;
    return { settings: normalizeSettings(win.settings), settingsUpdatedAt: win.settingsUpdatedAt ?? 0 };
  }
  const sa = stableStringify(normalizeSettings(a?.settings));
  const sb = stableStringify(normalizeSettings(b?.settings));
  const win = sa <= sb ? a : b;
  return { settings: normalizeSettings(win?.settings), settingsUpdatedAt: ta };
}

/**
 * @param local  この端末のDB(activeCollectionId はこちらを尊重する)
 * @param remote サーバから受け取ったDB
 */
export function mergeDb(local, remote, now = Date.now()) {
  if (!remote) return migrate(local, now);
  if (!local) return migrate(remote, now);

  // 版が違う端末同士でも合流できるように、両方を最新まで上げてから畳む。
  // 上げずにマージすると v3 のカードと v4 のカードが混ざる。
  const a = migrate(local, now);
  const b = migrate(remote, now);

  const collections = mergeById(a.collections, b.collections);
  const cards = mergeById(a.cards, b.cards);

  const { reviewLog, statsBase } = mergeReviewLogs(
    mergeBase(a.statsBase, b.statsBase),
    a.reviewLog,
    b.reviewLog
  );

  // 開いているデッキはローカルの意思。ただし合流後に存在しなければ寄せる
  const alive = collections.filter((c) => !c.deletedAt);
  const activeCollectionId = alive.some((c) => c.id === a.activeCollectionId)
    ? a.activeCollectionId
    : (alive[0] ?? collections[0])?.id;

  return {
    version: SCHEMA_VERSION,
    collections,
    activeCollectionId,
    cards,
    reviewLog,
    statsBase,
    ...mergeSettings(a, b),
  };
}

// ------------------------------------------------------------------
// 合流後のカード状態の作り直し。
//
// LWWで勝ったカードの state は「その端末が知っていた分だけ」で進んでいる。
// 端末Aで3回、端末Bで2回復習していたら、どちらの state も5回ぶんの
// 学習を反映していない。合流したログから rate() を回し直すと、
// **両端末の学習が両方とも効いた状態**になる。
//
// FSRSの fuzz を切ってある(fsrs.js)のはこのため。乱数が入ると
// 同じログから同じ state が出ず、端末間で永久にずれ続ける。
//
// 全カードに対して毎回回すと重いので、そのカードのログが実際に増えた
// ものだけを作り直す。
// ------------------------------------------------------------------

export function rebuildMerged(db, changedCardIds = null) {
  const targets = changedCardIds ? new Set(changedCardIds) : null;
  return {
    ...db,
    cards: db.cards.map((c) => {
      if (targets && !targets.has(c.id)) return c;
      const entries = logsByCard(db.reviewLog, c.id);
      if (entries.length === 0) return c;
      return { ...c, state: rebuildState(entries, c.createdAt) };
    }),
  };
}

// どのカードのログが増えたか。rebuildMerged の対象を絞るために使う
export function changedCardsBetween(before = [], after = []) {
  const count = new Map();
  for (const e of before) count.set(e.cardId, (count.get(e.cardId) ?? 0) + 1);
  const changed = new Set();
  const seen = new Map();
  for (const e of after) seen.set(e.cardId, (seen.get(e.cardId) ?? 0) + 1);
  for (const [cardId, n] of seen) if ((count.get(cardId) ?? 0) !== n) changed.add(cardId);
  for (const [cardId] of count) if (!seen.has(cardId)) changed.add(cardId);
  return changed;
}
