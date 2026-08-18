// 同期(T-20/T-21)の実ブラウザ確認。
// 単体テストで拾えなかった production クラッシュ(destroy_ is not a function)の
// 再発を防ぐため、レビューを実際に回して例外ゼロを確認する。
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const ROOT="/tmp/flow/dist"; const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css"};
const reqs=[];
const server=http.createServer((req,res)=>{reqs.push(req.url);let p=path.join(ROOT,decodeURIComponent(req.url.split("?")[0]));if(!fs.existsSync(p)||fs.statSync(p).isDirectory())p=path.join(ROOT,"index.html");res.writeHead(200,{"Content-Type":MIME[path.extname(p)]??"application/octet-stream"});fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(4331,r));
// サンドボックス上のChromiumがあればそれを、無ければ playwright 同梱のものを使う
const SANDBOX_CHROME="/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXE=fs.existsSync(SANDBOX_CHROME)?SANDBOX_CHROME:undefined;
const browser=await chromium.launch({executablePath:EXE,args:EXE?["--no-sandbox"]:[]});
const page=await browser.newPage({viewport:{width:390,height:1000}});
const errors=[]; page.on("pageerror",e=>errors.push(String(e))); page.on("console",m=>m.type()==="error"&&errors.push(m.text()));
const txt=()=>page.locator("body").innerText();
const log=(...a)=>console.log(...a);
// StatChip は 値→ラベル の順で描画される
const stat=(body,name)=>body.match(new RegExp(`([^\\n]+)\\n${name}`))?.[1] ?? "(なし)";

await page.goto("http://localhost:4331/",{waitUntil:"networkidle"});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:"networkidle"});

log("① 初回起動:", (await txt()).split("\n").slice(0,3).join(" / "));

// v3(旧スキーマ)のデータを流し込んで移行を確認する
const legacy = await page.evaluate(()=>{
  const db = JSON.parse(localStorage.getItem("flow.db"));
  const now = Date.now(), DAY = 86400000;
  // 3日連続で学習した履歴 + 累積統計(旧形式)
  const log = [];
  for (let d=2; d>=0; d--) for (let i=0;i<3;i++)
    log.push({ id:`old-${d}-${i}`, cardId: db.cards[i].id, ts: now-d*DAY+i*60000, good: i<2, intervalBefore: 0 });
  const v3 = { ...db, version:3, reviewLog: log, stats:{ totalReviews:120, totalCorrect:96, bestCombo:11, lastReviewDay:null, streak:9 } };
  delete v3.statsBase; delete v3.settingsUpdatedAt;
  localStorage.setItem("flow.db", JSON.stringify(v3));
  return v3.stats;
});
await page.reload({waitUntil:"networkidle"});
const home = await txt();
log("② v3→v4 移行後のホーム: 総レビュー", stat(home,"総レビュー"), "/ 定着率", stat(home,"定着率"), "/ ベストコンボ", stat(home,"ベストコンボ"));
log("   移行前の値:", `総レビュー ${legacy.totalReviews} / 定着率 ${Math.round(legacy.totalCorrect/legacy.totalReviews*100)}% / ベストコンボ ⚡${legacy.bestCombo}`);
log("   ストリーク表示:", home.match(/🔥\s*\d+日連続/)?.[0] ?? "(なし)", "— 移行前は", legacy.streak, "日");
log("   スキーマ:", await page.evaluate(()=>JSON.parse(localStorage.getItem("flow.db")).version));

// レビューを1セット回す。ここが落ちると本番で白画面になる
await page.getByRole("button",{name:/セット開始|先取り練習|それでも続ける/}).first().click();
await page.waitForTimeout(300);
let rated = 0;
for (let i=0;i<12;i++){
  const ok = page.getByRole("button",{name:"できた ↑"});
  if (await ok.count() === 0) {
    // まだ裏返っていない。カードをタップして答えを出す
    const face = page.getByText("頭の中で答えてから、タップ");
    if (await face.count() === 0) break;
    await face.first().click({ force: true }); await page.waitForTimeout(400);
    if (await ok.count() === 0) break;
  }
  await ok.first().click(); rated++;
  await page.waitForTimeout(650);
}
log("③ レビュー", rated, "枚を評価 — 例外:", errors.length===0 ? "なし" : errors);

const after = await txt();
log("④ セット完了画面:", after.split("\n").slice(0,4).join(" / "));

// 統計がログから導出されて増えているか
await page.getByRole("button",{name:"ホームへ"}).first().click().catch(()=>{});
await page.waitForTimeout(300);
const home2 = await txt();
log("⑤ 評価後の総レビュー:", stat(home2,"総レビュー"), `(${legacy.totalReviews} + ${rated} = ${legacy.totalReviews+rated} のはず)`);

// 設定画面 — 同期UIは .env 未設定なら出ないこと
await page.getByRole("button",{name:"設定"}).first().click();
await page.waitForTimeout(300);
const settings = await txt();
log("⑥ 設定画面に同期UI:", settings.includes("端末間で同期") ? "出ている" : "出ていない(.env未設定なので正しい)");

// supabase-js が読み込まれていないこと = 遅延読み込みが効いている
log("⑦ 読み込まれたJS:", reqs.filter(u=>u.endsWith(".js")).join(", "));

// リロードして永続化を確認
await page.reload({waitUntil:"networkidle"});
await page.waitForTimeout(200);
log("⑧ リロード後も統計が残る:", stat(await txt(),"総レビュー"));
log("⑨ 通しての例外:", errors.length===0 ? "0件" : errors);

await browser.close(); server.close();
