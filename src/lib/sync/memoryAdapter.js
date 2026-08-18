// ------------------------------------------------------------------
// インメモリのニセ「サーバ」。テスト専用だが src に置いてある。
//
// これがあるおかげで、Supabaseのプロジェクトを作る前に同期エンジンを
// 完成させられる。2端末・競合・オフライン・再送を全部ここで再現できる。
// バックエンドを乗り換えるときも、まずこのアダプタでテストを通す。
// ------------------------------------------------------------------

import { conflictError } from "./engine.js";
import { migrate } from "../migrations.js";

export function createMemoryServer() {
  let stored = null;
  let rev = 0;
  const calls = { pull: 0, push: 0 };

  return {
    calls,
    get rev() {
      return rev;
    },
    get db() {
      return stored;
    },
    // 端末を1台つなぐ
    connect({ signedIn = true, offline = false } = {}) {
      let signed = signedIn;
      return {
        isSignedIn: () => signed,
        signOut: () => {
          signed = false;
        },
        signIn: () => {
          signed = true;
        },
        setOffline: (v) => {
          offline = v;
        },
        async pull() {
          if (offline) throw new Error("offline");
          calls.pull += 1;
          return stored ? { db: structuredClone(stored), rev } : null;
        },
        async push(db, { rev: base } = {}) {
          if (offline) throw new Error("offline");
          calls.push += 1;
          // 楽観ロック。取得してから他端末が書いていたら弾く
          if (stored && base !== rev) throw conflictError();
          stored = migrate(structuredClone(db));
          rev += 1;
          return { rev };
        },
      };
    },
  };
}
