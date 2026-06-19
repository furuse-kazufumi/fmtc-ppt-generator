/**
 * generate_simple_md_ppt.js
 * Markdown → 印刷向けシンプルPPTX（組込技術グループ討論用）
 *
 * 設計方針:
 *   - 白地黒文字、装飾ゼロ
 *   - H2単位で1スライド（長いH2はH3境界で複数スライドに分割）
 *   - タイトルバー（上）→ 本文（みっちり）→ ページ番号（下）
 *   - コードブロック: 薄グレー背景 + 枠線 + 等幅フォント
 *   - 表: 格子線テーブル
 *   - 情報密度最大: フォント小さめ・余白最小
 *   - 2カラムはH3境界で自然分割（コードが多いページで活用）
 *
 * 使用: node generate_simple_md_ppt.js <markdown_file> <output_pptx>
 */

'use strict';
const PptxGenJS = require('pptxgenjs');
const fs = require('fs');

// ============================================================
// レイアウト定数
// ============================================================
const SLIDE_W  = 13.33;   // インチ (16:9 ワイド)
const SLIDE_H  = 7.5;
const ML       = 0.35;    // 左マージン
const MR       = 0.35;    // 右マージン
const MT       = 0.12;    // 上マージン
const TITLE_H  = 0.60;    // タイトルバー高さ
const TITLE_Y  = MT;
const FOOTER_H = 0.24;
const FOOTER_Y = SLIDE_H - FOOTER_H - 0.05;
const BODY_Y   = TITLE_Y + TITLE_H + 0.08;
const BODY_H   = FOOTER_Y - BODY_Y - 0.05;
const BODY_W   = SLIDE_W - ML - MR;

// カラー
const C = {
  black:    '1A1A1A',
  dark:     '2C2C2C',
  mid:      '444444',
  gray:     '666666',
  lgray:    '999999',
  border:   'BBBBBB',
  tborder:  'CCCCCC',
  bg:       'FFFFFF',
  code_bg:  'F4F4F4',   // コードブロック背景（薄グレー）
  head_bg:  'EBEBEB',   // 表ヘッダー背景
  row_alt:  'FAFAFA',   // 表偶数行
  accent:   '1A5CA8',   // タイトルアクセント線
  title_bg: 'F0F2F5',   // タイトルバー背景
};

// フォント
const FB = 'Calibri';      // 本文
const FC = 'Courier New';  // コード（LibreOffice互換）
const FT = 'Calibri';      // タイトル

// フォントサイズ
const FS = {
  title:   18,    // H2タイトル
  h3:      10,    // H3小見出し
  h4:       9,    // H4小小見出し
  body:     9,    // 本文
  bullet:   9,    // 箇条書き
  table_h:  8,    // 表ヘッダー
  table_b:  7.5,  // 表本文
  code:     7.5,  // コード
  footer:   7.5,  // フッター
  page:     8,    // ページ番号
};

// 行高さ推定（インチ / 行）
const LH = {
  h3:      0.28,
  h4:      0.22,
  body:    0.195,
  bullet:  0.195,
  table_r: 0.225,
  code:    0.175,
};

