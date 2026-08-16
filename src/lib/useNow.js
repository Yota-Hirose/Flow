import { useState, useEffect } from "react";

// ------------------------------------------------------------------
// 「今」を定期的に更新するフック(差異 D-7)。
//
// ホームを開いたまま放置してカードが期限を迎えても、旧実装では
// 「今日の分は完了!」のままボタンも変わらなかった。毎日開きっぱなしに
// する前提のアプリとしては素直に困る。
//
// 電池を無駄に食わないよう:
//   - 必要な画面(ホーム)でだけ有効にする
//   - タブが裏に回っている間はタイマーを止める
//   - 復帰時(visibilitychange / focus)に即座に更新する
//     — スマホでは裏に回った後タイマーが止まるので、これが実質の主経路
// ------------------------------------------------------------------

export function useNow(enabled = true, intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;

    let timer = null;
    const tick = () => setNow(Date.now());

    const start = () => {
      stop();
      tick();
      timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tick);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tick);
    };
  }, [enabled, intervalMs]);

  return now;
}
