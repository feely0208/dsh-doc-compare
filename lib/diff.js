/**
 * 段落级比对核心。
 *
 * 为什么不用 `diff` / `git diff`：合同/文档要的不是行号补丁，而是
 *   · 这一段是新增、删除，还是「原来这 7 天 → 改成 15 天」的修改；
 *   · 标题被改名/删掉、层级从 H2 掉到 H3 —— 这类结构变化要单独喊出来；
 *   · 表格行数变了多少。
 * 所以先把文档拆成「标题 / 段落 / 表格」块，再对叙述块做 LCS，
 * 把紧邻的删除+新增配对成「修改」，逐词标出差异片段。
 */
const 默认最大段落 = 2000;
const 最大段落硬上限 = 5000;
const 最大表格数 = 200;

/** 文本归一化：只用于判定「是否相同」，展示仍用原文。 */
export function 归一(文本) {
  return String(文本 || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function 比较(文档A, 文档B, 选项 = {}) {
  const 上限 = Math.min(最大段落硬上限, Math.max(1, Number(选项.最大段落) || 默认最大段落));

  const 装A = 分装(文档A.blocks);
  const 装B = 分装(文档B.blocks);

  const 截断 = {
    上限,
    发生: 装A.叙述.length > 上限 || 装B.叙述.length > 上限,
    原文段数A: 装A.叙述.length,
    原文段数B: 装B.叙述.length,
    表格截断: 装A.表格.length > 最大表格数 || 装B.表格.length > 最大表格数,
  };
  const A叙述 = 装A.叙述.slice(0, 上限);
  const B叙述 = 装B.叙述.slice(0, 上限);
  const A表 = 装A.表格.slice(0, 最大表格数);
  const B表 = 装B.表格.slice(0, 最大表格数);

  const 键A = A叙述.map(比对键);
  const 键B = B叙述.map(比对键);
  const 操作 = 序列比对(键A, 键B);

  const 差异 = 归类(操作, A叙述, B叙述);
  const 修改 = 差异.filter((d) => d.类型 === '修改');
  const 新增 = 差异.filter((d) => d.类型 === '新增');
  const 删除 = 差异.filter((d) => d.类型 === '删除');

  const 标题事件 = 收集标题事件(差异, A叙述, B叙述);
  const 表格差异 = 比对表格(A表, B表);

  const 段落数A = A叙述.length;
  const 段落数B = B叙述.length;
  const 改动段数 = 差异.length;
  const 改动比例 = 段落数A + 段落数B === 0 ? 0 : Math.round((改动段数 / Math.max(段落数A, 段落数B)) * 1000) / 10;

  const 表格变化 = 表格差异.filter((t) => t.有变化).length;
  const 标题变化 = 标题事件.filter((e) => e.事件 !== '未变').length;
  const 有差异 = 改动段数 > 0 || 表格变化 > 0 || 标题事件.some((e) => e.事件 !== '未变');

  return {
    ok: true,
    有差异,
    A: 摘要(文档A, 装A, A叙述, A表),
    B: 摘要(文档B, 装B, B叙述, B表),
    统计: {
      段落数A, 段落数B,
      修改: 修改.length,
      新增: 新增.length,
      删除: 删除.length,
      改动段数,
      改动比例,
      标题数A: 装A.标题数, 标题数B: 装B.标题数, 标题变化,
      表格数A: A表.length, 表格数B: B表.length, 表格变化,
      改动比例口径: '改动段数 / 较大的段落数',
    },
    标题事件,
    差异,
    表格差异,
    截断,
  };
}

function 摘要(文档, 装, 叙述, 表) {
  return {
    路径: 文档.路径 || '',
    格式: 文档.格式 || '',
    段落数: 叙述.length,
    标题数: 装.标题数,
    表格数: 表.length,
    块数: 文档.blocks ? 文档.blocks.length : 0,
  };
}

function 分装(blocks) {
  const 叙述 = [];
  const 表格 = [];
  let 标题数 = 0;
  for (const b of blocks || []) {
    if (b.type === 'heading') {
      叙述.push(b);
      标题数++;
    } else if (b.type === 'para') {
      叙述.push(b);
    } else if (b.type === 'table') {
      表格.push(b);
    }
  }
  return { 叙述, 表格, 标题数 };
}

function 比对键(b) {
  if (b.type === 'heading') return 'h' + b.level + '\u0001' + 归一(b.text);
  return 'p\u0001' + 归一(b.text);
}

/* ── 序列比对（LCS） ── */

function 序列比对(a, b) {
  const n = a.length, m = b.length;
  // 规模可控时走完整 LCS；超大时退化为「公共前后缀 + 剩余按类型配对」，避免几百 MB 矩阵
  if (n * m > 4_000_000) return 退化比对(a, b);
  const W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    const 行 = i * W, 下行 = (i + 1) * W;
    for (let j = m - 1; j >= 0; j--) {
      dp[行 + j] = a[i] === b[j]
        ? dp[下行 + j + 1] + 1
        : Math.max(dp[下行 + j], dp[行 + j + 1]);
    }
  }
  const 操作 = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { 操作.push({ 类型: '同', a: i, b: j }); i++; j++; }
    else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { 操作.push({ 类型: '删', a: i }); i++; }
    else { 操作.push({ 类型: '增', b: j }); j++; }
  }
  while (i < n) 操作.push({ 类型: '删', a: i++ });
  while (j < m) 操作.push({ 类型: '增', b: j++ });
  return 操作;
}

