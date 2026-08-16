# Flow — スワイプ式SRS(Anki 2.0プロトタイプ)

「想起の3秒は苦しいまま、その前後を全部気持ちよく」を設計原則にした
スワイプ式の間隔反復(SRS)学習アプリ。

## 機能(MVP)

- **縦スワイプレビュー**: タップで答え表示 → 上スワイプ「できた」/ 下スワイプ「まだ」の2択。答えを見るまでスワイプ不可(強制想起)
- **2択スケジューラ** (`src/lib/scheduler.js`): 中身は **FSRS**(ts-fsrs)。「まだ」は数分後に再登場。Ease Hell が起きない
- **雪だるま非表示設計**: 未消化枚数は見せない。ホームは「今日の5分、やる?」のみ。期限切れゼロなら「先取り練習」
- **カードの追加**: 1枚ずつのフォームが主導線(穴埋め / 表・裏の両対応)。AIに出力させた
  `【ヒント】 文 {{c1::答え}} 文|メモ` 形式の一括貼り付けも残してある (`src/lib/parser.js`)
- **カード一覧・編集・削除**、**コレクション**(英語以外の用途にも使える分類軸)
- **1日の上限と休眠カード**: 溜まっても「今日の分は終わり」が来る
- **リーチカード検出**: 何度も落としているカードに「分解する?」を提案
- **演出**: パーティクル、コンボ(3連続で金色)、ハプティクス、セット完了リング
- **永続化**: localStorage(`src/lib/storage.js`)。スキーマ版管理・マイグレーション・バックアップ書き出しつき
- 初回はこのチャットで作った実カード10枚がシードとして入っています

## 開発

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest
npm run lint     # oxlint
npm run build    # dist/ に静的ビルド
```

## デプロイ

静的サイトなのでどこでも動きます。

**Vercel(推奨・最速)**
```bash
npm i -g vercel && vercel
```
またはGitHubにpushして vercel.com でリポジトリをインポート(設定不要、自動検出)。

**Netlify**: Build command `npm run build`, Publish directory `dist`

**GitHub Pages**: `vite.config.js` に `base: "/リポジトリ名/"` を追加してから
```bash
npm run build && npx gh-pages -d dist
```

スマホでは「ホーム画面に追加」でフルスクリーンのアプリ的挙動になります。

## 構成

```
src/
  App.jsx                  # 画面遷移とセッション管理
  components/              # Home / ReviewCard / SessionComplete
                           # AddCards / CardEditor / CardList / Settings
  lib/                     # scheduler(FSRS) / session / dailyBudget / dormancy
                           # leech / stats / reviewLog / storage / migrations
                           # settings / parser / id / useNow / __tests__
  data/seedCards.js        # シード10枚
```

## ドキュメント

- **`SPEC.md`** — 何を作るか。設計原則と機能仕様。仕様の判断はすべてここに照らす
- **`IMPLEMENTATION_PLAN.md`** — 今どこにいて、次に何をどの順で作るか。タスクIDと受け入れ条件
- **`COST_ESTIMATE.md`** — 同期のサーバーコスト試算

ロードマップは SPEC.md §8 が正。ここには置かない(二重管理になるため)。
