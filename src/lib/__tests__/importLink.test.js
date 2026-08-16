import { describe, it, expect } from "vitest";
import {
  encodeText,
  decodeText,
  buildImportLink,
  parseImportHash,
  IMPORT_KEY,
  SAFE_LINK_LENGTH,
} from "../importLink.js";
import { parseCardLines } from "../parser.js";

const SAMPLE = [
  "【資料・書類】 I'll send the {{c1::document}} tomorrow.|仕事の定番 / 出典: AIドリル",
  "【頻繁に】 There are {{c1::frequently}} new features.|oftenの硬い版",
].join("\n");

describe("encodeText / decodeText", () => {
  it("日本語を含むテキストを往復できる", () => {
    expect(decodeText(encodeText(SAMPLE))).toBe(SAMPLE);
  });

  it("URLに入れて安全な文字だけになる", () => {
    expect(encodeText(SAMPLE)).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("パーセントエンコードより短い(日本語は3倍に膨らむ)", () => {
    expect(encodeText(SAMPLE).length).toBeLessThan(encodeURIComponent(SAMPLE).length);
  });

  it("空文字も扱える", () => {
    expect(decodeText(encodeText(""))).toBe("");
  });

  it("絵文字や記号が壊れない", () => {
    const tricky = "【✓ 済み】 a {{c1::b}} c|メモ〜①②③ 😀";
    expect(decodeText(encodeText(tricky))).toBe(tricky);
  });
});

describe("buildImportLink", () => {
  it("フラグメントに載る(クエリではない)", () => {
    const link = buildImportLink(SAMPLE, "https://example.app");
    expect(link.startsWith("https://example.app/#")).toBe(true);
    expect(link).toContain(`#${IMPORT_KEY}=`);
    // ? が付いていない = サーバに中身が送られない
    expect(link).not.toContain("?");
  });

  it("originを省略すると相対リンクになる", () => {
    expect(buildImportLink("【A】 x{{c1::y}}z").startsWith("/#")).toBe(true);
  });

  it("実用的な長さに収まるか判断できる", () => {
    const many = Array.from({ length: 30 }, (_, i) => `【ヒント${i}】 This is a {{c1::sentence${i}}} for testing.|メモ`).join("\n");
    expect(buildImportLink(many, "https://example.app").length).toBeLessThan(SAFE_LINK_LENGTH);
  });
});

describe("parseImportHash", () => {
  it("自分で作ったリンクを読み戻せる", () => {
    const link = buildImportLink(SAMPLE, "https://example.app");
    const hash = link.slice(link.indexOf("#"));
    expect(parseImportHash(hash)).toBe(SAMPLE);
  });

  it("先頭の # は付いていてもいなくてもよい", () => {
    const encoded = encodeText(SAMPLE);
    expect(parseImportHash(`#${IMPORT_KEY}=${encoded}`)).toBe(SAMPLE);
    expect(parseImportHash(`${IMPORT_KEY}=${encoded}`)).toBe(SAMPLE);
  });

  it("パーセントエンコードで作られたリンクも読める(手で作られた場合)", () => {
    expect(parseImportHash(`#${IMPORT_KEY}=${encodeURIComponent(SAMPLE)}`)).toBe(SAMPLE);
  });

  it("フラグメントが無ければ null", () => {
    expect(parseImportHash("")).toBeNull();
    expect(parseImportHash("#")).toBeNull();
    expect(parseImportHash("#other=1")).toBeNull();
  });

  it("壊れた値でも例外を投げない", () => {
    expect(() => parseImportHash("#import=%%%%")).not.toThrow();
    expect(() => parseImportHash("#import=!!!!")).not.toThrow();
  });

  it("他のフラグメントが混ざっていても取り出せる", () => {
    expect(parseImportHash(`#foo=1&${IMPORT_KEY}=${encodeText(SAMPLE)}`)).toBe(SAMPLE);
  });
});

describe("パーサとの接続 — リンクからそのままカードになる", () => {
  it("リンクを開くとカードが2枚できる", () => {
    const link = buildImportLink(SAMPLE, "https://example.app");
    const text = parseImportHash(link.slice(link.indexOf("#")));
    const { cards, errors } = parseCardLines(text, "col-1", 1_700_000_000_000);
    expect(errors).toEqual([]);
    expect(cards).toHaveLength(2);
    expect(cards[0].answer).toBe("document");
    expect(cards[0].src).toBe("AIドリル");
  });

  it("パーサが吸収するゆらぎはリンク経由でも効く", () => {
    const messy = "```\n- 【彼は毎朝走る】 He ｛｛c1：：runs｝｝ every {{c2::morning}}.\n```";
    const link = buildImportLink(messy, "https://example.app");
    const text = parseImportHash(link.slice(link.indexOf("#")));
    const { cards, errors } = parseCardLines(text, "col-1", 1_700_000_000_000);
    expect(errors).toEqual([]);
    expect(cards).toHaveLength(2);
  });
});
