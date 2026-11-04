#!/usr/bin/env node
/**
 * 测试断言小工具：按点分路径读 JSON，比对期望值。
 *
 * 用法：node tests/check.mjs <json文件> '统计.修改' 1 '统计.新增' 0 ...
 * 数组也可用下标：'标题事件.0.事件' 标题层级变化
 * 支持期望值写法：数值 / true / false / null / 字符串（原样比较）
 */
import { readFileSync } from 'node:fs';

const [文件, ...对] = process.argv.slice(2);
if (!文件 || 对.length % 2 !== 0) {
  console.error('用法: node tests/check.mjs <json文件> <路径> <期望值> ...');
  process.exit(2);
}
const 数据 = JSON.parse(readFileSync(文件, 'utf8'));

function 取(路径) {
  return 路径.split('.').reduce((v, k) => (v == null ? undefined : v[k]), 数据);
}

function 期望(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s !== '' && !Number.isNaN(Number(s))) return Number(s);
  return s;
}

let 失败 = 0;
for (let i = 0; i < 对.length; i += 2) {
  const 路 = 对[i];
  const 期 = 期望(对[i + 1]);
  const 实 = 取(路);
  if (实 !== 期) {
    console.error(`  ✗ ${路}：期望 ${JSON.stringify(期)}，实际 ${JSON.stringify(实)}`);
    失败++;
  }
}
if (失败) process.exit(1);