// ============================================================
// Markdownパーサー
// ============================================================
function parseMarkdown(text) {
  const lines = text.split('\n');
  const sections = [];
  let sec = null;
  let blk = null;
  let inCode = false, codeLang = '', codeLines = [];
  let inTable = false, tableRows = [];

  function pushBlk() {
    if (!blk || !sec) return;
    if (blk.type === 'bullets' && blk.items.length > 0) sec.blocks.push({...blk});
    else if (blk.type === 'para' && blk.text.trim()) sec.blocks.push({...blk});
    blk = null;
  }
  function pushTable() {
    if (!inTable || !sec) return;
    if (tableRows.length > 0) sec.blocks.push({ type: 'table', rows: tableRows.slice() });
    tableRows = []; inTable = false;
  }

  for (const line of lines) {
    // コードブロック
    if (line.startsWith('```')) {
      if (!inCode) {
        pushBlk(); pushTable();
        inCode = true; codeLang = line.slice(3).trim(); codeLines = [];
      } else {
        inCode = false;
        if (sec) sec.blocks.push({ type: 'code', lang: codeLang, lines: codeLines.slice() });
        codeLang = ''; codeLines = [];
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    // テーブル
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-: ]+$/.test(c))) continue; // セパレータ行
      if (!inTable) { pushBlk(); inTable = true; tableRows = []; }
      tableRows.push(cells.map(clean));
      continue;
    } else if (inTable) { pushTable(); }

    // H2
    if (line.startsWith('## ')) {
      pushBlk(); pushTable();
      sec = { h2: line.slice(3).trim(), blocks: [] };
      sections.push(sec); blk = null; continue;
    }
    // H3
    if (line.startsWith('### ')) {
      pushBlk();
      if (sec) sec.blocks.push({ type: 'h3', text: line.slice(4).trim() });
      continue;
    }
    // H4
    if (line.startsWith('#### ')) {
      pushBlk();
      if (sec) sec.blocks.push({ type: 'h4', text: line.slice(5).trim() });
      continue;
    }
    // 水平線
    if (/^---+$/.test(line.trim())) { pushBlk(); pushTable(); continue; }

    // 箇条書き（順序なし・順序あり・インデント）
    const bulletMatch = line.match(/^(\s*)[-*] (.+)/);
    const numberedMatch = line.match(/^(\s*)\d+\. (.+)/);
    const m = bulletMatch || numberedMatch;
    if (m) {
      pushTable();
      if (!blk || blk.type !== 'bullets') { pushBlk(); blk = { type: 'bullets', items: [] }; }
      const indent = Math.floor(m[1].length / 2);
      blk.items.push({ text: clean(m[2].trim()), indent });
      continue;
    }

    // 空行
    if (!line.trim()) {
      if (blk?.type === 'bullets' || blk?.type === 'para') pushBlk();
      continue;
    }

    // 段落
    if (sec) {
      const t = clean(line.trim());
      if (!t) continue;
      if (!blk || blk.type !== 'para') { pushBlk(); blk = { type: 'para', text: t }; }
      else blk.text += ' ' + t;
    }
  }
  pushBlk(); pushTable();
  return sections;
}

/** Markdown記法をプレーンテキストに変換 */
function clean(t) {
  return t
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g,     '$1')
    .replace(/`(.+?)`/g,       '$1')
    .replace(/\[(.+?)\]\(.*?\)/g, '$1')
    .replace(/^>\s*/,           '')
    .trim();
}

// ============================================================
// スライド分割ロジック
// ============================================================

/** H2セクションをスライド単位に分割 */
function toSlides(sections) {
  const result = [];
  for (const sec of sections) {
    const sub = splitSection(sec);
    result.push(...sub);
  }
  return result;
}

/**
 * 1つのH2セクションを1枚以上のスライドに分割
 * 分割基準: 推定総高さが BODY_H を超える場合、H3境界で分割
 * ただし H3 が2個以上あり2カラムで収まる場合は分割しない
 */
