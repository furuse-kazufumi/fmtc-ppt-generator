# fmtc-ppt-generator

FMTC 組込技術グループ 討論用PPTジェネレーター

## 概要

Markdownから討論用PPTXを自動生成するNode.jsスクリプト。
Perplexity Computerの各セッションから利用することを想定。

## 使い方

```bash
# 依存インストール（初回のみ）
npm install pptxgenjs

# 生成
node generate_simple_md_ppt.js <input.md> <output.pptx>
```

## Markdown構成ルール

- `# タイトル` → 表紙スライドのタイトルに使用
- `## セクション名` → スライド1枚（高さ超過時は自動分割）
- `### サブタイトル` → H3が2個以上かつ高さ超過 → 自動2カラム
- コードブロック ` ```lang ` → 薄グレー背景（#F4F4F4）・Courier Newフォント
- テーブル → PPTXテーブルに変換

## デザイン仕様

| 項目 | 値 |
|------|-----|
| スライドサイズ | 16:9 ワイド (13.33×7.5") |
| 背景 | 白 (#FFFFFF) |
| タイトルフォント | Calibri Bold 18pt |
| 本文フォント | Calibri 9pt |
| コードフォント | Courier New 7.5pt |
| アクセントカラー | #1A5CA8（青） |
| コード背景 | #F4F4F4（薄グレー） |

## 新セッションでの使い方（Perplexity Computer）

新しいセッションの冒頭に以下を貼り付ける：

```
GitHubリポジトリ https://github.com/furuse-kazufumi/fmtc-ppt-generator から
generate_simple_md_ppt.js を取得して、No.X「テーマ名」の討論用PPTを作成してください。
Markdownの構成はexamples/No01_poc_discussion.mdを参考にしてください。
```

## examples/

| ファイル | 内容 |
|----------|------|
| `No01_poc_discussion.md` | No.1 共通データ形式・規約の整備（完成版） |

## 仕様メモ（セッション引き継ぎ用）

- 表紙: `makeCoverSlide(pptx, h1)` — ページ番号カウント外
- 2カラム判定: `totalH > BODY_H*0.90 && h3s.length >= 2`（renderBlocksInner）
- 2カラム分割抑制: 2カラムで収まるなら `splitSection` で分割しない（v4修正済み）
- コードフォント: Consolas→Courier New（LibreOffice PDF印刷対応）
- ページ番号: `N / 全枚数`（表紙除く）
