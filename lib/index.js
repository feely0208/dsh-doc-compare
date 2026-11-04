/**
 * 深鲸文档比对 —— 宿主（服务端）半边
 *
 * 为什么要有它：两份合同/文档改了什么，用 Word 的「比较」要先上传到别人服务器；
 * 用 git diff 看到的是行号补丁，不是「这一段原来写 7 天，现在写 15 天」。
 * 这个插件在本机把两份 .docx / .md / .txt 拆成段落，出人能读的 Markdown 报告，
 * 并单独提示标题层级变化与表格行数变化。
 *
 * 出口（同源 HTTP，面板直接用 fetch）：
 *   GET  /dsh-doc-compare/api/info       版本号（读 package.json，面板显示 v0.1.x）
 *   GET  /dsh-doc-compare/api/badge      powered-by-dwh 徽章（本地 PNG，不联网）
 *   GET  /dsh-doc-compare/api/health
 *   POST /dsh-doc-compare/api/compare    { a: { name, text }, b: { name, text }, maxParagraphs }
 *
 * 边界：解析与比对都在本进程内完成，不联网、不上传、不写文件；CLI 见 bin/cli.mjs。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 解析纯文本 } from './parse.js';
import { 比较, 生成报告, 生成JSON } from './diff.js';

const 包根 = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE = '/dsh-doc-compare';
const 插件版本 = JSON.parse(readFileSync(join(包根, 'package.json'), 'utf8')).version;
const 请求体上限 = 8 * 1024 * 1024;

export const name = 'doc-compare';
export const inject = ['webServer'];

function 回(res, 码, 数据) {
  const 体 = JSON.stringify(数据);
  res.writeHead(码, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(体),
    'cache-control': 'no-store',
  });
  res.end(体);
}

function 读请求体(req) {
  return new Promise((resolve, reject) => {
    const 块 = [];
    let 总长 = 0;
    req.on('data', (c) => {
      总长 += c.length;
      if (总长 > 请求体上限) {
        reject(new Error('请求体过大（上限 8MB）'));
        req.destroy();
        return;
      }
      块.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(块).toString('utf8')));
    req.on('error', reject);
  });
}

async function 处理比对(载荷) {
  const a = 载荷 && 载荷.a;
  const b = 载荷 && 载荷.b;
  if (!a || !b || typeof a.text !== 'string' || typeof b.text !== 'string') {
    return { ok: false, 原因: '需要 a.text 与 b.text 两段文本' };
  }
  if (!a.text.trim() || !b.text.trim()) return { ok: false, 原因: '两边文本都不能为空' };
  const 文档A = { 路径: String(a.name || '文档 A'), 格式: 'md', blocks: 解析纯文本(a.text, 'md') };
  const 文档B = { 路径: String(b.name || '文档 B'), 格式: 'md', blocks: 解析纯文本(b.text, 'md') };
  if (!文档A.blocks.length || !文档B.blocks.length) return { ok: false, 原因: '文本里没有可读段落' };
  const 结果 = 比较(文档A, 文档B, { 最大段落: 载荷.maxParagraphs });
  return {
    ok: true,
    有差异: 结果.有差异,
    统计: 结果.统计,
    标题事件: 结果.标题事件,
    差异: 结果.差异,
    表格差异: 结果.表格差异,
    截断: 结果.截断,
    报告: 生成报告(结果, { A名: 文档A.路径, B名: 文档B.路径 }),
    数据: 生成JSON(结果),
  };
}

function 建处理器() {
  return async function handler(req, res, url) {
    // 宿主给的第三个参数不一定是 URL 对象：统一从 req.url 自拼，路径与查询都吃。
    const 原始 = (url && url.pathname) ? (url.pathname + (url.search || '')) : String(req.url || '/');
    let 解析;
    try { 解析 = new URL(原始, 'http://local'); } catch { 解析 = new URL('/', 'http://local'); }
    const 路 = decodeURIComponent(解析.pathname).replace(ROUTE, '') || '/';

    try {
      if (路 === '/api/badge' && req.method === 'GET') {
        try {
          const 图 = readFileSync(join(包根, 'assets', 'deepwhale-badge.png'));
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
          res.end(图);
        } catch {
          回(res, 404, { ok: false, 原因: '徽章图片缺失' });
        }
        return;
      }
      if (路 === '/api/info' && req.method === 'GET') {
        return 回(res, 200, { ok: true, version: 插件版本 });
      }
      if (路 === '/api/health' && req.method === 'GET') {
        return 回(res, 200, { ok: true, 版本: 插件版本, 引擎: '纯本地（mammoth 解 docx）' });
      }
      if (路 === '/api/compare' && req.method === 'POST') {
        let 载荷;
        try { 载荷 = JSON.parse(await 读请求体(req)); }
        catch (e) { return 回(res, 400, { ok: false, 原因: '请求体不是合法 JSON：' + (e && e.message ? e.message : e) }); }
        const 结果 = await 处理比对(载荷);
        return 回(res, 结果.ok ? 200 : 400, 结果);
      }
      return 回(res, 404, { ok: false, 原因: '未知路径：' + 路 });
    } catch (e) {
      return 回(res, 500, { ok: false, 原因: String(e && e.message ? e.message : e) });
    }
  };
}

export function apply(ctx) {
  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    const handler = 建处理器();
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler }), 'doc-compare: http 出口');
    ctx.logger?.info?.('[doc-compare] 已挂 HTTP 出口 ' + ROUTE + '/api');
  } else {
    ctx.logger?.warn?.('[doc-compare] 没有 webServer 服务，面板会取不到数据');
  }
}

export default { name, inject, apply };