function splitSection(sec) {
  const totalH = sec.blocks.reduce((s, b) => s + blockH(b, BODY_W) + 0.06, 0);

  if (totalH <= BODY_H * 1.05) {
    // 1枚に収まる
    return [{ title: sec.h2, sub: '', blocks: sec.blocks }];
  }

  // H3インデックスを取得
  const h3idx = sec.blocks.reduce((a, b, i) => b.type === 'h3' ? [...a, i] : a, []);

  // 2カラムで収まるか判定: H3が2個以上のとき、左右各列の高さが BODY_H 以内なら分割しない
  if (h3idx.length >= 2) {
    const colW = (BODY_W - 0.20) / 2;
    const mid  = h3idx[Math.ceil(h3idx.length / 2)] ?? Math.floor(sec.blocks.length / 2);
    const leftH  = sec.blocks.slice(0, mid).reduce((s, b) => s + blockH(b, colW) + 0.06, 0);
    const rightH = sec.blocks.slice(mid).reduce((s, b) => s + blockH(b, colW) + 0.06, 0);
    if (leftH <= BODY_H * 1.05 && rightH <= BODY_H * 1.05) {
      // 2カラムで1枚に収まる → 分割しない
      return [{ title: sec.h2, sub: '', blocks: sec.blocks }];
    }
  }

  if (h3idx.length < 2) {
    // H3が少ない → コード行数で機械的に分割
    return splitByHeight(sec.h2, sec.blocks, BODY_H);
  }

  // H3より前のブロック（前置き）を先に分離
  const preBlocks = h3idx[0] > 0 ? sec.blocks.slice(0, h3idx[0]) : [];
  const preH = groupH(preBlocks);

  // H3境界でグループ化してページを作る
  const groups = [];
  let gi = 0;
  const breaks = [...h3idx, sec.blocks.length];
  for (let k = 0; k < breaks.length - 1; k++) {
    const chunk = sec.blocks.slice(breaks[k], breaks[k + 1]);
    // 最初のグループには preH も加算して考慮
    const curGroupH = gi < groups.length ? groupH(groups[gi]) : 0;
    const extra = (gi === 0 && groups.length === 0) ? preH : 0;
    if (gi < groups.length && curGroupH + groupH(chunk) + extra <= BODY_H * 1.05) {
      groups[gi].push(...chunk);
    } else {
      groups.push([...chunk]);
      gi = groups.length - 1;
    }
  }

  // H3より前のブロック（前置き）を最初のグループに付加
  if (preBlocks.length > 0) {
    if (groups.length > 0) groups[0].unshift(...preBlocks);
    else groups.unshift(preBlocks);
  }

  return groups.map((blocks, i) => ({
    title: sec.h2,
    sub: groups.length > 1 ? `(${i + 1}/${groups.length})` : '',
    blocks,
  }));
}

function groupH(blocks) {
  return blocks.reduce((s, b) => s + blockH(b, BODY_W) + 0.06, 0);
}

/** 高さベースで強制分割
 * コードブロックが BODY_H を超える場合はコード行単位でさらに分割する
 * 前置きテキスト（para等）はコード先頭チャンクと同じページに入れる
 */
function splitByHeight(title, blocks, maxH) {
  const slides = [];
  let cur = [], h = 0;

  for (const b of blocks) {
    const bh = blockH(b, BODY_W) + 0.06;

    // コードブロックが単独で maxH を超える場合 → 行単位で分割
    if (b.type === 'code' && bh > maxH) {
      const preH   = h;
      const availH = maxH - preH - (preH > 0 ? 0.06 : 0);
      const linesFirst   = Math.max(1, Math.floor((availH - 0.30) / LH.code));
      const linesPerPage = Math.floor((maxH - 0.30) / LH.code);

      // 先頭チャンク（前置きテキストと同じページ）
      const firstChunk = { type: 'code', lang: b.lang, lines: b.lines.slice(0, linesFirst) };
      slides.push({ title, sub: '', blocks: [...cur, firstChunk] });
      cur = []; h = 0;

      // 残りを linesPerPage 行ずつ分割
      for (let i = linesFirst; i < b.lines.length; i += linesPerPage) {
        const chunk = { type: 'code', lang: b.lang, lines: b.lines.slice(i, i + linesPerPage) };
        slides.push({ title, sub: '', blocks: [chunk] });
      }
      continue;
    }

    if (h + bh > maxH && cur.length > 0) {
      slides.push({ title, sub: '', blocks: cur });
      cur = []; h = 0;
    }
    cur.push(b); h += bh;
  }
  if (cur.length) slides.push({ title, sub: '', blocks: cur });
  if (slides.length > 1) slides.forEach((s, i) => s.sub = `(${i+1}/${slides.length})`);
  return slides;
}


