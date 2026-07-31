/* =========================================================================
 * 80 export / ai — 导出 CSV / Markdown / 素材包 / 工程 JSON + AI 三模式
 * R-022 素材包汇总（维度+文字+转写）并导出
 * R-023 AI 三模式，默认模式③（导出给 WorkBuddy），不默认调云端
 * R-024 导出 CSV / 复制 Markdown / 导出素材包
 * R-025 工程 JSON 导入导出（不含视频本体）
 * ========================================================================= */
LP.exporter = (function () {
  const U = LP.util;
  const TEXT_FIELDS = () => LP.FIELDS.filter(f => ['select', 'multi', 'text', 'longtext'].indexOf(f.type) >= 0);

  function rows() {
    /* 优先用多维表当前筛选结果，保证"所见即所得导出" */
    if (LP.table && LP.table.currentRows) {
      const r = LP.table.currentRows();
      if (r && r.length) return r;
    }
    return LP.state.shots();
  }
  const val = (s, f) => {
    if (f.type === 'multi') return (s[f.key] || []).join('/');
    if (f.type === 'formula') return (s.out - s.in).toFixed(2);
    if (f.type === 'relation') { const g = s.groupId && LP.state.group(s.groupId); return g ? g.name : ''; }
    if (f.type === 'attachment') return s.thumb ? '有' : '';
    return s[f.key] || '';
  };
  /* 镜头在全片中的序号（不依赖时间线模块，避免导出时因模块未就绪而崩溃） */
  function shotNo(s) {
    const i = LP.state.shots().findIndex(x => x.id === s.id);
    return i < 0 ? '?' : (i + 1);
  }

  /* ------------------------------------------------------- R-024 CSV */
  function toCSV() {
    const fs = LP.FIELDS.filter(f => f.type !== 'attachment');
    const head = ['序号', '入点', '出点', '时长(s)'].concat(fs.filter(f => f.type !== 'formula').map(f => f.name));
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [head.map(q).join(',')];
    rows().forEach((s, i) => {
      const line = [i + 1, U.tc(s.in), U.tc(s.out), (s.out - s.in).toFixed(2)]
        .concat(fs.filter(f => f.type !== 'formula').map(f => val(s, f)));
      lines.push(line.map(q).join(','));
    });
    return lines.join('\r\n');
  }
  function exportCSV() {
    if (!LP.state.project.shots.length) return U.toast('还没有片段', 'err');
    U.download(safeName() + '_拉片表.csv', toCSV(), 'text/csv');
    U.toast('已导出 CSV', 'ok');
  }

  /* -------------------------------------------------- R-024 Markdown */
  function toMarkdown() {
    const p = LP.state.project;
    const list = rows();
    const L = [];
    L.push('# ' + p.meta.title + ' · 拉片表');
    L.push('');
    L.push('> 素材：' + (p.videoRef ? p.videoRef.name : '未载入') + '　比例：' + p.videoRatio +
      '　时长：' + U.dur(p.videoRef ? p.videoRef.duration : 0) + '　镜头数：' + list.length);
    L.push('> 导出时间：' + new Date().toLocaleString('zh-CN'));
    L.push('');
    const fs = LP.FIELDS.filter(f => ['select', 'multi', 'text', 'longtext'].indexOf(f.type) >= 0);
    L.push('| # | 入点 | 出点 | 时长 | ' + fs.map(f => f.name).join(' | ') + ' |');
    L.push('|---|---|---|---|' + fs.map(() => '---').join('|') + '|');
    list.forEach((s, i) => {
      L.push('| ' + (i + 1) + ' | ' + U.tc(s.in) + ' | ' + U.tc(s.out) + ' | ' + U.dur(s.out - s.in) + ' | ' +
        fs.map(f => String(val(s, f)).replace(/\n/g, '<br>').replace(/\|/g, '\\|')).join(' | ') + ' |');
    });
    if (p.groups.filter(g => !g.dissolved && LP.state.groupShots(g.id).length).length) {
      L.push(''); L.push('## 段落组分析');
      p.groups.forEach(g => {
        const ms = LP.state.groupShots(g.id);
        if (!ms.length) return;
        L.push('');
        L.push('### ▣ ' + g.name + '（' + ms.length + ' 镜，' + U.tc(Math.min.apply(null, ms.map(s => s.in))) + ' → ' + U.tc(Math.max.apply(null, ms.map(s => s.out))) + '）');
        if (g.analysis) L.push(g.analysis);
        L.push('成员：' + ms.map(s => '#' + shotNo(s)).join(' '));
      });
    }
    return L.join('\n');
  }
  async function copyMarkdown() {
    if (!LP.state.project.shots.length) return U.toast('还没有片段', 'err');
    const ok = await U.copy(toMarkdown());
    U.toast(ok ? 'Markdown 已复制到剪贴板' : '复制失败，请手动选择复制', ok ? 'ok' : 'err');
  }

  /* --------------------------------------------- R-022 素材包 */
  function blocksText(owner, indent) {
    const pre = indent || '';
    return (owner.blocks || []).map(b => {
      const txt = String(b.content || '').replace(/<[^>]+>/g, '').trim();
      if (b.type === 'divider') return pre + '---';
      if (b.type === 'voice') return pre + '（口述转写）' + (b.transcript || txt);
      if (b.type === 'h1') return pre + '## ' + txt;
      if (b.type === 'h2') return pre + '### ' + txt;
      if (b.type === 'list') return pre + '- ' + txt;
      if (b.type === 'todo') return pre + (b.checked ? '- [x] ' : '- [ ] ') + txt;
      if (b.type === 'quote') return pre + '> ' + txt;
      if (b.type === 'callout') return pre + '💡 ' + txt;
      return pre + txt;
    }).filter(x => x.replace(/^[\s>#\-]*/, '')).join('\n');
  }

  function buildPack() {
    const p = LP.state.project;
    const list = LP.state.shots();
    const L = [];
    L.push('# 拉片素材包 · ' + p.meta.title);
    L.push('');
    L.push('## 0. 元信息');
    L.push('- 素材文件：' + (p.videoRef ? p.videoRef.name : '未载入') + '（' + (p.videoRef ? p.videoRef.w + '×' + p.videoRef.h : '') + '，' + p.videoRatio + '）');
    L.push('- 全片时长：' + U.dur(p.videoRef ? p.videoRef.duration : 0));
    L.push('- 已拆镜头：' + list.length + ' 个；段落组：' + p.groups.filter(g => LP.state.groupShots(g.id).length).length + ' 个');
    L.push('- 覆盖率：' + coverage().toFixed(0) + '%（已拆片段时长 / 全片时长）');
    L.push('- 导出时间：' + new Date().toLocaleString('zh-CN'));
    L.push('');
    L.push('## 1. 统计概览');
    const st = stats();
    L.push('- 平均镜头时长：' + st.avg.toFixed(2) + 's；最短 ' + st.min.toFixed(2) + 's；最长 ' + st.max.toFixed(2) + 's');
    L.push('- 景别分布：' + fmtDist(st.size));
    L.push('- 运镜分布：' + fmtDist(st.move));
    L.push('- 声画关系：' + fmtDist(st.soundRel));
    L.push('- 切换方式：' + fmtDist(st.cutType));
    L.push('');
    L.push('## 2. 逐镜记录');
    list.forEach((s, i) => {
      L.push('');
      L.push('### 镜 ' + (i + 1) + '　' + U.tc(s.in) + ' → ' + U.tc(s.out) + '（' + U.dur(s.out - s.in) + '）' +
        (s.groupId && LP.state.group(s.groupId) ? '　[组：' + LP.state.group(s.groupId).name + ']' : ''));
      TEXT_FIELDS().forEach(f => {
        const v = val(s, f);
        if (v) L.push('- **' + f.name + '**：' + String(v).replace(/\n/g, ' '));
      });
      const bt = blocksText(s);
      if (bt) { L.push('- **分析记录**：'); L.push(bt.split('\n').map(x => '  ' + x).join('\n')); }
    });
    const grps = p.groups.filter(g => LP.state.groupShots(g.id).length);
    if (grps.length) {
      L.push(''); L.push('## 3. 段落组（组合分析）');
      grps.forEach(g => {
        const ms = LP.state.groupShots(g.id);
        L.push('');
        L.push('### ▣ ' + g.name + '（镜 ' + ms.map(s => LP.state.shots().indexOf(s) + 1).join('、') + '）');
        if (g.analysis) L.push(g.analysis);
        const bt = blocksText(g);
        if (bt) L.push(bt);
      });
    }
    L.push('');
    L.push('## 4. 请 AI 做的事');
    L.push('请基于以上逐镜记录，输出一份**声画技术拉片报告**（导演视角，不做剧情复述），包含：');
    L.push('1. **镜头语言总览**：景别与运镜的使用规律、这部片子的"视觉语法"是什么；');
    L.push('2. **声音设计**：同期声/音乐/静默的分工，声画同步与对位出现在哪些关键点；');
    L.push('3. **人物塑造手法**：镜头怎样让观众靠近或远离人物（具体到镜号）；');
    L.push('4. **节奏与情绪曲线**：用镜头时长序列说明节奏变化，指出情绪峰值所在段落；');
    L.push('5. **可复制清单（5–8 条）**：我在自己的人物访谈片里可以直接照做的具体做法，每条要能落到拍摄或剪辑动作上。');
    L.push('');
    L.push('注意：请引用镜号与时间码来支撑结论，不要泛泛而谈。');
    return L.join('\n');
  }
  function fmtDist(m) {
    const ks = Object.keys(m);
    if (!ks.length) return '（未填）';
    return ks.sort((a, b) => m[b] - m[a]).map(k => k + '×' + m[k]).join('、');
  }
  function coverage() {
    const d = LP.state.project.videoRef?.duration || 0;
    if (!d) return 0;
    const sum = LP.state.project.shots.reduce((a, s) => a + (s.out - s.in), 0);
    return Math.min(100, sum / d * 100);
  }
  function stats() {
    const list = LP.state.shots();
    const durs = list.map(s => s.out - s.in);
    const st = {
      n: list.length,
      avg: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0,
      min: durs.length ? Math.min.apply(null, durs) : 0,
      max: durs.length ? Math.max.apply(null, durs) : 0,
      size: {}, move: {}, soundRel: {}, cutType: {}, filled: 0
    };
    list.forEach(s => {
      if (s.size) st.size[s.size] = (st.size[s.size] || 0) + 1;
      (s.move || []).forEach(m => st.move[m] = (st.move[m] || 0) + 1);
      if (s.soundRel) st.soundRel[s.soundRel] = (st.soundRel[s.soundRel] || 0) + 1;
      if (s.cutType) st.cutType[s.cutType] = (st.cutType[s.cutType] || 0) + 1;
      const done = TEXT_FIELDS().filter(f => {
        const v = s[f.key]; return Array.isArray(v) ? v.length : (v != null && v !== '');
      }).length;
      if (done >= 4) st.filled++;
    });
    return st;
  }
  function exportPack() {
    if (!LP.state.project.shots.length) return U.toast('还没有片段', 'err');
    U.download(safeName() + '_素材包.md', buildPack(), 'text/markdown');
    U.toast('素材包已导出 · 拖进 WorkBuddy 即可生成报告', 'ok');
  }
  async function copyPack() {
    const ok = await U.copy(buildPack());
    U.toast(ok ? '素材包已复制，粘贴给 AI 即可' : '复制失败', ok ? 'ok' : 'err');
  }

  /* ------------------------------------------- R-025 工程 JSON */
  function exportProject() {
    const p = U.clone(LP.state.project);
    p.__app = 'lapian-studio-v2';
    p.__note = '本文件不含视频本体，只含 in/out 时间码与标注（虚拟片段）。导入后重新选择同一个视频即可恢复。';
    U.download(safeName() + '_工程.json', JSON.stringify(p, null, 2), 'application/json');
    U.toast('工程已导出（不含视频本体）', 'ok');
  }
  function importProjectFile(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(fr.result);
        if (!d.shots || !d.meta) throw new Error('不是拉片工程文件');
        if (!confirm('导入将覆盖当前工程（当前工程会先自动导出一份备份）。继续？')) return;
        exportProject();
        d.shots.forEach(s => { if (!Array.isArray(s.blocks)) s.blocks = []; });
        LP.state.setProject(d);
        const t = U.$('#projTitle'); if (t) t.value = d.meta.title || '未命名拉片工程';
        LP.media.applyRatioUI(); LP.media.renderMediaCard(!!d.videoRef);
        LP.media.tryRestore();
        U.toast('工程已导入 · 请重新选择同一个视频', 'ok');
      } catch (e) { U.toast('导入失败：' + e.message, 'err'); }
    };
    fr.readAsText(file);
  }
  function safeName() {
    return (LP.state.project.meta.title || '拉片').replace(/[\\/:*?"<>|]/g, '_');
  }

  /* -------------------------------------- R-023 报告页 / AI 三模式 */
  let aiMode = localStorage.getItem('lapian.aiMode') || 'export';

  function renderReport() {
    const box = U.$('#repWrap'); if (!box) return;
    const st = stats();
    const p = LP.state.project;
    box.innerHTML = '';

    /* 概览卡 */
    const c1 = U.el('div', { class: 'card' });
    c1.innerHTML = '<h3>工程概览</h3><div class="sub">' + U.esc(p.meta.title) +
      (p.videoRef ? ' · ' + U.esc(p.videoRef.name) + ' · ' + p.videoRatio : ' · 未载入视频') + '</div>' +
      '<div class="stat-grid">' +
      stat(st.n, '镜头数') + stat(st.avg.toFixed(1) + 's', '平均时长') +
      stat(coverage().toFixed(0) + '%', '拆解覆盖') +
      stat(st.filled + '/' + st.n, '已标注(≥4维)') +
      stat(p.groups.filter(g => LP.state.groupShots(g.id).length).length, '段落组') +
      '</div>' +
      '<div class="prog" title="标注完成度"><i style="width:' + (st.n ? st.filled / st.n * 100 : 0) + '%"></i></div>';
    box.appendChild(c1);

    /* 分布卡 */
    const c2 = U.el('div', { class: 'card' });
    c2.innerHTML = '<h3>镜头语言分布</h3><div class="sub">用来看你这部片子的"视觉语法"偏好</div>' +
      bars('景别', st.size, LP.FIELD_MAP.size.colors) +
      bars('运镜', st.move, null) +
      bars('声画关系', st.soundRel, LP.FIELD_MAP.soundRel.colors);
    box.appendChild(c2);

    /* 节奏卡 */
    const c3 = U.el('div', { class: 'card' });
    c3.innerHTML = '<h3>节奏曲线</h3><div class="sub">每根竖条 = 一个镜头的时长；越矮越快，长条=停顿/凝视</div>';
    c3.appendChild(rhythmSvg());
    box.appendChild(c3);

    /* AI 三模式 */
    const c4 = U.el('div', { class: 'card' });
    c4.innerHTML = '<h3>AI 报告 · 三种模式</h3><div class="sub">默认走隐私路径：不联网、不上传，导出素材包由你自己交给 AI。</div>';
    const modes = [
      {
        k: 'export', t: '③ 导出给 WorkBuddy 手动分析', badge: '<span class="badge rec">默认推荐</span>',
        d: '把素材包（Markdown）导出或复制，拖进 WorkBuddy / 任意大模型对话框，让它出完整报告。质量最高，素材本体不出机——只有你写的文字离开这台电脑，视频从不上传。'
      },
      {
        k: 'local', t: '① 本地 WebLLM', badge: '<span class="badge">全隐私·需下载模型</span>',
        d: '在浏览器里跑小模型（WebGPU）。完全离线，但小模型对影视分析的判断力有限，且首次需下载 GB 级权重。本版预留接口，未内置模型（内置会破坏"单文件、零依赖、不联网"的红线）。'
      },
      {
        k: 'cloud', t: '② 云端 LLM API（自带 key）', badge: '<span class="badge risk">有出机风险</span>',
        d: '你填自己的 API key，把素材包文本发给云端模型。注意：文字记录会离开本机。涉及敏感采访素材时不建议使用。本版仅提供说明，不内置任何请求代码，避免"看起来本地实则联网"。'
      }
    ];
    modes.forEach(m => {
      const d = U.el('div', { class: 'mode' + (aiMode === m.k ? ' on' : ''), 'data-k': m.k });
      d.innerHTML = '<div class="m-t">' + m.t + m.badge + '</div><div class="m-d">' + m.d + '</div>';
      d.onclick = () => { aiMode = m.k; localStorage.setItem('lapian.aiMode', m.k); renderReport(); };
      c4.appendChild(d);
    });
    const btns = U.el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:10px' });
    btns.appendChild(btn('导出素材包 .md', 'accent', exportPack));
    btns.appendChild(btn('复制素材包', '', copyPack));
    btns.appendChild(btn('导出 CSV', '', exportCSV));
    btns.appendChild(btn('复制 Markdown 拉片表', '', copyMarkdown));
    c4.appendChild(btns);
    box.appendChild(c4);

    /* 素材包预览 */
    const c5 = U.el('div', { class: 'card', style: 'grid-column:1/-1' });
    c5.innerHTML = '<h3>素材包预览</h3><div class="sub">这就是要交给 AI 的全部内容（维度 + 文字记录 + 语音转写）。可直接选中复制。</div>';
    const pre = U.el('pre', { class: 'pack', text: LP.state.project.shots.length ? buildPack() : '还没有片段。先导入视频 → 自动切分或手动建片段 → 填维度写记录。' });
    c5.appendChild(pre);
    box.appendChild(c5);
  }
  function stat(v, l) { return '<div class="stat"><div class="sv">' + v + '</div><div class="sl">' + l + '</div></div>'; }
  function btn(text, cls, fn) { const b = U.el('button', { class: 'btn ' + cls, text: text }); b.onclick = fn; return b; }
  function bars(title, map, colors) {
    const ks = Object.keys(map);
    if (!ks.length) return '<div style="margin:8px 0 4px;font-size:12px;color:var(--txt3)">' + title + '：未填写</div>';
    const max = Math.max.apply(null, ks.map(k => map[k]));
    return '<div style="margin:10px 0 4px;font-size:12px;color:var(--txt2)">' + title + '</div><div class="barlist">' +
      ks.sort((a, b) => map[b] - map[a]).map(k =>
        '<div class="barrow"><span class="bl">' + U.esc(k) + '</span><span class="bt"><i class="bf" style="width:' +
        (map[k] / max * 100) + '%;background:' + ((colors && colors[k]) || 'var(--accent2)') + '"></i></span><span class="bn">' + map[k] + '</span></div>'
      ).join('') + '</div>';
  }
  function rhythmSvg() {
    const list = LP.state.shots();
    const W = 600, H = 110;
    const wrap = U.el('div', { style: 'overflow-x:auto' });
    if (!list.length) { wrap.innerHTML = '<div style="color:var(--txt3);font-size:12px">还没有片段</div>'; return wrap; }
    const max = Math.max.apply(null, list.map(s => s.out - s.in));
    const bw = Math.max(3, Math.min(18, W / list.length - 2));
    const totalW = Math.max(W, list.length * (bw + 2) + 10);
    let svg = '<svg width="' + totalW + '" height="' + H + '" style="display:block">';
    list.forEach((s, i) => {
      const d = s.out - s.in;
      const h = Math.max(2, d / max * (H - 22));
      const color = (LP.FIELD_MAP.size.colors || {})[s.size] || '#4a7fa5';
      svg += '<rect x="' + (i * (bw + 2) + 4) + '" y="' + (H - 16 - h) + '" width="' + bw + '" height="' + h +
        '" fill="' + color + '" rx="1"><title>#' + (i + 1) + ' ' + d.toFixed(1) + 's ' + (s.size || '') + '</title></rect>';
    });
    svg += '<line x1="0" y1="' + (H - 15) + '" x2="' + totalW + '" y2="' + (H - 15) + '" stroke="#3a4048"/>';
    svg += '<text x="4" y="' + (H - 3) + '" fill="#6d747e" font-size="10">镜 1</text>';
    svg += '<text x="' + (totalW - 40) + '" y="' + (H - 3) + '" fill="#6d747e" font-size="10">镜 ' + list.length + '</text>';
    svg += '</svg>';
    wrap.innerHTML = svg;
    return wrap;
  }

  function init() {
    U.$('#btnSaveJson').onclick = exportProject;
    U.$('#btnLoadJson').onclick = () => U.$('#jsonInput').click();
    U.$('#jsonInput').onchange = e => { const f = e.target.files[0]; if (f) importProjectFile(f); e.target.value = ''; };
    LP.bus.on('page', p => { if (p === 'report') renderReport(); });
    LP.bus.on('change', () => { if (LP.ui && LP.ui.page === 'report') renderReport(); });
  }

  return {
    init, renderReport, exportCSV, copyMarkdown, exportPack, copyPack, exportProject, importProjectFile,
    buildPack, toMarkdown, toCSV, stats, coverage
  };
})();
