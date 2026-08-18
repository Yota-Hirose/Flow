# 同期のセットアップ (T-20 / T-21)

アプリ側は完成している。**あとはSupabaseのプロジェクトを作って鍵を貼るだけ。**
所要10分。以下は一度だけやれば済む。

> `.env` が無い状態でも、アプリはこれまで通り動く。同期メニューが出なくなるだけ
> (SPEC 原則6: ローカルファースト)。壊れる心配なく後回しにできる。

---

## 1. プロジェクトを作る

1. https://supabase.com でサインアップ
2. New project → 名前 `flow` / リージョン **Northeast Asia (Tokyo)**
   — 日本のユーザーが主なので東京。往復が100ms以上変わる
3. データベースのパスワードは保管しておく(今回は使わないが再発行が面倒)

無料枠(Free)で始めてよい。**課金が必要になるのは以下のどれかに当たったとき:**

| 制限 | 無料枠 | Flowでの目安 |
|---|---|---|
| DBサイズ | 500MB | 1ユーザー約2MB → **約250人** |
| 月間アクティブユーザー | 50,000 | 当面到達しない |
| 7日間アクセスが無いと一時停止 | — | ドッグフーディング中は要注意 |

Pro($25/月)への移行判断は COST_ESTIMATE.md を参照。

---

## 2. テーブルを作る

ダッシュボード左の **SQL Editor** を開き、`supabase/schema.sql` の中身を
そのまま貼って **Run**。

作られるもの:

- `flow_docs` … カード・コレクション・設定。1ユーザー1行
- `flow_reviews` … 復習ログ。追記専用
- 行レベルセキュリティ(RLS)のポリシー

**RLSが有効になっていることを必ず確認する。** Table Editor で各テーブルを開き、
"RLS enabled" の表示があること。これが無いと、公開鍵を持つ誰もが他人のカードを
読める状態になる。ここだけは目視で確認してほしい。

何度実行しても壊れないので、不安なら2回流してよい。

---

## 3. メール(マジックリンク)の設定

**Authentication → Providers → Email**

- Enable Email provider: ON
- **Confirm email: ON**
- **Secure email change: ON**
- Password は使わないので設定不要

**Authentication → URL Configuration**

- Site URL: 本番のURL(例 `https://flow-weld-sigma.vercel.app`)
- Redirect URLs に開発用も足す: `http://localhost:5173`

> Supabaseの内蔵メールは**1時間あたり数通**しか送れない。自分のテスト用なら
> 足りるが、人に配る段階になったら Resend / SendGrid を
> **Authentication → Emails → SMTP Settings** に設定する。
> ここを忘れたまま公開すると「リンクが届かない」問い合わせだけが積み上がる。

---

## 4. URLと鍵をアプリに渡す

**ダッシュボード右上の緑の「Connect」ボタン → App Frameworks** を開く。
プロジェクトURLと鍵が両方まとめて出るので、ここからコピーするのが一番速い。

個別のページから取る場合(ダッシュボードの構成は変わることがある):

| 欲しいもの | 場所 |
|---|---|
| プロジェクトURL | **Settings → Data API**(旧: Settings → API の Project URL) |
| 公開鍵 | **Settings → API Keys** |