// ============================================================
// 高さ推定
// ============================================================
function blockH(b, w) {
  switch (b.type) {
    case 'h3':     return LH.h3;
    case 'h4':     return LH.h4;
    case 'para': {
      const cpl = Math.floor(w / 0.095);   // 1行あたりの文字数（等幅近似）
      return Math.max(LH.body, Math.ceil(b.text.length / cpl) * LH.body);
    }
    case 'bullets':
      return b.items.reduce((s, it) => {
        const cpl = Math.floor((w - it.indent * 0.18) / 0.095);
        return s + Math.max(1, Math.ceil(it.text.length / cpl)) * LH.bullet;
      }, 0) + 0.04;
    case 'table':
      return b.rows.length * LH.table_r + 0.12;
    case 'code':
      return b.lines.length * LH.code + 0.18;
    default:
      return 0.1;
  }
}

// ============================================================
// スライド描画
// ============================================================
function makeSlide(pptx, sd, pg, total, footerText) {
  const s = pptx.addSlide();
  s.background = { color: C.bg };

  // タイトルバー
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: TITLE_Y, w: SLIDE_W, h: TITLE_H,
    fill: { color: C.title_bg },
    line: { color: C.border, width: 0.5 },
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: TITLE_Y, w: 0.05, h: TITLE_H,
    fill: { color: C.accent }, line: { width: 0 },
  });

  const titleStr = sd.sub ? `${sd.title}  ${sd.sub}` : sd.title;
  s.addText(titleStr, {
    x: ML, y: TITLE_Y + 0.03, w: BODY_W - 0.5, h: TITLE_H - 0.06,
    fontSize: FS.title, bold: true, color: C.dark,
    fontFace: FT, valign: 'middle', wrap: true,
  });

  // フッター
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: FOOTER_Y, w: SLIDE_W, h: FOOTER_H,
    fill: { color: C.title_bg },
    line: { color: C.border, width: 0.5 },
  });
  s.addText(footerText, {
    x: ML, y: FOOTER_Y, w: BODY_W - 1.2, h: FOOTER_H,
    fontSize: FS.footer, color: C.lgray, fontFace: FB, valign: 'middle',
  });
  s.addText(`${pg} / ${total}`, {
    x: SLIDE_W - 1.3, y: FOOTER_Y, w: 1.1, h: FOOTER_H,
    fontSize: FS.page, color: C.gray, fontFace: FB, align: 'right', valign: 'middle',
  });

  // 本文レンダリング
  renderBlocks(s, pptx, sd.blocks, ML, BODY_Y, BODY_W, BODY_H);
}

// ============================================================
// 本文レンダリング
// ============================================================
function renderBlocks(s, pptx, blocks, x, y, w, maxH) {
  if (!blocks?.length) return;

  // 2カラム判定: 推定高さが利用可能高さの 90% 超 かつ H3が2個以上
  const totalH = blocks.reduce((acc, b) => acc + blockH(b, w) + 0.06, 0);
  const h3s = blocks.filter(b => b.type === 'h3');

  if (totalH > maxH * 0.90 && h3s.length >= 2) {
    renderTwoColumns(s, pptx, blocks, x, y, w, maxH);
  } else {
    renderColumn(s, pptx, blocks, x, y, w, maxH);
  }
}

function renderTwoColumns(s, pptx, blocks, x, y, w, maxH) {
  const colW = (w - 0.2) / 2;
  // H3インデックスを探して前半・後半に分割
  const h3idx = blocks.reduce((a, b, i) => b.type === 'h3' ? [...a, i] : a, []);
  const mid = h3idx[Math.ceil(h3idx.length / 2)];
  const col1 = blocks.slice(0, mid);
  const col2 = blocks.slice(mid);
  renderColumn(s, pptx, col1, x,            y, colW, maxH);
  renderColumn(s, pptx, col2, x + colW + 0.2, y, colW, maxH);
}

function renderColumn(s, pptx, blocks, x, y, w, maxH) {
  let cy = y;
  for (const b of blocks) {
    const bh = blockH(b, w);
    if (cy + bh > y + maxH + 0.15) break;
    drawBlock(s, pptx, b, x, cy, w, bh);
    cy += bh + 0.06;
  }
}

