#!/usr/bin/env node
/**
 * 宿主 HTTP 出口冒烟：/api/info、/api/badge、/api/compare。
 * 不启动真实服务：用假 ctx 截获 handler，再用假 req/res 走一遍。
 */
import { Readable } from 'node:stream';
import { apply } from '../lib/index.js';

let handler = null;
apply({
  webServer: { register(o) { handler = o.handler; } },
  effect(fn) { fn(); },
  logger: { info() {}, warn() {} },
});

if (!handler) { console.error('❌ apply 没有注册 HTTP handler'); process.exit(1); }

function 假res() {
  return {
    码: 0, 头: null, 体: '',
    writeHead(码, 头) { this.码 = 码; this.头 = 头; },
    end(体) { this.体 = Buffer.isBuffer(体) ? 体 : Buffer.from(String(体)); },
  };
}

async function 请求(方法, url, 体) {
  const req = Readable.from(体 === undefined ? [] : [Buffer.from(JSON.stringify(体))]);
  req.method = 方法;
  req.url = url;
  const res = 假res();
  await handler(req, res, undefined);
  return res;
}

let 失败 = 0;
const 断言 = (条件, 说明) => { if (条件) console.log('  ✅ ' + 说明); else { 失败++; console.error('  ❌ ' + 说明); } };

const info = await 请求('GET', '/dsh-doc-compare/api/info');
const infoJ = JSON.parse(info.体.toString());
断言(info.码 === 200 && infoJ.version === '0.1.0', '/api/info 返回 package.json 版本（' + infoJ.version + '）');

const badge = await 请求('GET', '/dsh-doc-compare/api/badge');
断言(badge.码 === 200 && badge.头['content-type'] === 'image/png' && badge.体.length > 1000, '/api/badge 返回本地 PNG（' + badge.体.length + ' 字节）');

const cmp = await 请求('POST', '/dsh-doc-compare/api/compare?x=1', {
  a: { name: 'A', text: '合同总价为十万元。\n\n交付期为 7 天。' },
  b: { name: 'B', text: '合同总价为十万元。\n\n交付期为 15 天。' },
});
const cmpJ = JSON.parse(cmp.体.toString());
断言(cmp.码 === 200 && cmpJ.ok === true && cmpJ.统计.修改 === 1 && cmpJ.有差异 === true, '/api/compare 找出 1 处修改（带查询串也能路由）');
断言(typeof cmpJ.报告 === 'string' && cmpJ.报告.includes('改前'), '/api/compare 同时返回 Markdown 报告');

const 空 = await 请求('POST', '/dsh-doc-compare/api/compare', { a: { text: '' }, b: { text: 'x' } });
断言(空.码 === 400, '空文本返回 400');

if (失败) { console.error('HTTP 冒烟失败：' + 失败 + ' 条'); process.exit(1); }
console.log('HTTP 冒烟：全部通过');
