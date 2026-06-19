# 討論用PPT 作成手順（新セッション用）

## 使い方

新しいセッションを開いたら、以下をそのまま貼り付けて `No.X` の番号だけ書き換える。

---

```
【PPT作成依頼】No.X

以下の手順でPPT生成まで自動実行してください。

## セットアップ
gh repo clone furuse-kazufumi/fmtc-ppt-generator
cd fmtc-ppt-generator && npm install pptxgenjs

## 作成対象
- このSpaceのインストラクションに記載されたNo.Xの内容を参照
- examples/No01_poc_discussion.md を構成の参考にする
- README.md のフォーマットルールに従う

## 出力
- Markdown: noXX_poc_discussion.md
- PPTX: output_simple/NoXX_discussion.pptx
- share_file の name引数: NoXX_discussion_pptx

## 完了まで自動実行
Markdown作成 → PPTX生成 → PDF/QA画像確認 → share_fileで共有
```

---

## フォーマット早見表

| 項目 | 仕様 |
|------|------|
| 背景 | 白・黒文字（黒地NG） |
| 表紙 | タイトル・日付・FMTC組込技術グループ |
| 構成 | H2単位でスライド生成（10セクション前後） |
| 2カラム | H3×2かつ高さ超過で自動適用 |
| コード | Courier New・薄グレー背景 #F4F4F4 |
| ページ番号 | 表紙除く・N/全枚数形式 |
| 分割表記 | タイトル末尾に (1/N)(2/N) |

## Markdown構成テンプレート（10セクション）

| # | H2セクション | 内容 |
|---|-------------|------|
| 1 | 背景・課題・ゴール | 表×2 |
| 2 | 基礎知識 | コード+要点（H3×2） |
| 3 | PoC手順書 Step 1〜2 | コード×2（H3×2） |
| 4 | PoC手順書 Step 3〜4 | コード×2（H3×2・2カラム） |
| 5 | PoC手順書 Step 5〜6 | コード×2（H3×2・2カラム） |
| 6 | 動作確認：スクリプトと期待出力 | コード×2（H3×2・2カラム） |
| 7 | 実施体制・工数・スケジュール | 表×2 |
| 8 | 討論ポイント①② | 表×2（H3×2） |
| 9 | 討論ポイント③・失敗パターン・波及効果 | 表×2（H3×2） |
| 10 | 参考文献・実施判断基準 | 表×2（H3×2） |

## QA手順

```bash
soffice --headless --convert-to pdf NoXX_discussion.pptx
pdftoppm -jpeg -r 150 NoXX_discussion.pdf qa/slide
# → run_subagent で全スライド視覚検査
```

## ジェネレーター更新履歴

| バージョン | 変更内容 |
|-----------|---------|
| v1.0 | 初期版・表紙・2カラム・splitByHeight |
| v1.1 | コードフォントConsolas→Courier New（LibreOffice印刷対応） |
| v1.2 | splitSection: 2カラムで収まる場合は分割しない判定を追加 |