// ============================================================
// ブロック描画
// ============================================================
function drawBlock(s, pptx, b, x, y, w, h) {
  switch (b.type) {
    case 'h3':     drawH3(s, b, x, y, w);    break;
    case 'h4':     drawH4(s, b, x, y, w);    break;
    case 'para':   drawPara(s, b, x, y, w, h); break;
    case 'bullets':drawBullets(s, b, x, y, w, h); break;
    case 'table':  drawTable(s, pptx, b, x, y, w, h); break;
    case 'code':   drawCode(s, pptx, b, x, y, w, h);  break;
  }
}

function drawH3(s, b, x, y, w) {
  // H3: 下部に薄い区切り線 + 太字
  s.addShape(s.pptx?.ShapeType?.rect || 'rect', {
    x, y: y + LH.h3 - 0.025, w, h: 0.012,
    fill: { color: 'D0D8E8' }, line: { width: 0 },
  });
  s.addText(b.text, {
    x, y, w, h: LH.h3,
    fontSize: FS.h3, bold: true, color: C.accent,
    fontFace: FB, valign: 'bottom', margin: [0,0,0,0],
  });
}

function drawH4(s, b, x, y, w) {
  s.addText(b.text, {
    x, y, w, h: LH.h4,
    fontSize: FS.h4, bold: true, color: C.mid,
    fontFace: FB, valign: 'middle', margin: [0,0,0,0],
  });
}

function drawPara(s, b, x, y, w, h) {
  s.addText(b.text, {
    x, y, w, h: Math.max(h, LH.body),
    fontSize: FS.body, color: C.black,
    fontFace: FB, valign: 'top', wrap: true,
    margin: [0, 0, 0, 0],
  });
}

function drawBullets(s, b, x, y, w, h) {
  const rows = b.items.map(it => ({
    text: it.text,
    options: {
      bullet: { type: 'bullet' },
      indentLevel: Math.min(it.indent, 2),
      fontSize: FS.bullet,
      color: C.black,
      fontFace: FB,
      breakLine: true,
    },
  }));
  s.addText(rows, {
    x, y, w, h: Math.max(h, LH.bullet),
    valign: 'top', wrap: true,
    margin: [0, 0.08, 0, 0.02],
  });
}

function drawTable(s, pptx, b, x, y, w, h) {
  if (!b.rows?.length) return;
  const header = b.rows[0];
  const body   = b.rows.slice(1);
  const ncol   = header.length;
  if (!ncol) return;

  // 列幅: 最長文字列に比例配分
  const maxL = Array(ncol).fill(0);
  for (const row of b.rows)
    for (let i = 0; i < ncol; i++)
      maxL[i] = Math.max(maxL[i], (row[i] || '').length);
  const total = maxL.reduce((s, v) => s + Math.max(v, 3), 0);
  const colW  = maxL.map(v => Math.max((v / total) * w, 0.4));

  const makeRow = (row, isHead) => row.map((cell, ci) => ({
    text: cell || '',
    options: {
      fontSize:  isHead ? FS.table_h : FS.table_b,
      bold:      isHead,
      color:     C.dark,
      fontFace:  FB,
      fill:      { color: isHead ? C.head_bg : (ci % 2 === 0 ? C.bg : C.row_alt) },
      border: [
        { pt: 0.5, color: C.tborder },
        { pt: 0.5, color: C.tborder },
        { pt: 0.5, color: C.tborder },
        { pt: 0.5, color: C.tborder },
      ],
      align: isHead ? 'center' : 'left',
      valign: 'middle',
    },
  }));

  // 行高さ
  const rowH = Math.min(LH.table_r, Math.max(0.19, h / (b.rows.length + 0.5)));

  s.addTable(
    [makeRow(header, true), ...body.map(r => makeRow(r, false))],
    { x, y, w, rowH, colW, fontFace: FB }
  );
}

