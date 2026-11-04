/**
 * 文档解析：.docx / .md / .txt → 统一块序列
 *
 * 块（block）三种：
 *   { type: 'heading', level: 1..6, text }
 *   { type: 'para', text }
 *   { type: 'table', rows: [[cell, ...], ...] }
 *
 * docx 走 mammoth（纯 JS，本地解析，不联网）；先转 HTML 再取块，
 * 这样标题层级、表格行列都能保住 —— 直接用 extractRawText 会把这些结构全抹平。
 */
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

const 最大字节 = 40 * 1024 * 1024; // 单文件 40MB 上限：再大就不是「合同/文档」而是数据集了

export function 认格式(路径) {
  const 后缀 = extname(路径).toLowerCase();
  if (后缀 === '.docx') return 'docx';
  if (后缀 === '.md' || 后缀 === '.markdown') return 'md';
  if (后缀 === '.txt' || 后缀 === '.text') return 'txt';
  return null;
}

export async function 解析文件(路径) {
  let 尺寸;
  try {
    尺寸 = statSync(路径).size;
  } catch (e) {
    return { ok: false, 原因: `读不到文件：${路径}（${e.code || e.message}）` };
  }
  if (尺寸 > 最大字节) return { ok: false, 原因: `文件过大：${(尺寸 / 1048576).toFixed(1)}MB，上限 ${最大字节 / 1048576}MB` };
  const 格式 = 认格式(路径);
  if (!格式) return { ok: false, 原因: `不支持的文件类型：${路径}（只支持 .docx / .md / .txt）` };
  let 文本;
  try {
    文本 = readFileSync(路径);
  } catch (e) {
    return { ok: false, 原因: `读不到文件：${路径}（${e.code || e.message}）` };
  }
  try {
    if (格式 === 'docx') {
      const blocks = await 解析docx(文本);
      if (!blocks.length) return { ok: false, 原因: `docx 里没有可读段落：${路径}` };
      return { ok: true, 格式, blocks };
    }
    const blocks = 解析纯文本(文本.toString('utf8'), 格式);
    if (!blocks.length) return { ok: false, 原因: `文件里没有可读段落：${路径}` };
    return { ok: true, 格式, blocks };
  } catch (e) {
    return { ok: false, 原因: `解析失败：${路径}（${e && e.message ? e.message : e}）` };
  }
}

/* ── docx ── */

async function 解析docx(缓冲) {
  const mammoth = await import('mammoth');
  const { value: html, messages } = await mammoth.convertToHtml({ buffer: 缓冲 }, {
    // Word 里常见「标题 1 / Heading 1 / 标题1」都能落到 h1..h6
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Subtitle'] => h2:fresh",
      "p[style-name='标题'] => h1:fresh",
      "p[style-name='标题 1'] => h1:fresh",
      "p[style-name='标题 2'] => h2:fresh",
      "p[style-name='标题 3'] => h3:fresh",
    ],
  });
  return 解析html块(html).concat(警告块(messages));
}

function 警告块(messages) {
  const 警告 = (messages || []).filter((m) => m.type === 'warning').slice(0, 5).map((m) => m.message);
  return 警告.length ? [{ type: 'meta', text: 'docx 解析警告：' + 警告.join('；') }] : [];
}

/** 极简 HTML 取块：只认 h1-h6 / p / table 三种顶层块（mammoth 的输出很规整）。 */
export function 解析html块(html) {
  const blocks = [];
  const 顶层 = /<(h[1-6]|p|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = 顶层.exec(html))) {
    const 标签 = m[1].toLowerCase();
    const 体 = m[2];
    if (标签 === 'table') {
      const rows = [];
      for (const 行 of 体.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [];
        for (const 格 of 行[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
          cells.push(去标签(格[1]));
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) blocks.push({ type: 'table', rows });
      continue;
    }
    const text = 去标签(体);
    if (!text) continue;
    if (标签[0] === 'h') blocks.push({ type: 'heading', level: Number(标签[1]), text });
    else blocks.push({ type: 'para', text });
  }
  return blocks;
}

function 去标签(s) {
  return 解实体(String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function 解实体(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/* ── Markdown / 纯文本 ── */

export function 解析纯文本(原文, 格式) {
  const 行 = 原文.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let 段缓冲 = [];
  let 代码围栏 = false;
  let i = 0;

  const 冲段 = () => {
    const text = 段缓冲.map((x) => x.trim()).filter(Boolean).join(' ').replace(/[ \t]+/g, ' ').trim();
    if (text) blocks.push({ type: 'para', text });
    段缓冲 = [];
  };

  while (i < 行.length) {
    const 行文 = 行[i];
    const 去空白 = 行文.trim();

    if (/^```/.test(去空白)) {
      代码围栏 = !代码围栏;
      i++;
      continue;
    }
    if (代码围栏) {
      if (去空白) 段缓冲.push(去空白);
      i++;
      continue;
    }
    if (!去空白) {
      冲段();
      i++;
      continue;
    }
    const 标题 = 去空白.match(/^(#{1,6})\s+(.*)$/);
    if (标题) {
      冲段();
      const text = 标题[2].replace(/\s+#+\s*$/, '').trim();
      if (text) blocks.push({ type: 'heading', level: 标题[1].length, text });
      i++;
      continue;
    }
    // Markdown 表格：本行含 |，且下一行是 |---| 分隔行
    if (去空白.includes('|') && i + 1 < 行.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(行[i + 1]) && 行[i + 1].includes('-')) {
      冲段();
      const 表 = [];
      表.push(拆表格行(去空白));
      i += 2;
      while (i < 行.length && 行[i].includes('|') && 行[i].trim()) {
        表.push(拆表格行(行[i].trim()));
        i++;
      }
      blocks.push({ type: 'table', rows: 表 });
      continue;
    }
    // 列表项各自成段（去掉项目符号，保留内容）
    const 列表 = 去空白.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (列表) {
      冲段();
      if (列表[1].trim()) blocks.push({ type: 'para', text: 列表[1].trim() });
      i++;
      continue;
    }
    段缓冲.push(去空白);
    i++;
  }
  冲段();
  return blocks;
}

function 拆表格行(行文) {
  let s = 行文.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}
