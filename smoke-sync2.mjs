import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const ROOT="/tmp/flow/dist"; const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css"};
const reqs=[];
const server=http.createServer((req,res)=>{reqs.push(req.url);let p=path.join(ROOT,decodeURIComponent(req.url.split("?")[0]));if(!fs.existsSync(p)||fs.statSync(p).isDirectory())p=path.join(ROOT,"index.html");res.writeHead(200,{"Content-Type":MIME[path.extname(p)]??"application/octet-stream"});fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(4332,r));
// サンドボックス上のChromiumがあればそれを、無ければ playwright 同梱のものを使う
const SANDBOX_CHROME="/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXE=fs.existsSync(SANDBOX_CHROME)?SANDBOX_CHROME:undefined;
const browser=await chromium.launch({executablePath:EXE,args:EXE?["--no-sandbox"]:[]});
const page=await browser.newPage({viewport:{width:390,height:1000}});
const errors=[]; page.on("pageerror",e=>errors.push(String(e))); page.on("console",m=>m.type()==="error"&&errors.push(m.text()));
const txt=()=>page.locator("body").innerText(); const log=(...a)=>console.log(...a);

await page.goto("http://localhost:4332/",{waitUntil:"networkidle"});
await page.evaluate(()=>localStorage.clear());
await page.reload({waitUntil:"networkidle"});
log("① 起動直後に読み込まれたJS:", reqs.filter(u=>u.endsWith(".js")).length, "本 — supabase:", reqs.some(u=>u.includes("dist-")) ? "読み込んだ" : "読み込んでいない(正しい)");

await page.getByRole("button",{name:"設定"}).first().click();
await page.waitForTimeout(400);
const s = await txt();
log("② 設定画面に同期UI:", s.includes("端末間で同期する") ? "出ている" : "出ていない");
log("   文言:", s.split("\n").filter(l=>l.includes("ログインしなくても")||l.includes("スマホとPC")).join(" / "));
log("③ 設定を開いた時点でも supabase は:", reqs.some(u=>u.includes("dist-")) ? "読み込んだ" : "まだ読み込んでいない(正しい)");

// メール送信 = ここで初めて supabase-js を取りに行く
await page.getByPlaceholder("you@example.com").fill("test@example.com");
await page.getByRole("button",{name:"リンクを送る"}).click();
await page.waitForTimeout(2500);
log("④ 送信後 supabase を:", reqs.some(u=>u.includes("dist-")) ? "読み込んだ(遅延読み込みが効いている)" : "読み込んでいない");
const s2 = await txt();
log("   結果表示:", s2.split("\n").filter(l=>l.includes("送りました")||l.includes("Failed")||l.includes("送れません")||l.includes("fetch")).join(" / ") || "(ダミー鍵なので失敗表示のはず)");

// 学習が同期の失敗に巻き込まれないこと(原則6)
await page.getByRole("button",{name:/戻る|ホーム/}).first().click().catch(()=>{});
await page.waitForTimeout(300);
await page.getByRole("button",{name:/セット開始|先取り練習|それでも続ける/}).first().click();
await page.waitForTimeout(400);
let rated=0;
for(let i=0;i<3;i++){
  const ok=page.getByRole("button",{name:"できた ↑"});
  if(await ok.count()===0){ const f=page.getByText("頭の中で答えてから、タップ"); if(await f.count()===0) break; await f.first().click({force:true}); await page.waitForTimeout(400); if(await ok.count()===0) break; }
  await ok.first().click(); rated++; await page.waitForTimeout(650);
}
log("⑤ 同期が失敗している状態でもレビューできる:", rated, "枚 / 例外:", errors.filter(e=>!e.includes("Failed to fetch")&&!e.includes("supabase")&&!e.includes("net::")).length===0?"なし":errors);
await browser.close(); server.close();