function drawCode(s, pptx, b, x, y, w, h) {
  const codeH = Math.max(h, b.lines.length * LH.code + 0.18);
  const safeH = Math.min(codeH, BODY_H - (y - BODY_Y) + 0.1);

  // 背景矩形（薄グレー + 枠線）
  s.addShape(pptx.ShapeType.rect, {
    x, y, w, h: safeH,
    fill: { color: C.code_bg },
    line: { color: C.border, width: 0.75 },
  });

  // 言語ラベル（右上角）
  if (b.lang) {
    s.addText(b.lang, {
      x: x + w - 0.9, y: y + 0.02, w: 0.85, h: 0.15,
      fontSize: 7, color: C.lgray, fontFace: FB, align: 'right',
    });
  }

  // コードテキスト: wrap:true で折り返し（等幅フォントのため横幅計算が難しく折り返しで対応）
  const maxLines = Math.floor((safeH - 0.12) / LH.code);
  const visible  = b.lines.slice(0, maxLines).join('\n');

  s.addText(visible, {
    x: x + 0.06, y: y + 0.06, w: w - 0.12, h: safeH - 0.10,
    fontSize: FS.code, color: C.dark,
    fontFace: FC, valign: 'top', wrap: true,
    margin: [0, 0, 0, 0],
  });
}

// ============================================================
// メイン
// ============================================================
async function main() {
  const [,, mdFile, outFile] = process.argv;
  if (!mdFile || !outFile) {
    console.error('Usage: node generate_simple_md_ppt.js <md> <out.pptx>');
    process.exit(1);
  }
  if (!fs.existsSync(mdFile)) {
    console.error(`Not found: ${mdFile}`); process.exit(1);
  }

  // フッターテキスト: Markdownの H1タイトルから取得
  const raw = fs.readFileSync(mdFile, 'utf8');
  const h1  = raw.split('\n').find(l => l.startsWith('# '))?.slice(2).trim()
              || mdFile;

  const sections = parseMarkdown(raw);
  const slides   = toSlides(sections);

  console.log(`H2セクション: ${sections.length} → スライド: ${slides.length}`);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  // 表紙スライドを先頭に追加（ページ番号にはカウントしない）
  makeCoverSlide(pptx, h1);

  const total = slides.length;
  slides.forEach((sd, i) => {
    console.log(`  [${i+1}] ${sd.title}${sd.sub ? ' ' + sd.sub : ''}`);
    const slideObj = pptx.addSlide();
    renderSlide(slideObj, pptx, sd, i + 1, total, h1);
  });

  await pptx.writeFile({ fileName: outFile });
  console.log(`完了: ${outFile}  (${total}枚)`);
}

/** シンプル表紙スライド */
function makeCoverSlide(pptx, title) {
  const s = pptx.addSlide();
  s.background = { color: C.bg };

  // 上部アクセントバー（タイトルバーの3倍高さ）
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: 0.12,
    fill: { color: C.accent }, line: { width: 0 },
  });

  // 左アクセント縦線
  s.addShape(pptx.ShapeType.rect, {
    x: ML, y: 0.12, w: 0.05, h: SLIDE_H - 0.12 - 0.12,
    fill: { color: C.accent }, line: { width: 0 },
  });

  // プロジェクト番号＋カテゴリ
  s.addText('No.1  |  組込技術グループ 討論用資料', {
    x: ML + 0.20, y: 1.8, w: BODY_W - 0.20, h: 0.35,
    fontSize: 11, color: C.lgray, fontFace: FB, valign: 'middle',
  });

  // メインタイトル（H1から取得）
  // "No.1 共通データ形式・規約の整備（JSON等）— 討論用資料" → 前半を大きく表示
  const mainTitle = title.replace(/\s*—.*$/, '').replace(/^[^\s]+\s+/, '').trim()
                  || title;
  s.addText(mainTitle, {
    x: ML + 0.20, y: 2.25, w: BODY_W - 0.20, h: 1.6,
    fontSize: 28, bold: true, color: C.dark,
    fontFace: FT, valign: 'top', wrap: true,
  });

  // サブタイトル
  s.addText('共通データ形式・規約の整備（JSON等）', {
    x: ML + 0.20, y: 3.95, w: BODY_W - 0.20, h: 0.40,
    fontSize: 13, color: C.accent, fontFace: FB, valign: 'middle',
  });

  // 区切り線
  s.addShape(pptx.ShapeType.rect, {
    x: ML + 0.20, y: 4.45, w: BODY_W - 0.20, h: 0.012,
    fill: { color: C.border }, line: { width: 0 },
  });

  // 日付・組織
  s.addText('2026年6月  /  FMTC 組込技術グループ', {
    x: ML + 0.20, y: 4.55, w: BODY_W - 0.20, h: 0.35,
    fontSize: 9, color: C.lgray, fontFace: FB, valign: 'middle',
  });

  // 下部アクセントバー
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: SLIDE_H - 0.12, w: SLIDE_W, h: 0.12,
    fill: { color: C.accent }, line: { width: 0 },
  });
}

