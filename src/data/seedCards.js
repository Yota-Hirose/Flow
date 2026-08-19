import { makeCard } from "../lib/parser.js";

const RAW = [
  { hint: "通常は・たいてい", pre: "We ", answer: "typically", post: " post a new build every other month.", note: "usuallyのフォーマル版。技術文書頻出", src: "TD UserGuide" },
  { hint: "頻繁に", pre: "There are ", answer: "frequently", post: " new features added in addition to many improvements.", note: "oftenのフォーマル版", src: "TD UserGuide" },
  { hint: "〜に対して報酬を受け取る", pre: "If you are ", answer: "compensated for", post: " your work with TouchDesigner, you must have a Commercial license.", note: "be compensated for X = Xでお金をもらっている", src: "TD UserGuide" },
  { hint: "(大学の)教員", pre: "If you are a student or ", answer: "faculty", post: " at an accredited educational institution…", note: "※「能力・機能」の意味もある多義語", src: "TD UserGuide" },
  { hint: "比較", pre: "For a ", answer: "comparison", post: " of licenses see Licensing.", note: "compareの名詞形", src: "TD UserGuide" },
  { hint: "達成する・やり遂げる", pre: "Showing you how to ", answer: "accomplish", post: " numerous tasks.", note: "技術文書ではdoの丁寧版", src: "TD UserGuide" },
  { hint: "ユーザー投稿の", pre: "", answer: "User-contributed", post: " components and assets for TouchDesigner.", note: "OSS頻出。community-contributedも同型", src: "TD UserGuide" },
  { hint: "資料・書類", pre: "I'll send the ", answer: "document", post: " tomorrow.", note: "仕事の「資料送ります」はこれ一語でOK", src: "AIドリル 8/16" },
  { hint: "昨日は忙しかったです", pre: "", answer: "It was really busy yesterday", post: ".", note: "時間の語は文末が基本。× too busy", src: "AIドリル 8/16" },
  { hint: "彼はバスで会社に行きます", pre: "He goes ", answer: "to work", post: " by bus.", note: "workは無冠詞。前置詞toの抜けに注意", src: "AIドリル 8/16" },
];

// **固定IDに戻した(D-18)。**
//
// 一度UUIDに変えたが、これは判断を誤っていた。「同じIDが2端末で生まれると
// 衝突する」と考えたが、シードは全端末で**中身が完全に同じ**カードなので、
// 同じIDであるほうが正しい — 同期すれば1枚に畳まれる。UUIDにすると逆に、
// 端末を増やすたびに同じ内容のカードが10枚ずつ積み上がる。
//
// IDに版を含めてあるのは、将来シードの中身を変えたときに、既存ユーザーの
// 手元にある旧シードを黙って書き換えないため。
export function makeSeedCards(collectionId, now = Date.now()) {
  return RAW.map((c, i) => ({ ...makeCard(c, collectionId, now), id: `seed-v1-${i}` }));
}
