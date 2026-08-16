# Flow — スワイプ式SRS(Anki 2.0プロトタイプ)

「想起の3秒は苦しいまま、その前後を全部気持ちよく」を設計原則にした
スワイプ式の間隔反復(SRS)学習アプリ。

## 機能(MVP)

- **縦スワイプレビュー**: タップで答え表示 → 上スワイプ「できた」/ 下スワイプ「まだ」の2択。答えを見るまでスワイプ不可(強制想起)
- **2択スケジューラ** (`src/lib/scheduler.js`): SM-2系の簡易実装。「まだ」は10分後に再登場、「できた」は 1日 → 3日 → ×ease で間隔拡大
- **雪だるま非表示設計**: 未消化枚数は見せない。ホームは「今日の5分、やる?」のみ。期限切れゼロなら「先取り練習」
- **カード取り込み** (`src/lib/parser.js`): AIに出力させた
  `【ヒント】 文 {{c1::答え}} 文|メモ` 形式を貼り付けるだけで一括登録
- **演出**: パーティクル、コンボ(3連続で金色)、ハプティクス、セット完了リング
- **永続化**: localStorage(`src/lib/storage.js`)。端末内で完結、アカウント不要
- 初回はこのチャットで作った実カード10枚がシードとして入っています

## 開発

```bash
npm install
npm run dev      # http://localhost:5173
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
  components/
    Home.jsx               # ホーム(雪だるま非表示の入口)
    ReviewCard.jsx          # スワイプカード本体
    SessionComplete.jsx     # セット完了演出
    AddCards.jsx            # 貼り付け取り込み
  lib/
    scheduler.js            # 2択SRSスケジューラ
    storage.js              # localStorage永続化
    parser.js               # Claude形式パーサ
  data/seedCards.js         # シード10枚
```

## ロードマップ(会話で設計した残り)

- [ ] スケジューラを ts-fsrs(FSRS公式)に差し替え
- [ ] インボックス(共有シート/拡張から1タップ保存 → AIがカード候補を提案)
- [ ] AIによる文脈再生成(同じ語を毎回違う例文で出題)
- [ ] リーチカード自動検出(「このカード苦しんでるね。分解する?」)
- [ ] 週次「先週のあなた」レポート
- [ ] 復帰ボーナス(ストリーク切れの罰ではなく再開の報酬)