function renderSlide(s, pptx, sd, pg, total, footerText) {
  s.background = { color: C.bg };

  // タイトルバー
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: TITLE_Y, w: SLIDE_W, h: TITLE_H,
    fill: { color: C.title_bg },
    line: { color: C.border, width: 0.5 },
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: TITLE_Y, w: 0.05, h: TITLE_H,
    fill: { color: C.accent }, line: { color: C.accent, width: 0 },
  });
  const titleStr = sd.sub ? `${sd.title}  ${sd.sub}` : sd.title;
  s.addText(titleStr, {
    x: ML, y: TITLE_Y + 0.04, w: BODY_W - 0.5, h: TITLE_H - 0.08,
    fontSize: FS.title, bold: true, color: C.dark,
    fontFace: FT, valign: 'middle', wrap: true,
  });

  // フッター
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: FOOTER_Y, w: SLIDE_W, h: FOOTER_H,
    fill: { color: C.title_bg },
    line: { color: C.border, width: 0.5 },
  });
  s.addText(footerText, {
    x: ML, y: FOOTER_Y, w: BODY_W - 1.2, h: FOOTER_H,
    fontSize: FS.footer, color: C.lgray, fontFace: FB, valign: 'middle',
  });
  s.addText(`${pg} / ${total}`, {
    x: SLIDE_W - 1.3, y: FOOTER_Y, w: 1.1, h: FOOTER_H,
    fontSize: FS.page, color: C.gray, fontFace: FB, align: 'right', valign: 'middle',
  });

  // 本文
  renderBlocksInner(s, pptx, sd.blocks, ML, BODY_Y, BODY_W, BODY_H);
}

function renderBlocksInner(s, pptx, blocks, x, y, w, maxH) {
  if (!blocks?.length) return;
  const totalH = blocks.reduce((a, b) => a + blockH(b, w) + 0.06, 0);
  const h3s = blocks.filter(b => b.type === 'h3');
  if (totalH > maxH * 0.90 && h3s.length >= 2) {
    renderTwoCols(s, pptx, blocks, x, y, w, maxH);
  } else {
    renderCol(s, pptx, blocks, x, y, w, maxH);
  }
}

function renderTwoCols(s, pptx, blocks, x, y, w, maxH) {
  const colW = (w - 0.2) / 2;
  const h3idx = blocks.reduce((a, b, i) => b.type === 'h3' ? [...a, i] : a, []);
  const mid = h3idx[Math.ceil(h3idx.length / 2)] ?? Math.floor(blocks.length / 2);
  renderCol(s, pptx, blocks.slice(0, mid), x,             y, colW, maxH);
  renderCol(s, pptx, blocks.slice(mid),    x + colW + 0.2, y, colW, maxH);
}

function renderCol(s, pptx, blocks, x, y, w, maxH) {
  let cy = y;
  for (const b of blocks) {
    const bh = blockH(b, w);
    // 最初のブロック（cy === y）は必ず描画する（高さ超過でもスキップしない）
    const isFirst = (cy === y);
    if (!isFirst && cy + bh > y + maxH + 0.15) break;
    drawBlockInner(s, pptx, b, x, cy, w, bh);
    cy += bh + 0.06;
  }
}

