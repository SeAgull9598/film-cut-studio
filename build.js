#!/usr/bin/env node
/* 把 src/ 下的 css / html 骨架 / js 内联成单文件 index.html
 * 用法： node build.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'index.html');

const JS_ORDER = [
  '00-core.js',
  '10-media.js',
  '20-viewer.js',
  '30-timeline.js',
  '40-edit.js',
  '45-inspector.js',
  '50-table.js',
  '60-blocks.js',
  '70-sbd.js',
  '80-export-ai.js',
  '90-help.js',
  '99-main.js'
];

function read(f) {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) { console.warn('  [跳过] 缺少 ' + f); return ''; }
  return fs.readFileSync(p, 'utf8');
}
/* 防止脚本内容里的 </script> 提前闭合 */
const safe = s => s.replace(/<\/script>/gi, '<\\/script>');

const css = read('styles.css');
const body = read('body.html');

let js = '';
JS_ORDER.forEach(f => {
  const c = read(f);
  if (!c) return;
  js += '\n/* ==================== ' + f + ' ==================== */\n' + c + '\n';
});

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>拉片台 · 声画技术拉片工作站</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23131417'/%3E%3Crect x='6' y='9' width='9' height='14' rx='2' fill='%233f76ab'/%3E%3Crect x='17' y='9' width='9' height='14' rx='2' fill='%23e08b3a'/%3E%3C/svg%3E">
<meta name="description" content="本地优先的拉片工具：把一部影片拆成可分析、可回放、可导出的镜头单元。所有处理在浏览器内完成，素材不出机。">
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${safe(js)}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('✔ 已构建 index.html  (' + kb + ' KB, ' + html.split('\n').length + ' 行)');