> **URLはブラウザのアドレスバーからも分かる。**
> `https://supabase.com/dashboard/project/abcdefghijklmnop` を開いているなら、
> プロジェクトURLは `https://abcdefghijklmnop.supabase.co`。
> この `abcdefghijklmnop` が project ref で、URLはこれを挟むだけの決まった形。

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxx
```

### 鍵が2種類ある件

Supabaseは鍵の方式を移行中で、**古いプロジェクトと新しいプロジェクトで
API Keys ページの見た目が違う。**

| | 公開してよい鍵(これを使う) | 絶対に貼らない鍵 |
|---|---|---|
| 新方式 | `sb_publishable_...` | `sb_secret_...` |
| 旧方式 | `anon` (`eyJhbGci...`) | `service_role` |

**anonキーは2026年末に廃止される。** 新しく作ったプロジェクトなら publishable を
使う。アプリ側は両方の名前を受けるようにしてあるので、旧キーしか出てこない
場合は `.env` のコメントアウトを外して `VITE_SUPABASE_ANON_KEY` に入れればよい。

**secret / service_role キーは絶対に `.env` へ書かない。** これはRLSを無視できる鍵で、
漏れると全ユーザーのデータが読める。名前に `secret` か `service` が入っていたら
それは違う鍵。

### 本番環境

Vercel / Cloudflare Pages では、同じ2つを環境変数として登録する。
`VITE_` で始まる変数はビルド時にバンドルへ埋め込まれるので、
**設定したら再デプロイが要る。**

---

## 5. 確認

```bash
npm run dev
```

1. 設定 → 「端末間で同期する」にメールアドレスを入れて送信
2. 届いたリンクを開く → 設定画面にアドレスが出る
3. Supabase の Table Editor で `flow_docs` に1行、`flow_reviews` に行が入っている
4. **別のブラウザ(またはシークレットウィンドウ)で同じアドレスでログイン**
   → カードと学習記録が降りてくる

### 合流の確認(ここが本番)

1. 端末Aで数枚レビューする
2. 端末Bを**オフラインにして**別のカードを数枚レビューする
3. 端末Bをオンラインに戻す

→ 両方のレビューが残り、総レビュー数が合計になる。片方が消えたらバグ。

---

## 6. デプロイ(Vercel / Cloudflare Pages)

**`.env` はアップロードしない。** `.gitignore` に入れてあるのでコミットもされない。
代わりに**ホスティング側の環境変数**に同じ2つを登録する。

### Vercel

**プロジェクト → Settings → Environment Variables** で追加する。

> **「Environments」と間違えやすい。** サイドバーに紛らわしい名前が2つ並んでいる。
>
> | ページ | 中身 | |
> |---|---|---|
> | **Environment Variables** | Key / Value を入れる欄がある | ← **こっち** |
> | Environments | Production / Preview のブランチ設定。Create Environment は**$50/月の有料機能** | 使わない |
>
> URLの末尾で見分けるのが確実:
> `/settings/environment-variables` が正しく、`/settings/environments` は別ページ。

| Key | Value | 適用先 |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` | Production / Preview / Development すべて |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | 同上 |

CLIでもよい:

```bash
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production
```

**ここが一番よくある詰まりどころ:**

> **環境変数を足しただけでは既存のデプロイに反映されない。**
> Vercelの仕様で、環境変数の変更は**新しいデプロイにしか適用されない**。
> `VITE_` で始まる変数は**ビルド時にバンドルへ焼き込まれる**ので、なおさら
> ビルドし直しが要る。
>
> → **Deployments → 最新のデプロイの「…」→ Redeploy**、または何か push する。
> これをやらないと「ローカルでは同期できるのに本番だと同期メニューが出ない」
> という状態になる。

#### 「Keep This Value Private」の警告が出たら → **Config を選ぶ**

> The VITE_ prefix exposes this value to the browser. Remove the prefix, or
> change the variable to Config if it's safe to expose.

**この2つに関しては正しく「公開してよい値」なので、Config を選ぶ。**

- publishable / anon キーは**ブラウザに配られる前提の公開鍵**。仕様上どのユーザーにも
  同じものが届く。鍵は「どのプロジェクトか」を示すだけで、アクセス制御はRLSが行う
- プロジェクトURLも隠す意味がない

**`VITE_` プレフィックスは絶対に外さない。** Viteは意図しない環境変数の流出を防ぐため、
`VITE_` が付いたものだけをバンドルへ埋め込む。外すとアプリから読めなくなり、
同期が動かなくなる。**このプレフィックスは「公開してよいと明示する印」**であって、
警告が言う「Remove しろ」はこのケースには当てはまらない。