function 退化比对(a, b) {
  const 操作 = [];
  let 头 = 0;
  while (头 < a.length && 头 < b.length && a[头] === b[头]) { 操作.push({ 类型: '同', a: 头, b: 头 }); 头++; }
  const 尾A = [], 尾B = [];
  let ia = a.length - 1, ib = b.length - 1;
  while (ia >= 头 && ib >= 头 && a[ia] === b[ib]) { 尾A.unshift({ 类型: '同', a: ia }); 尾B.unshift({ 类型: '同', b: ib }); ia--; ib--; }
  for (let k = 头; k <= ia; k++) 操作.push({ 类型: '删', a: k });
  for (let k = 头; k <= ib; k++) 操作.push({ 类型: '增', b: k });
  for (let k = 0; k < 尾A.length; k++) 操作.push({ 类型: '同', a: 尾A[k].a, b: 尾B[k].b });
  return 操作;
}

/** 把 LCS 操作流里紧邻的「删 + 增」配对成修改。 */
function 归类(操作, A叙述, B叙述) {
  const 差异 = [];
  let i = 0;
  while (i < 操作.length) {
    if (操作[i].类型 === '同') { i++; continue; }
    const 删s = [], 增s = [];
    while (i < 操作.length && 操作[i].类型 !== '同') {
      if (操作[i].类型 === '删') 删s.push({ 块: A叙述[操作[i].a], 序号: 操作[i].a });
      else 增s.push({ 块: B叙述[操作[i].b], 序号: 操作[i].b });
      i++;
    }
    let d = 0, s = 0;
    while (d < 删s.length && s < 增s.length) {
      const 旧 = 删s[d].块, 新 = 增s[s].块;
      const 同类 = (旧.type === 'heading') === (新.type === 'heading');
      if (同类) {
        差异.push({
          类型: '修改',
          块类型: 旧.type,
          位置: `A 第 ${删s[d].序号 + 1} 段`,
          改前: 旧.text,
          改后: 新.text,
          片段: 词级差异(旧.text, 新.text),
          层级: 旧.type === 'heading' ? { 改前: 旧.level, 改后: 新.level } : undefined,
        });
        d++; s++;
      } else {
        // 类型不同（标题变段落等）：不硬配对，各记一笔
        差异.push({ 类型: '删除', 块类型: 旧.type, 位置: `A 第 ${删s[d].序号 + 1} 段`, 原文: 旧.text, 层级: 旧.level });
        d++;
      }
    }
    for (; d < 删s.length; d++) {
      差异.push({ 类型: '删除', 块类型: 删s[d].块.type, 位置: `A 第 ${删s[d].序号 + 1} 段`, 原文: 删s[d].块.text, 层级: 删s[d].块.level });
    }
    for (; s < 增s.length; s++) {
      差异.push({ 类型: '新增', 块类型: 增s[s].块.type, 位置: `B 第 ${增s[s].序号 + 1} 段`, 原文: 增s[s].块.text, 层级: 增s[s].块.level });
    }
  }
  return 差异;
}

/* ── 标题结构 ── */

