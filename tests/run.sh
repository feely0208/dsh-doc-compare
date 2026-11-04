#!/usr/bin/env bash
# dsh-doc-compare 测试：正例必报、干净样本 0 误报、退出码与限流都覆盖。
# 需要：纯 node（本机 npm 的 node 可能指向 Electron，优先 /usr/local/bin/node）
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$ROOT/tests/fixtures"
NODE="${NODE:-/usr/local/bin/node}"
[ -x "$NODE" ] || NODE="$(command -v node)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dsh-doc-compare-tests.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  ❌ %s\n' "$1"; }

# run_json <expected-exit> <label> <cli args...>：跑 CLI（带 --json），stdout 存 $TMP/out
run_json() {
  local exp="$1" label="$2"; shift 2
  "$NODE" "$ROOT/bin/cli.mjs" "$@" --json > "$TMP/out" 2> "$TMP/err"
  local code=$?
  if [ "$code" -eq "$exp" ]; then ok "$label（退出码 $code）"; else bad "$label：期望退出码 $exp，实际 $code；stderr=$(head -2 "$TMP/err" | tr '\n' ' ')"; fi
}

# check <label> <path> <expected> ...
check() {
  local label="$1"; shift
  if "$NODE" "$ROOT/tests/check.mjs" "$TMP/out" "$@" 2> "$TMP/checkerr"; then
    ok "$label"
  else
    bad "$label"; sed 's/^/     /' "$TMP/checkerr"
  fi
}

# 报告正文检查（不带 --json）
report_has() {
  local label="$1" pattern="$2"; shift 2
  "$NODE" "$ROOT/bin/cli.mjs" "$@" > "$TMP/md" 2>/dev/null
  if grep -q "$pattern" "$TMP/md"; then ok "$label"; else bad "$label"; fi
}

echo "dsh-doc-compare 测试（node: $NODE）"
echo

echo "【1】完全相同的两份 Markdown"
run_json 0 "相同 md 退出码 0" "$FIX/base.md" "$FIX/same.md"
check "0 差异、0 改动" 有差异 false 统计.改动段数 0 统计.修改 0 统计.新增 0 统计.删除 0

echo "【2】改一段 → 1 处修改（带词级差异）"
run_json 1 "改一段退出码 1" "$FIX/base.md" "$FIX/modified.md"
check "1 处修改，不多报" 有差异 true 统计.修改 1 统计.新增 0 统计.删除 0
check "差异类型=修改、有改前改后" 差异.0.类型 修改 差异.0.改前 "卖方应在合同签订后 7 日内交付。" 差异.0.改后 "卖方应在合同签订后 15 日内交付。"
if "$NODE" - "$TMP/out" <<'JS'
const fs = require('node:fs');
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const 片段 = j.差异[0].片段 || [];
const 有删 = 片段.some((f) => f.变化 === '删' && f.文本.includes('7'));
const 有增 = 片段.some((f) => f.变化 === '增' && f.文本.includes('15'));
if (!(有删 && 有增)) { console.error('词级差异没标出 7 → 15：' + JSON.stringify(片段)); process.exit(1); }
JS
then ok "词级差异标出了 7 → 15"; else bad "词级差异没标出 7 → 15"; fi

echo "【3】加一段 → 1 处新增"
run_json 1 "加一段退出码 1" "$FIX/base.md" "$FIX/added.md"
check "1 处新增" 统计.新增 1 统计.修改 0 统计.删除 0 差异.0.类型 新增

echo "【4】删一段 → 1 处删除"
run_json 1 "删一段退出码 1" "$FIX/base.md" "$FIX/deleted.md"
check "1 处删除" 统计.删除 1 统计.修改 0 统计.新增 0 差异.0.类型 删除

echo "【5】干净样本 0 误报（CRLF / 行尾空格 / 多余空行）"
run_json 0 "干净 txt 退出码 0" "$FIX/clean-a.txt" "$FIX/clean-b.txt"
check "0 误报" 有差异 false 统计.改动段数 0

