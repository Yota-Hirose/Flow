// ------------------------------------------------------------------
// 同期をReactに繋ぐ。ここだけがフレームワークを知っている。
//
// **決して await しない。** レビュー中にネットワークを待つ実装は却下
// (SPEC 原則6)。DBが変わったら request() を投げて、あとは放っておく。
// 結果が返ってきたら setDb で合流結果に差し替わる。
// ------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { createSyncEngine, Status } from "./engine.js";
import {
  isSyncConfigured,
  shouldInitAuth,
  createSupabaseAdapter,
  getSession,
  onAuthChange,
  sendMagicLink,
  signOut as supabaseSignOut,
} from "./supabase.js";

export { Status };

export function useSync(db, setDb) {
  const [session, setSession] = useState(null);
  const [state, setState] = useState({ status: Status.OFF, lastSyncedAt: null, error: null });

  // エンジンからは常に最新のDBが見えている必要がある。
  // 値を渡すと同期が始まった瞬間のDBで固まり、その間のレビューが飛ぶ
  const dbRef = useRef(db);
  dbRef.current = db;

  const sessionRef = useRef(null);
  sessionRef.current = session;

  const configured = isSyncConfigured();

  // ログインの痕跡が無いうちは supabase-js を読み込まない(遅延読み込みの要)。
  // メールを送った時点で立ち上げる
  const [armed, setArmed] = useState(() => shouldInitAuth());

  const adapter = useMemo(
    () => (configured ? createSupabaseAdapter({ getSessionSync: () => sessionRef.current }) : null),
    [configured]
  );

  const engine = useMemo(
    () =>
      adapter
        ? createSyncEngine({
            adapter,
            getDb: () => dbRef.current,
            onDb: (next) => setDb(next),
            onStatus: setState,
          })
        : null,
    [adapter, setDb]
  );

  // ログイン状態を追う。マジックリンクから戻ってきたときもここで拾う
  useEffect(() => {
    if (!configured || !armed) return;
    let alive = true;
    getSession().then((s) => alive && setSession(s));
    return onAuthChange((s) => {
      setSession(s);
      if (!s) {
        adapter?.reset();
        engine?.reset();
      }
    });
  }, [configured, armed, adapter, engine]);

  // ログインした瞬間に一度だけ合流させる。ここで既存の学習が降りてくる
  useEffect(() => {
    if (session && engine) engine.flush();
  }, [session?.user?.id, engine]);

  // DBが変わったら「そのうち送る」。まとめて1回にするのはエンジン側の仕事
  useEffect(() => {
    engine?.request();
  }, [db, engine]);

  // 閉じる直前・バックグラウンドへ回る直前に押し込む。
  // スマホではタブを閉じたあとの処理が走らないので、ここが最後の機会
  useEffect(() => {
    if (!engine) return;
    const flush = () => {
      if (document.visibilityState === "hidden") engine.flush();
    };
    const online = () => engine.flush();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("online", online);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("online", online);
      engine.stop();
    };
  }, [engine]);

  return {
    configured,
    session,
    email: session?.user?.email ?? null,
    status: state.status,
    lastSyncedAt: state.lastSyncedAt,
    error: state.error,
    sendMagicLink: async (email) => {
      setArmed(true);
      await sendMagicLink(email);
    },
    signOut: async () => {
      await supabaseSignOut();
      adapter?.reset();
      engine?.reset();
    },
    syncNow: () => engine?.flush(),
  };
}