function 收集标题事件(差异, A叙述, B叙述) {
  const 事件 = [];
  const 标题A = A叙述.filter((b) => b.type === 'heading');
  const 标题B = B叙述.filter((b) => b.type === 'heading');
  for (const d of 差异) {
    if (d.块类型 !== 'heading') continue;
    if (d.类型 === '删除') {
      事件.push({ 事件: '删除标题', 级别: d.层级 || 0, 文本: d.原文, 风险: '高', 说明: '章节标题被删除，正文承接关系可能变化' });
    } else if (d.类型 === '新增') {
      事件.push({ 事件: '新增标题', 级别: d.层级 || 0, 文本: d.原文, 风险: '中' });
    } else if (d.类型 === '修改') {
      const 旧级 = d.层级 ? d.层级.改前 : 0;
      const 新级 = d.层级 ? d.层级.改后 : 0;
      if (归一(d.改前) === 归一(d.改后) && 旧级 !== 新级) {
        事件.push({ 事件: '标题层级变化', 级别: 旧级, 新级别: 新级, 文本: d.改后, 风险: '高', 说明: `标题文字未变，层级 H${旧级} → H${新级}` });
      } else {
        事件.push({ 事件: '标题改名', 级别: 旧级, 新级别: 新级, 文本: d.改前, 新文本: d.改后, 风险: '高', 说明: '章节标题被改写，条款引用与目录可能对不上' });
      }
    }
  }
  // 标题数量/顺序概览：两边标题文字序列不同但差异已被上面覆盖
  return 事件.map((e) => ({ ...e, A标题数: 标题A.length, B标题数: 标题B.length }));
}

/* ── 表格 ── */

function 行键(row) {
  return (row || []).map(归一).join('\u0002');
}

function 比对表格(A表, B表) {
  const 结果 = [];
  const n = Math.max(A表.length, B表.length);
  for (let k = 0; k < n; k++) {
    const a = A表[k], b = B表[k];
    const 编号 = k + 1;
    if (!a) {
      结果.push({ 表格: 编号, 类型: '新增表格', 行数A: 0, 行数B: b.rows.length, 行数变化: b.rows.length, 有变化: true, 变化: [] });
      continue;
    }
    if (!b) {
      结果.push({ 表格: 编号, 类型: '删除表格', 行数A: a.rows.length, 行数B: 0, 行数变化: -a.rows.length, 有变化: true, 变化: [] });
      continue;
    }
    const 键A = a.rows.map(行键);
    const 键B = b.rows.map(行键);
    const 操作 = 序列比对(键A, 键B);
    const 变化 = [];
    let i = 0;
    while (i < 操作.length) {
      if (操作[i].类型 === '同') { i++; continue; }
      const 删s = [], 增s = [];
      while (i < 操作.length && 操作[i].类型 !== '同') {
        if (操作[i].类型 === '删') 删s.push(操作[i].a);
        else 增s.push(操作[i].b);
        i++;
      }
      let d = 0, s = 0;
      while (d < 删s.length && s < 增s.length) {
        变化.push({
          类型: '修改行', 行A: 删s[d] + 1, 行B: 增s[s] + 1,
          改前: a.rows[删s[d]], 改后: b.rows[增s[s]],
          片段: 词级差异(a.rows[删s[d]].join(' | '), b.rows[增s[s]].join(' | ')),
        });
        d++; s++;
      }
      for (; d < 删s.length; d++) 变化.push({ 类型: '删除行', 行A: 删s[d] + 1, 改前: a.rows[删s[d]] });
      for (; s < 增s.length; s++) 变化.push({ 类型: '新增行', 行B: 增s[s] + 1, 改后: b.rows[增s[s]] });
    }
    结果.push({
      表格: 编号,
      行数A: a.rows.length,
      行数B: b.rows.length,
      行数变化: b.rows.length - a.rows.length,
      有变化: 变化.length > 0 || a.rows.length !== b.rows.length,
      变化,
    });
  }
  return 结果;
}

/* ── 词级差异（人能读的高亮） ── */

function 切词(s) {
  const 词 = [];
  const re = /[A-Za-z0-9_]+|[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]|[^\s]|\s+/g;
  let m;
  while ((m = re.exec(s))) 词.push(m[0]);
  return 词;
}

