// ------------------------------------------------------------------
// ユーザー設定。
//
// **何を設定に置いてよいかの線引き(SPEC §8 / §4-4)**
//
// 置いてよい: 量とテンポの調整。1セットの枚数、再出題の有無など。
//   初期値のまま触らない人が大半なので、原則4(判断を減らす)への実害は小さい。
//
// 置いてはいけない:
//   - 未消化枚数(バックログ)の表示オプション  … 原則3
//   - 4択評価への拡張                          … 原則4
//   - 受動モード(答えを自動表示して流し見)     … 原則1
//   「見たい人もいる」への譲歩は、設定画面経由でも同じように原則を壊す。
//   ここに項目を足すときは、まずこの3つに当たらないかを確認すること。
// ------------------------------------------------------------------

import { DEFAULT_SET_SIZE, DEFAULT_RELEARN_IN_SET } from "./session.js";

export const SET_SIZE_MIN = 3;
export const SET_SIZE_MAX = 50;

export function defaultSettings() {
  return {
    setSize: DEFAULT_SET_SIZE,
    // 同セット内で落としたカードを出し直すか。既定オフ。
    // オンにすると「正解するまでセットが終わらない」挙動になる。
    relearnInSet: DEFAULT_RELEARN_IN_SET,
  };
}

// 壊れた値・範囲外の値が入っていてもアプリが動くように丸める。
// 手で編集したJSONをインポートされる可能性があるため必須。
export function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== "object") return d;
  return {
    setSize: clampSetSize(raw.setSize ?? d.setSize),
    relearnInSet: typeof raw.relearnInSet === "boolean" ? raw.relearnInSet : d.relearnInSet,
  };
}

export function clampSetSize(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_SET_SIZE;
  return Math.min(SET_SIZE_MAX, Math.max(SET_SIZE_MIN, v));
}
