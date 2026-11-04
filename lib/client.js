/**
 * 深鲸文档比对 —— 客户端半边（面板 UI）
 *
 * 挂两个槽位：
 *   · sidebar.panellist → 侧栏图标「文档比对」
 *   · main（keyed, key='doc-compare'）→ 主区面板
 *
 * 交互：左右各贴一段文本 → 本机比对（走同源 /dsh-doc-compare/api/compare）→
 * 出「修改 / 新增 / 删除」清单，修改逐词高亮；标题层级变化单独用风险条提示。
 * 文件（.docx/.md/.txt）比对走命令行：dsh-doc-compare 文件A 文件B。
 *
 * 三层自保：整个 factory try/catch；面板套 ErrorBoundary；每个 slot 注册各自 try。
 */
window.__ModuleLoader__.load({
  id: '@deepwhale-cn/dsh-doc-compare',
  factory: (require) => {
    try {
      var module = { exports: {} };
      var exports = module.exports;
      const react = require('react');
      const h = react.createElement;

      const API = '/dsh-doc-compare/api';
      const SLOT_ICON = 'sidebar.panellist';
      const SLOT_MAIN = 'main';
      const PANEL_ID = 'doc-compare';

      const V = {
        卡底: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))',
        浅底: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.16))',
        边: 'var(--dsw-alias-border-l1, rgba(127,127,127,0.28))',
        错: 'var(--dsw-alias-state-error-primary, #e5484d)',
        对: 'var(--dsw-alias-state-success-primary, #22c55e)',
      };
      const 卡 = {
        background: V.卡底, border: '1px solid ' + V.边, borderRadius: 10,
        padding: '10px 12px', marginBottom: 10, color: 'inherit',
      };
      const 小字 = { fontSize: 12, opacity: 0.72, lineHeight: 1.7 };
      const 按钮 = {
        background: V.浅底, color: 'inherit', border: '1px solid ' + V.边, borderRadius: 8,
        padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
      };
      const 输入 = {
        width: '100%', boxSizing: 'border-box', minHeight: 140, resize: 'vertical',
        fontSize: 13, lineHeight: 1.7, color: 'inherit', background: 'transparent',
        border: '1px solid ' + V.边, borderRadius: 8, padding: '8px 10px',
        fontFamily: 'inherit', outline: 'none',
      };

      async function 请求(路, 选项) {
        const res = await fetch(API + 路, 选项);
        const j = await res.json();
        if (!j || j.ok === false) throw new Error((j && j.原因) || ('请求失败：' + 路));
        return j;
      }

      /* 词级片段渲染：删除划线、新增加粗，其余原样。 */
      function 渲片段(片段, 侧) {
        if (!Array.isArray(片段)) return String(片段 || '');
        const 结果 = [];
        let k = 0;
        for (const f of 片段) {
          if (f.变化 === '同') {
            结果.push(h('span', { key: k++ }, f.文本));
          } else if (侧 === '删' && f.变化 === '删') {
            结果.push(h('span', { key: k++, style: { textDecoration: 'line-through', color: V.错, opacity: 0.9 } }, f.文本));
          } else if (侧 === '增' && f.变化 === '增') {
            结果.push(h('span', { key: k++, style: { color: V.对, fontWeight: 700 } }, f.文本));
          }
        }
        return 结果;
      }

      function 计数胶囊(label, 数, 颜色) {
        return h('span', {
          key: label,
          style: {
            display: 'inline-block', marginRight: 8, marginBottom: 6, padding: '2px 9px',
            borderRadius: 999, fontSize: 12, border: '1px solid ' + V.边,
            color: 颜色 || 'inherit', background: V.浅底,
          },
        }, label + ' ' + 数);
      }

      function 结果区({ 结果 }) {
        if (!结果) return null;
        const 统 = 结果.统计 || {};
        const 高 = (结果.标题事件 || []).filter((e) => e.风险 === '高');
        const 改 = (结果.差异 || []).filter((d) => d.类型 === '修改');
        const 新 = (结果.差异 || []).filter((d) => d.类型 === '新增');
        const 删 = (结果.差异 || []).filter((d) => d.类型 === '删除');
        const 表 = (结果.表格差异 || []).filter((t) => t.有变化);

        return h('div', { style: { marginTop: 12 } }, [
          h('div', { key: 'sum', style: { ...卡, borderLeft: '3px solid ' + (结果.有差异 ? V.错 : V.对) } }, [
            h('div', { key: 't', style: { fontSize: 14, fontWeight: 700, marginBottom: 6 } },
              结果.有差异 ? '发现差异' : '未发现差异'),
            h('div', { key: 'c' }, [
              计数胶囊('修改', 统.修改 || 0),
              计数胶囊('新增', 统.新增 || 0),
              计数胶囊('删除', 统.删除 || 0),
              计数胶囊('改动比例', (统.改动比例 || 0) + '%'),
              计数胶囊('标题变化', 统.标题变化 || 0),
              计数胶囊('表格变化', 统.表格变化 || 0),
            ]),
            h('div', { key: 'n', style: 小字 },
              '段落 ' + (统.段落数A || 0) + ' → ' + (统.段落数B || 0) + '；改动比例 = 改动段数 / 较大的段落数。'),
          ]),

          结果.截断 && 结果.截断.发生
            ? h('div', { key: 'tr', style: { ...卡, borderStyle: 'dashed', borderColor: V.错 } }, [
                h('div', { key: 'a', style: { fontSize: 12 } },
                  '⚠ 已限流：只比对了前 ' + 结果.截断.上限 + ' 段（A 共 ' + 结果.截断.原文段数A + ' 段、B 共 ' + 结果.截断.原文段数B + ' 段）。完整比对请用命令行并调大 --max-paragraphs。'),
              ])
            : null,

          高.length
            ? h('div', { key: 'risk', style: { ...卡, borderColor: V.错 } }, [
                h('div', { key: 't', style: { fontSize: 13, fontWeight: 700, marginBottom: 4, color: V.错 } }, '⚠ 高风险：标题结构变化'),
                ...高.map((e, i) => h('div', { key: 'r' + i, style: { fontSize: 12, lineHeight: 1.8 } }, 描述标题(e))),
              ])
            : null,

          改.length ? h('div', { key: 'mod', style: 卡 }, [
            h('div', { key: 't', style: { fontSize: 13, fontWeight: 700, marginBottom: 6 } }, '修改的段落（' + 改.length + '）'),
            ...改.map((d, i) => h('div', { key: 'm' + i, style: { borderTop: i ? '1px dashed ' + V.边 : 'none', paddingTop: i ? 8 : 0, marginTop: i ? 8 : 0 } }, [
              h('div', { key: 'p', style: 小字 }, (d.块类型 === 'heading' ? '标题' : '段落') + (d.位置 ? ' · ' + d.位置 : '')),
              h('div', { key: 'a', style: { fontSize: 13, lineHeight: 1.8 } }, [h('span', { key: 'l', style: { opacity: 0.6, marginRight: 6 } }, '改前'), ...(Array.isArray(渲片段(d.片段, '删')) ? 渲片段(d.片段, '删') : [渲片段(d.片段, '删')])]),
              h('div', { key: 'b', style: { fontSize: 13, lineHeight: 1.8 } }, [h('span', { key: 'l', style: { opacity: 0.6, marginRight: 6 } }, '改后'), ...(Array.isArray(渲片段(d.片段, '增')) ? 渲片段(d.片段, '增') : [渲片段(d.片段, '增')])]),
            ])),
          ]) : null,

          新.length ? h('div', { key: 'add', style: 卡 }, [
            h('div', { key: 't', style: { fontSize: 13, fontWeight: 700, marginBottom: 4, color: V.对 } }, '新增的段落（' + 新.length + '）'),
            ...新.map((d, i) => h('div', { key: 'a' + i, style: { fontSize: 13, lineHeight: 1.8 } }, '+ ' + d.原文)),
          ]) : null,

          删.length ? h('div', { key: 'del', style: 卡 }, [
            h('div', { key: 't', style: { fontSize: 13, fontWeight: 700, marginBottom: 4, color: V.错 } }, '删除的段落（' + 删.length + '）'),
            ...删.map((d, i) => h('div', { key: 'd' + i, style: { fontSize: 13, lineHeight: 1.8, textDecoration: 'line-through', opacity: 0.85 } }, '- ' + d.原文)),
          ]) : null,

          表.length ? h('div', { key: 'tab', style: 卡 }, [
            h('div', { key: 't', style: { fontSize: 13, fontWeight: 700, marginBottom: 4 } }, '表格变化（' + 表.length + '）'),
            ...表.map((t, i) => h('div', { key: 'x' + i, style: { fontSize: 12, lineHeight: 1.8 } },
              '表格 ' + t.表格 + '：行数 ' + t.行数A + ' → ' + t.行数B + '（' + (t.行数变化 > 0 ? '+' : '') + t.行数变化 + '）' +
              ((t.变化 || []).length ? '，' + t.变化.map((c) => c.类型).join('、') : ''))),
          ]) : null,
        ]);
      }

      function 描述标题(e) {
        if (e.事件 === '删除标题') return '删除标题（原 H' + e.级别 + '）：「' + e.文本 + '」';
        if (e.事件 === '新增标题') return '新增标题（H' + e.级别 + '）：「' + e.文本 + '」';
        if (e.事件 === '标题层级变化') return '层级变化 H' + e.级别 + ' → H' + e.新级别 + '：「' + e.文本 + '」';
        if (e.事件 === '标题改名') return '标题改名（H' + e.级别 + ' → H' + e.新级别 + '）：「' + e.文本 + '」→「' + e.新文本 + '」';
        return e.事件;
      }

      function 面板() {
        const [甲, 设甲] = react.useState('');
        const [乙, 设乙] = react.useState('');
        const [忙, 设忙] = react.useState(false);
        const [错, 设错] = react.useState('');
        const [结果, 设结果] = react.useState(null);
        const [插件版本, 设插件版本] = react.useState('');

        // 版本号来自宿主 /api/info（运行期读 package.json），面板不写死
        react.useEffect(() => {
          void (async () => {
            try {
              const j = await 请求('/info');
              if (j && j.version) 设插件版本(String(j.version));
            } catch { /* 取不到就不显示，不影响主流程 */ }
          })();
        }, []);

        async function 开始比对() {
          设错('');
          if (!甲.trim() || !乙.trim()) { 设错('两边都要有内容才能比对。'); return; }
          设忙(true);
          try {
            const j = await 请求('/compare', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                a: { name: '文档 A', text: 甲 },
                b: { name: '文档 B', text: 乙 },
                maxParagraphs: 2000,
              }),
            });
            设结果(j);
          } catch (e) {
            设错(String((e && e.message) || e));
          } finally {
            设忙(false);
          }
        }

        const 列 = { flex: '1 1 0', minWidth: 240, paddingRight: 8 };

        return h('div', { style: { padding: '14px 16px 8px', color: 'inherit', maxWidth: 1000, margin: '0 auto' } }, [
          h('div', { key: 'head', style: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 4 } }, [
            h('div', { key: 't', style: { fontSize: 16, fontWeight: 700, marginRight: 8 } }, '文档比对'),
            h('div', { key: 's', style: 小字 }, '按段落比对两份文本，出「改前 → 改后」；标题层级与表格行数单独提示'),
            插件版本
              ? h('span', { key: 'v', style: { marginLeft: 'auto', fontSize: 11, opacity: 0.75, border: '1px solid ' + V.边, borderRadius: 6, padding: '0 5px' } }, 'v' + 插件版本)
              : null,
          ]),
          h('div', { key: 'hint', style: { ...小字, marginBottom: 10 } },
            '本机比对，文本不上传。比对 .docx / .md / .txt 文件请用命令行：dsh-doc-compare 文件A 文件B'),

          h('div', { key: 'in', style: { display: 'flex', flexWrap: 'wrap', gap: 12 } }, [
            h('div', { key: 'a', style: 列 }, [
              h('div', { key: 'l', style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, '文档 A（原文）'),
              h('textarea', {
                key: 't', value: 甲, style: 输入, spellCheck: false,
                placeholder: '粘贴合同/文档原文……',
                onChange: (e) => 设甲(e.target.value),
              }),
            ]),
            h('div', { key: 'b', style: 列 }, [
              h('div', { key: 'l', style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, '文档 B（修改后）'),
              h('textarea', {
                key: 't', value: 乙, style: 输入, spellCheck: false,
                placeholder: '粘贴修改后的版本……',
                onChange: (e) => 设乙(e.target.value),
              }),
            ]),
          ]),

          h('div', { key: 'op', style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 } }, [
            h('button', {
              key: 'go', type: 'button', disabled: 忙,
              style: { ...按钮, opacity: 忙 ? 0.6 : 1, cursor: 忙 ? 'default' : 'pointer' },
              onClick: () => { void 开始比对(); },
            }, 忙 ? '比对中…' : '开始比对'),
            结果 ? h('span', { key: 'clear', style: { ...小字, cursor: 'pointer' }, onClick: () => 设结果(null) }, '清空结果') : null,
            错 ? h('span', { key: 'e', style: { fontSize: 12, color: V.错 } }, '⚠ ' + 错) : null,
          ]),

          h(结果区, { key: 'res', 结果 }),

          h('div', { key: 'badge', style: { display: 'flex', justifyContent: 'flex-end', marginTop: 12 } }, [
            h('a', {
              key: 'a', href: 'https://deepwhale.org.cn', target: '_blank', rel: 'noopener',
              style: { display: 'inline-block', opacity: 0.85 },
            }, h('img', { src: API + '/badge', alt: 'powered by dwh', style: { height: 20, width: 121, display: 'block' } })),
          ]),
        ]);
      }

      function 图标({ size = 18, active }) {
        return h('svg', {
          title: '文档比对', 'aria-label': '文档比对',
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: active ? 2 : 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        }, [
          h('rect', { key: 'a', x: 3, y: 3, width: 9, height: 18, rx: 1.5 }),
          h('path', { key: 'b', d: 'M6 8h3M6 12h3M6 16h2' }),
          h('path', { key: 'c', d: 'M14 6l6 3v11l-6-2' }),
          h('path', { key: 'd', d: 'M16 10.5h2M16 14h2' }),
        ]);
      }

      const 组件基类 = (react && react.Component) || class {
        constructor(props) { this.props = props || {}; this.state = {}; }
        setState() {}
      };
      class 错误边界 extends 组件基类 {
        constructor(props) { super(props); this.state = { 错: null }; }
        static getDerivedStateFromError(e) { return { 错: e }; }
        componentDidCatch(e) {
          try { console.warn('[文档比对] 渲染出错，已降级：', e && e.message ? e.message : e); } catch { /* ignore */ }
        }
        render() {
          if (this.state && this.state.错) {
            return h('div', { style: { padding: 16, fontSize: 13, lineHeight: 1.7, color: 'inherit' } },
              '文档比对面板出错（已降级，不影响其他界面）：' + String((this.state.错 && this.state.错.message) || this.state.错));
          }
          return this.props ? this.props.children : null;
        }
      }
      function 安全面板(props) { return h(错误边界, null, h(面板, props)); }

      const inject = ['slots'];
      function apply(ctx) {
        try {
          if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
            try { console.warn('[文档比对] 宿主没有 slots 服务，跳过面板注册'); } catch { /* ignore */ }
            return;
          }
          ctx.slots.inject(SLOT_MAIN, function* () {
            try { yield ctx.slots.register({ name: SLOT_MAIN, key: PANEL_ID }, 安全面板); }
            catch (e) { try { console.warn('[文档比对] 主面板注册失败（已跳过）：', e && e.message ? e.message : e); } catch { /* ignore */ } }
          });
          ctx.slots.inject(SLOT_ICON, function* () {
            try { yield ctx.slots.register({ name: SLOT_ICON, id: PANEL_ID, order: 26, label: '文档比对' }, 图标); }
            catch (e) { try { console.warn('[文档比对] 侧栏图标注册失败（已跳过）：', e && e.message ? e.message : e); } catch { /* ignore */ } }
          });
        } catch (e) {
          try { console.warn('[文档比对] apply 出错，已整体跳过：', e && e.message ? e.message : e); } catch { /* ignore */ }
        }
      }

      exports.inject = inject;
      exports.apply = apply;
      return module.exports;
    } catch (e) {
      try { console.warn('[文档比对] 客户层加载失败，已降级为空插件：', e && e.message ? e.message : e); } catch { /* ignore */ }
      return { inject: [], apply() {} };
    }
  },
});
