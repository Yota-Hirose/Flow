import { describe, it, expect } from "vitest";
import { defaultSettings, normalizeSettings, clampSetSize, SET_SIZE_MIN, SET_SIZE_MAX } from "../settings.js";
import { migrate, emptyDb } from "../migrations.js";

const T0 = 1_700_000_000_000;

describe("既定値", () => {
  it("1セット10枚・同セット内の再出題はオフ", () => {
    expect(defaultSettings()).toEqual({ setSize: 10, relearnInSet: false });
  });
});

describe("normalizeSettings — 手編集されたJSONでも落ちない", () => {
  it("未設定なら既定値", () => {
    expect(normalizeSettings(undefined)).toEqual(defaultSettings());
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings("こわれている")).toEqual(defaultSettings());
  });

  it("欠けている項目だけ既定値で補う", () => {
    expect(normalizeSettings({ setSize: 20 })).toEqual({ setSize: 20, relearnInSet: false });
    expect(normalizeSettings({ relearnInSet: true })).toEqual({ setSize: 10, relearnInSet: true });
  });

  it("範囲外の枚数は丸める", () => {
    expect(normalizeSettings({ setSize: 0 }).setSize).toBe(SET_SIZE_MIN);
    expect(normalizeSettings({ setSize: 9999 }).setSize).toBe(SET_SIZE_MAX);
    expect(normalizeSettings({ setSize: -5 }).setSize).toBe(SET_SIZE_MIN);
  });

  it("数値でない枚数は既定値に戻す", () => {
    expect(normalizeSettings({ setSize: "たくさん" }).setSize).toBe(10);
    expect(normalizeSettings({ setSize: null }).setSize).toBe(10);
  });

  it("真偽値でないトグルは既定値に戻す", () => {
    expect(normalizeSettings({ relearnInSet: "yes" }).relearnInSet).toBe(false);
  });

  it("知らない項目は捨てる(設定の海を作らない)", () => {
    expect(normalizeSettings({ setSize: 10, showBacklog: true })).toEqual(defaultSettings());
  });
});

describe("clampSetSize", () => {
  it("文字列の数値も受け付ける(range入力から来る)", () => {
    expect(clampSetSize("7")).toBe(7);
  });
  it("小数は丸める", () => {
    expect(clampSetSize(7.6)).toBe(8);
  });
});

describe("スキーマとの統合", () => {
  it("新規DBに既定の設定が入る", () => {
    expect(emptyDb(T0).settings).toEqual(defaultSettings());
  });

  it("設定を持たない古いv2データにも既定値が補われる", () => {
    const db = migrate({ version: 3, cards: [], collections: [], reviewLog: [] }, T0);
    expect(db.settings).toEqual(defaultSettings());
  });

  it("v1から移行しても設定が入る", () => {
    expect(migrate({ version: 1, cards: [] }, T0).settings).toEqual(defaultSettings());
  });

  it("保存済みの設定は保たれる", () => {
    const db = migrate({ version: 3, cards: [], settings: { setSize: 25, relearnInSet: true } }, T0);
    expect(db.settings).toEqual({ setSize: 25, relearnInSet: true });
  });
});
