import { describe, it, expect } from "vitest";
import { parseCardLines } from "../parser.js";

const T0 = 1_700_000_000_000;
const COL = "col-test";

const parse = (text) => parseCardLines(text, COL, T0);

describe("parseCardLines — 付録Aの正規形", () => {
  it("ヒント・前文・答え・後文・メモを分解する", () => {
    const { cards, errors } = parse(
      "【資料・書類】 I'll send the {{c1::document}} tomorrow.|仕事の「資料送ります」はこれ一語でOK"
    );
    expect(errors).toEqual([]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      hint: "資料・書類",
      pre: "I'll send the ",
      answer: "document",
      post: " tomorrow.",
      note: "仕事の「資料送ります」はこれ一語でOK",
    });
  });

  it("メモ(|以降)は省略できる", () => {
    const { cards, errors } = parse("【比較】 For a {{c1::comparison}} of licenses see Licensing.");
    expect(errors).toEqual([]);
    expect(cards[0].note).toBe("");
    expect(cards[0].src).toBe("");
  });

  it("出典: をソースラベルに抽出する", () => {
    const { cards } = parse("【頻繁に】 There are {{c1::frequently}} new features.|oftenの硬い版 / 出典: TD UserGuide");
    expect(cards[0].src).toBe("TD UserGuide");
  });

  it("前文が空でも成立する(文頭が答えのカード)", () => {
    const { cards, errors } = parse("【ユーザー投稿の】 {{c1::User-contributed}} components and assets.");
    expect(errors).toEqual([]);
    expect(cards[0].pre).toBe("");
    expect(cards[0].answer).toBe("User-contributed");
  });

  it("後文が空でも成立する", () => {
    const { cards } = parse("【昨日は忙しかったです】 {{c1::It was really busy yesterday}}.");
    expect(cards[0].post).toBe(".");
  });

  it("複数行を一括で取り込む", () => {
    const { cards, errors } = parse(
      ["【通常は】 We {{c1::typically}} post a new build.", "【比較】 For a {{c1::comparison}} of licenses."].join("\n")
    );
    expect(errors).toEqual([]);
    expect(cards).toHaveLength(2);
  });

  it("空行は無視される", () => {
    const { cards } = parse("\n\n【比較】 For a {{c1::comparison}} of licenses.\n\n");
    expect(cards).toHaveLength(1);
  });

  it("CRLF改行を扱える", () => {
    const { cards } = parse("【A】 x{{c1::y}}z\r\n【B】 p{{c1::q}}r");
    expect(cards).toHaveLength(2);
  });
});

describe("parseCardLines — 失敗行", () => {
  it("形式に合わない行を行番号つきで返す", () => {
    const { cards, errors } = parse(
      ["【正常】 a{{c1::b}}c", "これは形式に合わない行", "【正常2】 d{{c1::e}}f"].join("\n")
    );
    expect(cards).toHaveLength(2);
    expect(errors).toEqual([{ line: 2, text: "これは形式に合わない行" }]);
  });

  it("成功分は登録され、失敗分だけが弾かれる", () => {
    const { cards, errors } = parse(["【欠落】 クローズがない行", "【正常】 a{{c1::b}}c"].join("\n"));
    expect(cards).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("空文字なら何も返さない", () => {
    expect(parse("")).toEqual({ cards: [], errors: [] });
  });
});

describe("parseCardLines — カードの生成", () => {
  it("同期に必要なメタを備えている (T-02)", () => {
    const { cards } = parse("【A】 x{{c1::y}}z");
    const c = cards[0];
    expect(c.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(c.collectionId).toBe(COL);
    expect(c.createdAt).toBe(T0);
    expect(c.updatedAt).toBe(T0);
    expect(c.deletedAt).toBeNull();
  });

  it("IDは行ごとに一意 (2端末でも衝突しない)", () => {
    const { cards } = parse(Array.from({ length: 50 }, (_, i) => `【${i}】 x{{c1::y${i}}}z`).join("\n"));
    expect(new Set(cards.map((c) => c.id)).size).toBe(50);
  });

  it("新規カードの状態で始まる", () => {
    const { cards } = parse("【A】 x{{c1::y}}z");
    expect(cards[0].state).toEqual({ reps: 0, interval: 0, ease: 2.5, due: T0, lapses: 0, lastReview: null });
  });
});