/** 返回 [{ 变化:'同'|'删'|'增', 文本 }]，供 Markdown 高亮 / 面板渲染。 */
export function 词级差异(旧文, 新文) {
  const a = 切词(String(旧文 || ''));
  const b = 切词(String(新文 || ''));
  if (a.length > 1600 || b.length > 1600 || a.length * b.length > 2_000_000) {
    return [{ 变化: '删', 文本: String(旧文 || '') }, { 变化: '增', 文本: String(新文 || '') }];
  }
  const 操作 = 序列比对(a, b);
  const 片段 = [];
  const 推 = (变化, 文本) => {
    if (!文本) return;
    const 末 = 片段[片段.length - 1];
    if (末 && 末.变化 === 变化) 末.文本 += 文本;
    else 片段.push({ 变化, 文本 });
  };
  for (const op of 操作) {
    if (op.类型 === '同') 推('同', a[op.a]);
    else if (op.类型 === '删') 推('删', a[op.a]);
    else 推('增', b[op.b]);
  }
  return 片段;
}

/* ── Markdown 报告 ── */

const 截 = (s, n = 1200) => {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) + '…（已截断）' : s;
};

/** 把片段渲染成带高亮的一行；侧='删' 时只画删除片段，侧='增' 时只画新增片段。 */
export function 高亮(片段, 侧) {
  if (!Array.isArray(片段)) return 截(片段);
  let out = '';
  for (const f of 片段) {
    const 文 = 截(f.文本, 800);
    if (f.变化 === '同') out += 文;
    else if (侧 === '删' && f.变化 === '删') out += '~~' + 文 + '~~';
    else if (侧 === '增' && f.变化 === '增') out += '**' + 文 + '**';
    else if (侧 === '删' && f.变化 === '增') { /* 删侧不重复新增文字 */ }
    else if (侧 === '增' && f.变化 === '删') { /* 增侧不重复删除文字 */ }
  }
  return out.trim();
}