function drawBlockInner(s, pptx, b, x, y, w, h) {
  switch (b.type) {
    case 'h3': {
      s.addText(b.text, {
        x, y, w, h: LH.h3,
        fontSize: FS.h3, bold: true, color: C.accent,
        fontFace: FB, valign: 'bottom', margin: [0,0,0,0],
      });
      // 下線
      s.addShape(pptx.ShapeType.rect, {
        x, y: y + LH.h3 - 0.02, w, h: 0.010,
        fill: { color: 'D0D8E8' }, line: { width: 0 },
      });
      break;
    }
    case 'h4':
      s.addText(b.text, {
        x, y, w, h: LH.h4,
        fontSize: FS.h4, bold: true, color: C.mid,
        fontFace: FB, valign: 'middle', margin: [0,0,0,0],
      });
      break;
    case 'para':
      s.addText(b.text, {
        x, y, w, h: Math.max(h, LH.body),
        fontSize: FS.body, color: C.black,
        fontFace: FB, valign: 'top', wrap: true, margin: [0,0,0,0],
      });
      break;
    case 'bullets': {
      const rows = b.items.map(it => ({
        text: it.text,
        options: {
          bullet: { type: 'bullet' },
          indentLevel: Math.min(it.indent, 2),
          fontSize: FS.bullet, color: C.black, fontFace: FB, breakLine: true,
        },
      }));
      s.addText(rows, {
        x, y, w, h: Math.max(h, LH.bullet),
        valign: 'top', wrap: true, margin: [0, 0.06, 0, 0.02],
      });
      break;
    }
    case 'table': {
      const { rows } = b;
      if (!rows?.length) break;
      const hdr  = rows[0];
      const body = rows.slice(1);
      const nc   = hdr.length;
      if (!nc) break;
      const maxL = Array(nc).fill(0);
      for (const row of rows)
        for (let i = 0; i < nc; i++)
          maxL[i] = Math.max(maxL[i], (row[i] || '').length);
      const tot  = maxL.reduce((s, v) => s + Math.max(v, 3), 0);
      const colW = maxL.map(v => Math.max((v / tot) * w, 0.38));
      const rowH = Math.min(LH.table_r, Math.max(0.18, h / (rows.length + 0.5)));

      const mkRow = (row, isH) => row.map((cell, ci) => ({
        text: cell || '',
        options: {
          fontSize: isH ? FS.table_h : FS.table_b,
          bold: isH, color: C.dark, fontFace: FB,
          fill: { color: isH ? C.head_bg : (ci % 2 === 0 ? C.bg : C.row_alt) },
          border: [
            {pt:0.5, color:C.tborder},{pt:0.5, color:C.tborder},
            {pt:0.5, color:C.tborder},{pt:0.5, color:C.tborder},
          ],
          align: isH ? 'center' : 'left', valign: 'middle',
        },
      }));
      s.addTable([mkRow(hdr, true), ...body.map(r => mkRow(r, false))],
        { x, y, w, rowH, colW, fontFace: FB });
      break;
    }
    case 'code': {
      // 利用可能な残り高さ（yからFOOTERの持前まで）
      const remainH = (BODY_Y + BODY_H) - y - 0.03;
      const codeNatural = b.lines.length * LH.code + 0.18;
      // 利用可能高に収める（超える場合は残り高さを使う）
      const safeH = Math.min(codeNatural, Math.max(remainH, 0.3));
      s.addShape(pptx.ShapeType.rect, {
        x, y, w, h: safeH,
        fill: { color: C.code_bg },
        line: { color: C.border, width: 0.75 },
      });
      if (b.lang) {
        s.addText(b.lang, {
          x: x + w - 0.9, y: y + 0.02, w: 0.85, h: 0.14,
          fontSize: 7, color: C.lgray, fontFace: FB, align: 'right',
        });
      }
      const maxL = Math.floor((safeH - 0.12) / LH.code);
      s.addText(b.lines.slice(0, maxL).join('\n'), {
        x: x + 0.06, y: y + 0.05, w: w - 0.12, h: safeH - 0.09,
        fontSize: FS.code, color: C.dark,
        fontFace: FC, valign: 'top', wrap: true, margin: [0,0,0,0],
      });
      break;
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
