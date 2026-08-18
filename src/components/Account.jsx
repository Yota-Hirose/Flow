import { useState } from "react";
import { Status } from "../lib/sync/useSync.js";

// ------------------------------------------------------------------
// アカウントと同期(T-20 / T-21)。設定画面の中に置く。
//
// **見せ方の方針**
//   - 未ログインを「未完了」に見せない。同期しなくてもアプリは完結して
//     いる(原則6)。チェックリストの空欄のように見えると、やる必要のない
//     ことをやらされた気分になる。
//   - 同期中・失敗を大きく出さない。学習は止まっていないので、
//     赤い警告を出す理由がない。次に開いたときに送られる。
//   - パスワードは作らせない。マジックリンクなら忘れるものが無い。
// ------------------------------------------------------------------

const label = { fontSize: 11, color: "var(--faint)", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 };
const card = { borderRadius: 14, border: "1px solid var(--edge)", background: "var(--card-2)", padding: 16, marginBottom: 12 };

const STATUS_TEXT = {
  [Status.OFF]: null,
  [Status.IDLE]: "待機中",
  [Status.SYNCING]: "同期中…",
  [Status.SYNCED]: "同期済み",
  [Status.OFFLINE]: "オフライン — 次に繋がったときに送ります",
  [Status.ERROR]: "同期は保留中。学習はこのまま続けられます",
};

export default function Account({ sync }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // 未設定のビルド(.env が無い)では同期の存在自体を出さない。
  // 使えない機能を見せても判断を増やすだけ(原則4)
  if (!sync.configured) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sync.sendMagicLink(email.trim());
      setSent(true);
    } catch (err) {
      setError(friendly(err));
    }
    setBusy(false);
  };

  if (sync.session) {
    return (
      <div style={card}>
        <div style={label}>アカウント</div>
        <div style={{ fontSize: 13, fontWeight: 700, wordBreak: "break-all" }}>{sync.email}</div>
        <div style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.7, marginTop: 6 }}>
          カードと学習の記録が端末間で揃います。
          {STATUS_TEXT[sync.status] && <><br />{STATUS_TEXT[sync.status]}</>}
          {sync.lastSyncedAt && sync.status === Status.SYNCED && (
            <><br />最終同期 {new Date(sync.lastSyncedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => sync.syncNow()} style={ghost}>今すぐ同期</button>
          <button onClick={() => sync.signOut()} style={ghost}>ログアウト</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--faint)", lineHeight: 1.7, marginTop: 10 }}>
          ログアウトしてもこの端末のカードは消えません。
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={label}>端末間で同期する(任意)</div>
      <div style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.7, marginBottom: 12 }}>
        ログインしなくても、この端末だけで問題なく使えます。
        スマホとPCの両方で続けたいときだけ。
      </div>

      {sent ? (
        <div style={{ fontSize: 13, color: "var(--mint)", fontWeight: 700, lineHeight: 1.7 }}>
          {email} にリンクを送りました。<br />
          <span style={{ color: "var(--dim)", fontWeight: 400, fontSize: 12 }}>
            メールのリンクを開くとログインします。パスワードはありません。
          </span>
          <div>
            <button onClick={() => { setSent(false); setEmail(""); }} style={{ ...ghost, marginTop: 10 }}>
              やり直す
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            style={{
              flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--edge)",
              background: "var(--card)", color: "var(--ink)", fontSize: 13, fontFamily: "inherit", outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={!email.trim() || busy}
            style={{
              ...ghost,
              borderColor: email.trim() ? "var(--violet)" : "var(--edge)",
              color: email.trim() ? "var(--ink)" : "var(--faint)",
              cursor: email.trim() && !busy ? "pointer" : "default",
              whiteSpace: "nowrap",
            }}
          >
            {busy ? "送信中" : "リンクを送る"}
          </button>
        </form>
      )}

      {error && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 10 }}>{error}</div>}
    </div>
  );
}

// 生のエラー文をそのまま出さない。ここで詰まる人は原因を知りたいのではなく
// 「自分のせいなのか」を知りたい
function friendly(err) {
  const m = String(err?.message ?? "");
  if (/fetch|network|NetworkError/i.test(m)) return "ネットワークに繋がりませんでした。少し待ってからもう一度。";
  if (/rate|too many|429/i.test(m)) return "短時間に何度も送られました。少し待ってからもう一度。";
  if (/email/i.test(m)) return "メールアドレスを確認してください。";
  return `送れませんでした(${m})`;
}

const ghost = {
  padding: "10px 14px", borderRadius: 12, border: "1px solid var(--edge)", background: "transparent",
  color: "var(--dim)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
