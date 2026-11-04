#!/usr/bin/env node
/**
 * dsh-doc-compare —— 命令行入口
 *
 * 用法：
 *   dsh-doc-compare <文件A> <文件B> [--json] [--out 报告.md] [--max-paragraphs 2000] [--quiet]
 *
 * 退出码：0 无差异 / 1 有差异 / 2 解析失败
 * 默认把 Markdown 报告打到 stdout；--json 打机器可读 JSON；--out 另存文件。
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { 解析文件 } from '../lib/parse.js';
import { 比较, 生成报告, 生成JSON } from '../lib/diff.js';

const 参数 = process.argv.slice(2);
const 文件们 = [];
let 要JSON = false;
let 输出路径 = '';
let 最大段落 = 2000;
let 安静 = false;

for (let i = 0; i < 参数.length; i++) {
  const a = 参数[i];
  if (a === '--json') 要JSON = true;
  else if (a === '--quiet') 安静 = true;
  else if (a === '--help' || a === '-h') { 用法(); process.exit(0); }
  else if (a === '--out' || a === '-o') { 输出路径 = 参数[++i] || ''; if (!输出路径) 失败('--out 缺少路径', 2); }
  else if (a === '--max-paragraphs') {
    最大段落 = Number(参数[++i]);
    if (!Number.isFinite(最大段落) || 最大段落 < 1) 失败('--max-paragraphs 需要一个正整数', 2);
  } else if (a.startsWith('-')) 失败('不认识的参数：' + a, 2);
  else 文件们.push(a);
}

if (文件们.length !== 2) { 用法(); process.exit(2); }

const [路径A, 路径B] = 文件们;
const 解析A = await 解析文件(resolve(路径A));
if (!解析A.ok) 失败('A 解析失败：' + 解析A.原因, 2);
const 解析B = await 解析文件(resolve(路径B));
if (!解析B.ok) 失败('B 解析失败：' + 解析B.原因, 2);

const 结果 = 比较(
  { 路径: 路径A, 格式: 解析A.格式, blocks: 解析A.blocks },
  { 路径: 路径B, 格式: 解析B.格式, blocks: 解析B.blocks },
  { 最大段落 },
);
const 报告 = 生成报告(结果, { A名: 路径A, B名: 路径B });
const JSON体 = 生成JSON(结果);

if (输出路径) {
  try {
    writeFileSync(resolve(输出路径), 要JSON ? JSON.stringify(JSON体, null, 2) + '\n' : 报告, 'utf8');
  } catch (e) {
    失败('写报告失败：' + 输出路径 + '（' + e.message + '）', 2);
  }
}

if (!安静) {
  process.stdout.write(要JSON ? JSON.stringify(JSON体, null, 2) + '\n' : 报告);
}
if (输出路径 && !安静) process.stderr.write('\n已另存：' + resolve(输出路径) + '\n');
process.exitCode = 结果.有差异 ? 1 : 0;

function 失败(说明, 码) {
  process.stderr.write('dsh-doc-compare: ' + 说明 + '\n');
  process.exit(码);
}

function 用法() {
  process.stderr.write(`dsh-doc-compare —— 文档/合同比对（段落级，人能读的报告）

用法：
  dsh-doc-compare <文件A> <文件B> [选项]

支持：.docx / .md / .txt
选项：
  --json                输出机器可读 JSON
  --out <路径>          报告另存为文件（.md，或 --json 时存 JSON）
  --max-paragraphs <N>  最多比对多少段（默认 2000，超出会提示）
  --quiet               不打印报告（配合 --out 使用）
  -h, --help            显示本帮助

退出码：0 无差异 / 1 有差异 / 2 解析失败
`);
}