echo "【6】docx 解析（纯 JS 手搓的最小 docx）"
"$NODE" "$ROOT/tests/make-docx.mjs" "$TMP" > /dev/null
run_json 0 "相同 docx 退出码 0" "$TMP/docx-a.docx" "$TMP/docx-equal-a.docx"
check "相同 docx 0 差异" 有差异 false 统计.改动段数 0
run_json 1 "改一段 docx 退出码 1" "$TMP/docx-a.docx" "$TMP/docx-b.docx"
check "docx 1 处修改" 统计.修改 1 统计.新增 0 统计.删除 0 差异.0.改后 "卖方应在合同签订后 15 日内交付。"

echo "【7】标题层级变化要单独提示"
run_json 1 "H2→H3 退出码 1" "$TMP/docx-a.docx" "$TMP/docx-heading.docx"
check "识别为标题层级变化（高风险）" 统计.标题变化 1 标题事件.0.事件 标题层级变化 标题事件.0.风险 高
report_has "报告里有「高风险提示」段" "高风险提示" "$TMP/docx-a.docx" "$TMP/docx-heading.docx"

echo "【8】表格行数变化"
run_json 1 "加表格行退出码 1" "$TMP/docx-a.docx" "$TMP/docx-table.docx"
check "行数 3 → 4（+1）" 表格差异.0.行数A 3 表格差异.0.行数B 4 表格差异.0.行数变化 1 表格差异.0.变化.0.类型 新增行

echo "【9】限流：--max-paragraphs 2"
printf '第一段。\n\n第二段。\n\n第三段。\n' > "$TMP/long-a.txt"
printf '第一段。\n\n第二段改。\n\n第三段改。\n' > "$TMP/long-b.txt"
run_json 1 "限流下退出码 1" "$TMP/long-a.txt" "$TMP/long-b.txt" --max-paragraphs 2
check "截断标记 + 只比前 2 段" 截断.发生 true 截断.上限 2 统计.改动段数 1
report_has "报告里提示了限流" "已限流" "$TMP/long-a.txt" "$TMP/long-b.txt" --max-paragraphs 2

echo "【10】--out 另存 Markdown 报告"
"$NODE" "$ROOT/bin/cli.mjs" "$FIX/base.md" "$FIX/modified.md" --out "$TMP/report.md" --quiet > /dev/null 2>&1
if [ -s "$TMP/report.md" ] && grep -q "文档比对报告" "$TMP/report.md"; then ok "--out 写出了报告文件"; else bad "--out 没写出报告"; fi

echo "【11】--json + --out 合法"
"$NODE" "$ROOT/bin/cli.mjs" "$FIX/base.md" "$FIX/modified.md" --json --out "$TMP/report.json" --quiet > /dev/null 2>&1
if "$NODE" -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$TMP/report.json" 2>/dev/null; then ok "--json 输出可被 JSON.parse"; else bad "--json 输出不是合法 JSON"; fi

echo "【12】解析失败退出码 2"
run_json 2 "不存在的文件退出码 2" "$FIX/base.md" "$TMP/不存在.md"
printf 'x' > "$TMP/a.pdf"
run_json 2 "不支持的扩展名退出码 2" "$TMP/a.pdf" "$FIX/base.md"
printf '不是 zip 的假 docx' > "$TMP/bad.docx"
run_json 2 "损坏的 docx 退出码 2" "$TMP/bad.docx" "$FIX/base.md"

echo "【13】宿主 HTTP 出口（info / badge / compare）"
if "$NODE" "$ROOT/tests/http.mjs" > "$TMP/httpout" 2>&1; then
  ok "HTTP 出口全部通过"
else
  bad "HTTP 出口失败"; sed 's/^/     /' "$TMP/httpout"
fi

echo
echo "合计：通过 $PASS，失败 $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
