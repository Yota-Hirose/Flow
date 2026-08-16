// ------------------------------------------------------------------
// 取り込みリンク(T-29)。
//
// 原則5(既存の学習フローに接続する)の最短距離。AIとの学習会話の終わりに
// リンクが出て、タップすると取り込み画面がプレビュー済みで開く。
// 「貼り付ける」という一手すら要らなくなる。
//
// **なぜクエリ(?)ではなくフラグメント(#)か**
//   フラグメントは**サーバに送信されない**。カードの中身——あなたが何を
//   読んでいて何につまずいたか——はブラウザの外に出ず、Vercelのアクセス
//   ログにも残らない。バックエンドを持たない今の構成で、これが最も筋がいい。
//   原則6(ローカルファースト)とも整合する。
//
// **なぜ base64url か**
//   日本語をパーセントエンコードすると3倍に膨らむ。base64は約1.33倍で済む。
//   リンクの長さは実用上の制約になるので、ここは効く。
//   ただし手で作られた素のリンクも読めるよう、復号は3段構えにしてある。
// ------------------------------------------------------------------

export const IMPORT_KEY = "import";

// 実用上のリンク長の目安。これを超えると一部のアプリやQRで扱いにくくなる
export const SAFE_LINK_LENGTH = 8000;

export function encodeText(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeText(encoded) {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function buildImportLink(text, origin = "") {
  return `${origin}/#${IMPORT_KEY}=${encodeText(text)}`;
}

// リンクからカード形式のテキストを取り出す。読めなければ null。
//
// 復号は3段構え: base64url → パーセントエンコード → 素のまま。
// リンクをどう作られても壊れないほうが、原則5の趣旨に合う。
export function parseImportHash(hash) {
  if (!hash) return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const value = params.get(IMPORT_KEY);
  if (!value) return null;

  try {
    const decoded = decodeText(value);
    if (decoded.includes("【")) return decoded;
  } catch {
    // base64ではなかった。次を試す
  }

  try {
    const decoded = decodeURIComponent(value);
    if (decoded.trim()) return decoded;
  } catch {
    // パーセントエンコードでもなかった
  }

  return value.trim() || null;
}

// リンクを読んだらフラグメントを消す。残しておくとリロードのたびに
// 取り込み画面が開いてしまう
export function clearImportHash() {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  history.replaceState(null, "", location.pathname + location.search);
}