ただし**これが安全なのはRLSが効いている場合だけ**(手順2)。効いていなければ、
この公開鍵を持つ誰もが他人のカードを読める。`sb_secret_...` / `service_role` を
ここへ入れてはいけないのは、まさにこの警告が本来想定している事故。

### Cloudflare Pages

**プロジェクト → Settings → Environment variables** に同じ2つ。
Production と Preview で別々に登録する必要がある。反映にビルドが要るのは同じ。

> Vercelの **Hobbyプランは商用利用が禁止**されている(公式ドキュメントに
> 「non-commercial, personal use only」と明記)。収益化するなら Pro($20/月)か、
> Cloudflare Pages への移行が要る(`COST_ESTIMATE.md`)。

### Supabase側のURL登録(これを忘れるとログインできない)

デプロイ先のURLを **Authentication → URL Configuration** に登録する。
アプリはログインを始めた画面のURLへ戻るので、**そのURLが許可されていないと
メールのリンクを開いても戻ってこない。**

**Site URL**

```
https://flow-weld-sigma.vercel.app
```

**Redirect URLs**(複数登録できる)

```
https://flow-weld-sigma.vercel.app/**
http://localhost:5173/**
```

プレビューデプロイ(ブランチごとに毎回URLが変わる)でもログインしたいなら、
ワイルドカードを足す:

```
https://*-<チーム名またはアカウント名>.vercel.app/**
```

`*` は `.` と `/` 以外にマッチ、`**` は何にでもマッチする。

### デプロイ後の確認

1. 本番URLを開く → 設定に「端末間で同期する」が**出ている**
   (出ていなければ環境変数かRedeployのどちらか)
2. メールを送ってログイン → 設定にアドレスが出る
3. スマホでも同じアドレスでログイン → カードと学習記録が降りてくる

---

## 動かないときに見るところ

| 症状 | 原因 |
|---|---|
| 同期メニューが出ない | `.env` が読まれていない。dev サーバを再起動する |
| `Invalid API key` | secret/service_role キーを貼っている、または鍵とURLが別プロジェクトのもの |
| メールが届かない | 迷惑メール / 送信レート上限 / Redirect URLs 未登録 |
| リンクを開いてもログインされない | Site URL とアクセスしているURLが違う |
| `new row violates row-level security policy` | ログインできていない。セッション切れ |
| 本番だけ同期メニューが出ない | 環境変数を足したあと**Redeployしていない**。`VITE_`はビルド時に焼き込まれる |
| 本番でメールのリンクが戻ってこない | Supabaseの Redirect URLs に本番URLが未登録 |
| プレビューURLだけログインできない | Redirect URLs にワイルドカードを足す |

---

## 仕組み(直すときのために)

```
src/lib/sync/
  merge.js          2つのDBを畳む純関数。バックエンドを知らない
  engine.js         いつ送るか。アダプタの契約(pull/push)もここ
  memoryAdapter.js  テスト用のニセサーバ。2端末・競合・再送を再現
  supabase.js       Supabase実装。差分同期とマジックリンク
  useSync.js        Reactへの接続。ここだけがフレームワークを知る
```

**要点3つ**

1. **復習ログが追記専用なので、マージは和集合で済む。** 学習の実績は
   マージで失われない。これが同期全体の設計を単純にしている。
2. **統計は保存せず、ログから数え直す。** 累積値は2端末で足せない
   (足せば二重、maxを取れば片方が消える)ので、そもそも持たない。
3. **カードの状態は合流したログから作り直す。** 端末Aの3回と端末Bの2回が
   両方効く。FSRSの fuzz を切ってあるのはこのため — 乱数が入ると
   同じログから同じ状態が出ず、端末間で永久にずれ続ける。

バックエンドを乗り換えるときは `supabase.js` を差し替えるだけでよい。
`memoryAdapter.js` に対するテストが通れば、契約は満たせている。
