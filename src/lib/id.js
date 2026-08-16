// ------------------------------------------------------------------
// グローバル一意ID。
//
// 同期(T-21)を入れる以上、IDは端末をまたいで衝突してはならない。
// 旧実装は `seed-0`〜`seed-9` の固定IDだったため、2台目の端末で初回起動
// すると同じIDのカードが独立に生まれて衝突する。UUIDv4に統一する。
// ------------------------------------------------------------------

export function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // http や古いWebViewなど、secure contextでない環境向けのフォールバック
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // 最終手段。crypto が無い環境は想定していないが、ここで例外を投げると
  // カード追加そのものが落ちるため、衝突確率の低い擬似値を返す。
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
