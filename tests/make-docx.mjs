#!/usr/bin/env node
/**
 * 用纯 Node 手搓最小 .docx（zip + WordprocessingML），供测试使用。
 *
 * 为什么不依赖外部工具：测试要能离线、跨机器跑；docx 本质就是一个 zip，
 * 用 node:zlib 的 deflateRaw 就能生成，注释里写清每个部件的作用。
 *
 * 用法：node tests/make-docx.mjs <输出目录>
 * 生成：docx-a.docx / docx-b.docx（改一段）/ docx-equal-a.docx / docx-table.docx
 */
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* ── 最小 zip 写入器（deflate，无加密） ── */

const CRC表 = (() => {
  const 表 = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    表[n] = c >>> 0;
  }
  return 表;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC表[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function 打包zip(文件们) {
  const 本地 = [];
  const 中央 = [];
  let 偏移 = 0;
  for (const f of 文件们) {
    const 名 = Buffer.from(f.名, 'utf8');
    const 原文 = Buffer.from(f.内容, 'utf8');
    const 压缩 = deflateRawSync(原文);
    const crc = crc32(原文);
    const 时间 = 0, 日期 = 0x21; // 固定 1980-01-01，保证产物可复现

    const 头 = Buffer.alloc(30);
    头.writeUInt32LE(0x04034b50, 0);
    头.writeUInt16LE(20, 4);
    头.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    头.writeUInt16LE(8, 8);
    头.writeUInt16LE(时间, 10);
    头.writeUInt16LE(日期, 12);
    头.writeUInt32LE(crc, 14);
    头.writeUInt32LE(压缩.length, 18);
    头.writeUInt32LE(原文.length, 22);
    头.writeUInt16LE(名.length, 26);
    头.writeUInt16LE(0, 28);
    本地.push(头, 名, 压缩);

    const 央 = Buffer.alloc(46);
    央.writeUInt32LE(0x02014b50, 0);
    央.writeUInt16LE(20, 4);
    央.writeUInt16LE(20, 6);
    央.writeUInt16LE(0x0800, 8);
    央.writeUInt16LE(8, 10);
    央.writeUInt16LE(时间, 12);
    央.writeUInt16LE(日期, 14);
    央.writeUInt32LE(crc, 16);
    央.writeUInt32LE(压缩.length, 20);
    央.writeUInt32LE(原文.length, 24);
    央.writeUInt16LE(名.length, 28);
    央.writeUInt16LE(0, 30);
    央.writeUInt16LE(0, 32);
    央.writeUInt16LE(0, 34);
    央.writeUInt16LE(0, 36);
    央.writeUInt32LE(0, 38);
    央.writeUInt32LE(偏移, 42);
    中央.push(央, 名);

    偏移 += 头.length + 名.length + 压缩.length;
  }
  const 中央体 = Buffer.concat(中央);
  const 尾 = Buffer.alloc(22);
  尾.writeUInt32LE(0x06054b50, 0);
  尾.writeUInt16LE(0, 4);
  尾.writeUInt16LE(0, 6);
  尾.writeUInt16LE(文件们.length, 8);
  尾.writeUInt16LE(文件们.length, 10);
  尾.writeUInt32LE(中央体.length, 12);
  尾.writeUInt32LE(偏移, 16);
  尾.writeUInt16LE(0, 20);
  return Buffer.concat([...本地, 中央体, 尾]);
}

/* ── WordprocessingML ── */

const 转义 = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function 段(text, 样式) {
  const pPr = 样式 ? `<w:pPr><w:pStyle w:val="${样式}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${转义(text)}</w:t></w:r></w:p>`;
}

function 表(rows) {
  const 列数 = Math.max(...rows.map((r) => r.length));
  const 格 = (c) => `<w:tc><w:tcPr/><w:p><w:r><w:t xml:space="preserve">${转义(c)}</w:t></w:r></w:p></w:tc>`;
  const 行 = rows.map((r) => `<w:tr>${Array.from({ length: 列数 }, (_, i) => 格(r[i] || '')).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${Array.from({ length: 列数 }, () => '<w:gridCol w:w="2600"/>').join('')}</w:tblGrid>${行}</w:tbl>`;
}

const 文档头 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function 生成docx(blocks) {
  const 体 = blocks.map((b) => {
    if (b.heading) return 段(b.text, 'Heading' + b.heading);
    if (b.table) return 表(b.table);
    return 段(b.text);
  }).join('');
  const document = 文档头 + `<w:document xmlns:w="${W}"><w:body>${体}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
  const styles = 文档头 + `<w:styles xmlns:w="${W}">` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    [1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${n - 1}"/></w:pPr></w:style>`).join('') +
    '</w:styles>';
  const contentTypes = 文档头 + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';
  const rels = 文档头 + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  const docRels = 文档头 + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';
  return 打包zip([
    { 名: '[Content_Types].xml', 内容: contentTypes },
    { 名: '_rels/.rels', 内容: rels },
    { 名: 'word/document.xml', 内容: document },
    { 名: 'word/styles.xml', 内容: styles },
    { 名: 'word/_rels/document.xml.rels', 内容: docRels },
  ]);
}

/* ── fixtures ── */

const 基础 = [
  { heading: 1, text: '采购合同' },
  { heading: 2, text: '第一条 标的' },
  { text: '卖方应向买方交付服务器 10 台，型号为 A100。' },
  { heading: 2, text: '第二条 价款' },
  { text: '合同总价为人民币 100000 元，含税。' },
  { heading: 2, text: '第三条 交付' },
  { text: '卖方应在合同签订后 7 日内交付。' },
  { heading: 2, text: '第四条 违约' },
  { text: '逾期交付的，每日按合同总价的 0.5% 支付违约金。' },
  { table: [['项目', '数量', '备注'], ['服务器', '10', 'A100'], ['交换机', '2', '万兆']] },
];

const 改价 = 基础.map((b) => (b.text === '卖方应在合同签订后 7 日内交付。' ? { text: '卖方应在合同签订后 15 日内交付。' } : b));
const 加表行 = 基础.map((b) => (b.table
  ? { table: [...b.table, ['光模块', '20', '40G']] }
  : b));
// 标题层级变化：第三条从 H2 降为 H3
const 改层级 = 基础.map((b) => (b.heading === 2 && b.text === '第三条 交付' ? { heading: 3, text: b.text } : b));

const 输出目录 = resolve(process.argv[2] || '.');
mkdirSync(输出目录, { recursive: true });
writeFileSync(join(输出目录, 'docx-a.docx'), 生成docx(基础));
writeFileSync(join(输出目录, 'docx-equal-a.docx'), 生成docx(基础));
writeFileSync(join(输出目录, 'docx-b.docx'), 生成docx(改价));
writeFileSync(join(输出目录, 'docx-table.docx'), 生成docx(加表行));
writeFileSync(join(输出目录, 'docx-heading.docx'), 生成docx(改层级));
console.log('已生成 docx fixtures：' + 输出目录);