export function 生成报告(结果, 选项 = {}) {
  const A名 = 选项.A名 || 结果.A.路径 || '文件 A';
  const B名 = 选项.B名 || 结果.B.路径 || '文件 B';
  const L = [];
  const 统计 = 结果.统计;
  const 标题事件 = 结果.标题事件 || [];
  const 高风险 = 标题事件.filter((e) => e.风险 === '高');

  L.push('# 文档比对报告', '');
  L.push(`- 文件 A：\`${A名}\`（${结果.A.格式 || '未知'}，${结果.A.段落数} 段，${结果.A.标题数} 个标题，${结果.A.表格数} 个表格）`);
  L.push(`- 文件 B：\`${B名}\`（${结果.B.格式 || '未知'}，${结果.B.段落数} 段，${结果.B.标题数} 个标题，${结果.B.表格数} 个表格）`);
  L.push('');
  if (!结果.有差异) {
    L.push('## 结论：未发现差异 ✅', '');
    L.push('两份文档按段落、标题层级与表格行逐一比对，内容一致。');
    if (结果.截断 && 结果.截断.发生) L.push('', 截断说明(结果.截断));
    return L.join('\n') + '\n';
  }

  const 结论文本 = 统计.改动段数 > 0
    ? `有差异（共 ${统计.改动段数} 处段落改动）`
    : '有差异（段落未变，但表格或标题结构有变化）';
  L.push(`## 结论：${结论文本}`, '');
  L.push(`- 修改 ${统计.修改} 处、新增 ${统计.新增} 处、删除 ${统计.删除} 处`);
  L.push(`- 改动比例 ${统计.改动比例}%（改动段数 / 较大的段落数）`);
  L.push(`- 标题 ${统计.标题数A} → ${统计.标题数B} 个，${统计.标题变化} 处结构变化`);
  const 表变 = (结果.表格差异 || []).filter((t) => t.有变化);
  if (表变.length) {
    L.push('- 表格变化：' + 表变.map((t) => `表格 ${t.表格} 行数 ${t.行数A} → ${t.行数B}（${带符号(t.行数变化)}）`).join('；'));
  } else {
    L.push(`- 表格 ${结果.统计.表格数A} → ${结果.统计.表格数B} 个，未发现行内容变化`);
  }
  if (结果.截断 && 结果.截断.发生) L.push('', 截断说明(结果.截断));
  L.push('');

  if (高风险.length) {
    L.push('## ⚠ 高风险提示', '');
    for (const e of 高风险) L.push('- ' + 描述标题事件(e));
    L.push('');
  }

  const 差 = 结果.差异.filter((d) => d.类型 === '修改');
  const 新 = 结果.差异.filter((d) => d.类型 === '新增');
  const 删 = 结果.差异.filter((d) => d.类型 === '删除');

  if (差.length) {
    L.push('## 修改的段落', '');
    差.forEach((d, i) => {
      L.push(`### ${i + 1}. ${块名(d)}${d.位置 ? '（' + d.位置 + '）' : ''}`);
      if (d.层级 && d.层级.改前 !== d.层级.改后) L.push(`> 层级：H${d.层级.改前} → H${d.层级.改后}`);
      L.push('');
      L.push('**改前**：' + 高亮(d.片段, '删'));
      L.push('');
      L.push('**改后**：' + 高亮(d.片段, '增'));
      L.push('');
    });
  }
  if (新.length) {
    L.push('## 新增的段落', '');
    新.forEach((d, i) => {
      L.push(`${i + 1}. ${块名(d)}${d.位置 ? '（' + d.位置 + '）' : ''}：${截(d.原文, 600)}`);
    });
    L.push('');
  }
  if (删.length) {
    L.push('## 删除的段落', '');
    删.forEach((d, i) => {
      L.push(`${i + 1}. ${块名(d)}${d.位置 ? '（' + d.位置 + '）' : ''}：${截(d.原文, 600)}`);
    });
    L.push('');
  }

  L.push('## 标题结构', '');
  if (!标题事件.length) L.push('标题数量和文字均未变化。');
  else for (const e of 标题事件) L.push('- ' + 描述标题事件(e));
  L.push('');

  L.push('## 表格差异', '');
  const 有表 = (结果.表格差异 || []).filter((t) => t.有变化);
  if (!有表.length) L.push('表格行内容与行数均未变化。');
  else {
    for (const t of 有表) {
      L.push(`### 表格 ${t.表格}（行数 ${t.行数A} → ${t.行数B}，${带符号(t.行数变化)}）`, '');
      if (t.类型 === '新增表格') { L.push('整个表格为新增。', ''); continue; }
      if (t.类型 === '删除表格') { L.push('整个表格被删除。', ''); continue; }
      for (const c of t.变化) {
        if (c.类型 === '修改行') {
          L.push(`- **修改行**（原第 ${c.行A} 行 → 新第 ${c.行B} 行）`);
          L.push('  - 改前：' + 高亮(c.片段, '删'));
          L.push('  - 改后：' + 高亮(c.片段, '增'));
        } else if (c.类型 === '新增行') {
          L.push(`- **新增行**（新第 ${c.行B} 行）：${截(c.改后.join(' | '), 400)}`);
        } else {
          L.push(`- **删除行**（原第 ${c.行A} 行）：${截(c.改前.join(' | '), 400)}`);
        }
      }
      L.push('');
    }
  }

  L.push('---', '');
  L.push(`本报告由 dsh-doc-compare 在本机生成，文件未上传。比对范围：${结果.截断.发生 ? '前 ' + 结果.截断.上限 + ' 段' : '全部段落'}。`);
  return L.join('\n') + '\n';
}

function 块名(d) {
  if (d.块类型 === 'heading') return '标题';
  return '段落';
}

function 带符号(n) {
  if (!n) return '±0';
  return n > 0 ? '+' + n : String(n);
}

function 描述标题事件(e) {
  if (e.事件 === '删除标题') return `**删除标题**（原 H${e.级别}）：「${截(e.文本, 200)}」——${e.说明}`;
  if (e.事件 === '新增标题') return `新增标题（H${e.级别}）：「${截(e.文本, 200)}」`;
  if (e.事件 === '标题层级变化') return `**标题层级变化**（H${e.级别} → H${e.新级别}）：「${截(e.文本, 200)}」`;
  if (e.事件 === '标题改名') return `**标题改名**（H${e.级别} → H${e.新级别}）：「${截(e.文本, 120)}」→「${截(e.新文本, 120)}」`;
  return e.事件;
}

function 截断说明(t) {
  return `> ⚠ 已限流：默认最多比对 ${t.上限} 段（A 共 ${t.原文段数A} 段、B 共 ${t.原文段数B} 段），超出部分未比对。可用 --max-paragraphs 调整。`;
}

export function 生成JSON(结果) {
  return {
    ok: true,
    有差异: 结果.有差异,
    生成时间: new Date().toISOString(),
    A: 结果.A,
    B: 结果.B,
    统计: 结果.统计,
    截断: 结果.截断,
    标题事件: 结果.标题事件,
    差异: 结果.差异,
    表格差异: 结果.表格差异,
  };
}
