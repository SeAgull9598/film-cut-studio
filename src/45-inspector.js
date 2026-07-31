/* =========================================================================
 * 45 inspector — 右侧检查器（七维度标注） + 左侧片段池
 * R-014/015/016 字段类型与七维度（检查器形态）
 * R-021 块记录挂到当前片段/组
 * R-026 每个字段挂"看什么/怎么写"提示卡
 * ========================================================================= */
LP.inspector = (function () {
  const U = LP.util;
  let tab = 'dims';
  let closedDims = {};
  try { closedDims = JSON.parse(localStorage.getItem('lapian.dimClosed') || '{}'); } catch (e) { }

  /* --------------------------------------------------- 字段控件 */
  function fieldEl(owner, f) {
    const wrap = U.el('div', { class: 'field' });
    const lb = U.el('div', { class: 'field-lb' });
    lb.appendChild(U.el('span', { text: f.name }));
    lb.appendChild(U.el('span', { class: 'ftype', text: typeLabel(f.type) }));
    if (f.watch) {
      const q = U.el('button', { class: 'hint-btn', text: '?', type: 'button' });
      lb.appendChild(q);
      if (LP.help && LP.help.attachHint) LP.help.attachHint(q, f);
    }
    wrap.appendChild(lb);

    if (f.type === 'select') wrap.appendChild(selectCtl(owner, f));
    else if (f.type === 'multi') wrap.appendChild(multiCtl(owner, f));
    else if (f.type === 'text') wrap.appendChild(textCtl(owner, f, false));
    else if (f.type === 'longtext') wrap.appendChild(textCtl(owner, f, true));
    else if (f.type === 'attachment') wrap.appendChild(attachCtl(owner, f));
    else if (f.type === 'relation') wrap.appendChild(relationCtl(owner, f));
    else if (f.type === 'formula') wrap.appendChild(formulaCtl(owner, f));
    return wrap;
  }
  function typeLabel(t) {
    return { select: '单选', multi: '多选', text: '文本', longtext: '长文本', attachment: '附件', relation: '关联', formula: '公式' }[t] || t;
  }
  function setVal(owner, key, val, label) {
    LP.state.push();
    owner[key] = val;
    LP.state.commit(label || '编辑维度');
  }
  function selectCtl(owner, f) {
    const box = U.el('div', { class: 'opts' });
    f.options.forEach(op => {
      const on = owner[f.key] === op;
      const b = U.el('button', { class: 'opt' + (on ? ' on' : ''), text: op, type: 'button' });
      if (on && f.colors && f.colors[op]) b.style.background = f.colors[op];
      b.onclick = () => setVal(owner, f.key, on ? '' : op);
      box.appendChild(b);
    });
    return box;
  }
  function multiCtl(owner, f) {
    const cur = owner[f.key] || [];
    const box = U.el('div', { class: 'opts' });
    f.options.forEach(op => {
      const on = cur.indexOf(op) >= 0;
      const b = U.el('button', { class: 'opt' + (on ? ' on' : ''), text: op, type: 'button' });
      if (on) b.style.background = 'var(--accent2)';
      b.onclick = () => {
        const next = on ? cur.filter(x => x !== op) : cur.concat([op]);
        setVal(owner, f.key, next);
      };
      box.appendChild(b);
    });
    return box;
  }
  function textCtl(owner, f, long) {
    const el = long
      ? U.el('textarea', { rows: 3, placeholder: f.write || '' })
      : U.el('input', { type: 'text', placeholder: f.write || '' });
    el.value = owner[f.key] || '';
    let timer = null, pushed = false;
    el.addEventListener('input', () => {
      if (!pushed) { LP.state.push(); pushed = true; }
      owner[f.key] = el.value;
      clearTimeout(timer);
      timer = setTimeout(() => { LP.state.commit('编辑 ' + f.name); pushed = false; }, 500);
    });
    el.addEventListener('blur', () => { clearTimeout(timer); if (pushed) { LP.state.commit('编辑 ' + f.name); pushed = false; } });
    if (long) el.addEventListener('input', () => { el.style.height = 'auto'; el.style.height = Math.min(220, el.scrollHeight + 2) + 'px'; });
    return el;
  }
  function attachCtl(owner, f) {
    const box = U.el('div', {});
    if (owner.thumb) {
      const img = U.el('img', { src: owner.thumb, style: 'max-width:100%;border-radius:4px;border:1px solid var(--line);display:block' });
      box.appendChild(img);
    } else {
      box.appendChild(U.el('div', { class: 'hd-sub', text: '未抓帧（截图只是备注，不是分析本体）', style: 'font-size:11.5px;color:var(--txt3)' }));
    }
    const row = U.el('div', { style: 'display:flex;gap:5px;margin-top:5px' });
    const b1 = U.el('button', { class: 'btn xs', text: '抓当前帧', type: 'button' });
    b1.onclick = () => {
      const d = LP.media.grabFrame(320);
      if (!d) return U.toast('抓帧失败', 'err');
      setVal(owner, 'thumb', d, '抓帧');
    };
    const b2 = U.el('button', { class: 'btn xs', text: '抓片段首帧', type: 'button' });
    b2.onclick = async () => {
      const d = await LP.media.captureShotThumb(owner);
      if (d) setVal(owner, 'thumb', d, '抓帧');
    };
    row.appendChild(b1); row.appendChild(b2);
    if (owner.thumb) {
      const b3 = U.el('button', { class: 'btn xs danger', text: '清除', type: 'button' });
      b3.onclick = () => setVal(owner, 'thumb', null, '清除关键帧');
      row.appendChild(b3);
    }
    box.appendChild(row);
    return box;
  }
  function relationCtl(owner, f) {
    const box = U.el('div', {});
    const g = owner.groupId ? LP.state.group(owner.groupId) : null;
    if (g) {
      const chip = U.el('span', { class: 'chip', text: '▣ ' + g.name, style: 'background:var(--grp);color:#efe8f8;cursor:pointer' });
      chip.onclick = () => { LP.state.select(LP.state.groupShots(g.id).map(s => s.id), g.id); };
      box.appendChild(chip);
      const b = U.el('button', { class: 'btn xs', text: '移出组', type: 'button', style: 'margin-left:6px' });
      b.onclick = () => {
        LP.state.push();
        const gg = LP.state.group(owner.groupId);
        if (gg) gg.memberShotIds = gg.memberShotIds.filter(i => i !== owner.id);
        owner.groupId = null; LP.state.commit('移出组');
      };
      box.appendChild(b);
    } else {
      const sel = U.el('select', {});
      sel.appendChild(U.el('option', { value: '', text: '（未归组）' }));
      LP.state.project.groups.forEach(g2 => sel.appendChild(U.el('option', { value: g2.id, text: g2.name + (g2.dissolved ? '（已解散·可恢复）' : '') })));
      sel.onchange = () => {
        if (!sel.value) return;
        LP.state.push();
        const gg = LP.state.group(sel.value);
        if (gg) { if (gg.memberShotIds.indexOf(owner.id) < 0) gg.memberShotIds.push(owner.id); gg.dissolved = false; }
        owner.groupId = sel.value; LP.state.commit('归入段落组');
      };
      box.appendChild(sel);
      box.appendChild(U.el('div', { class: 'hd-sub', text: '或在时间线 Shift 多选后按 G 编组', style: 'font-size:11px;color:var(--txt3);margin-top:3px' }));
    }
    return box;
  }
  function formulaCtl(owner, f) {
    const v = (owner.out - owner.in);
    return U.el('div', {
      style: 'font-family:var(--mono);color:var(--accent);font-size:13px',
      text: U.dur(v) + '   (' + U.tc(owner.in) + ' → ' + U.tc(owner.out) + ')'
    });
  }

  /* ------------------------------------------------- 渲染检查器 */
  function renderDims() {
    const box = U.$('#inspDims');
    const s = LP.state.current();
    const g = LP.state.currentGroup();
    box.innerHTML = '';

    if (g && !s) return renderGroupPanel(box, g);

    if (!s) {
      box.innerHTML = '<div class="insp-empty">未选中片段<br><small>在时间线点击色块，或按 I / O 设入出点后点「+ 建片段」<br>也可以用「自动切分」一次铺满</small></div>';
      U.$('#inspTitle').textContent = '未选中';
      return;
    }
    U.$('#inspTitle').textContent = '#' + LP.timeline.indexOf(s.id) + '  ' + U.dur(s.out - s.in);

    /* 片段头：时间码 + 播放/循环 */
    const hd = U.el('div', { class: 'dim-sec' });
    const hdb = U.el('div', { class: 'dim-body' });
    hdb.appendChild(U.el('div', {
      style: 'font-family:var(--mono);font-size:12px;color:var(--txt2);margin-bottom:6px',
      text: U.tc(s.in) + '  →  ' + U.tc(s.out)
    }));
    const row = U.el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap' });
    const bp = U.el('button', { class: 'btn xs accent', text: '▶ 播放本镜', type: 'button' });
    bp.onclick = () => LP.player.playRange(s.in, s.out, { shotId: s.id });
    const bl = U.el('button', { class: 'btn xs', text: '↻ 循环', type: 'button' });
    bl.onclick = () => { LP.player.loop = true; LP.player.playRange(s.in, s.out, { shotId: s.id }); };
    const bs = U.el('button', { class: 'btn xs', text: '✂ 播放头拆分', type: 'button' });
    bs.onclick = () => LP.edit.splitAtPlayhead();
    row.appendChild(bp); row.appendChild(bl); row.appendChild(bs);
    hdb.appendChild(row);
    hd.appendChild(hdb);
    box.appendChild(hd);

    /* 七维度分组 */
    LP.DIMS.forEach(d => {
      const fields = LP.FIELDS.filter(f => f.dim === d.dim);
      if (!fields.length) return;
      const sec = U.el('div', { class: 'dim-sec' + (closedDims[d.dim] ? ' closed' : '') });
      const filled = fields.some(f => {
        const v = s[f.key];
        return Array.isArray(v) ? v.length : (v != null && v !== '');
      });
      const head = U.el('div', { class: 'dim-hd' });
      head.innerHTML = '<span class="di">' + d.icon + '</span><span>' + d.name + '</span>' +
        (filled ? '<span class="chip dim" style="margin-left:4px">已填</span>' : '') +
        '<span class="arrow">▼</span>';
      head.onclick = () => {
        sec.classList.toggle('closed');
        closedDims[d.dim] = sec.classList.contains('closed');
        try { localStorage.setItem('lapian.dimClosed', JSON.stringify(closedDims)); } catch (e) { }
      };
      const body = U.el('div', { class: 'dim-body' });
      fields.forEach(f => body.appendChild(fieldEl(s, f)));
      sec.appendChild(head); sec.appendChild(body);
      box.appendChild(sec);
    });

    /* 其它字段（附件 / 关联 / 公式） */
    const sec2 = U.el('div', { class: 'dim-sec' });
    sec2.appendChild(U.el('div', { class: 'dim-hd', html: '<span class="di">▤</span><span>附件 / 关联 / 公式</span><span class="arrow">▼</span>' }));
    const body2 = U.el('div', { class: 'dim-body' });
    LP.FIELDS.filter(f => f.dim === 0).forEach(f => body2.appendChild(fieldEl(s, f)));
    sec2.appendChild(body2);
    sec2.querySelector('.dim-hd').onclick = () => sec2.classList.toggle('closed');
    box.appendChild(sec2);
  }

  function renderGroupPanel(box, g) {
    U.$('#inspTitle').textContent = '段落组 · ' + g.name;
    const ms = LP.state.groupShots(g.id);
    const sec = U.el('div', { class: 'dim-sec' });
    const body = U.el('div', { class: 'dim-body' });

    const nm = U.el('input', { type: 'text', value: g.name });
    nm.onchange = () => { LP.state.push(); g.name = nm.value; LP.state.commit('重命名组'); };
    body.appendChild(U.el('div', { class: 'field-lb', text: '组名' }));
    body.appendChild(nm);

    body.appendChild(U.el('div', { class: 'field-lb', text: '组合分析（这几镜连起来做了什么）', style: 'margin-top:9px' }));
    const ta = U.el('textarea', { rows: 5, placeholder: '例：三镜递进——全景交代空间，中景给动作，特写落在手上。组合起来是"从环境走进人"。' });
    ta.value = g.analysis || '';
    let t1 = null, pushed = false;
    ta.addEventListener('input', () => {
      if (!pushed) { LP.state.push(); pushed = true; }
      g.analysis = ta.value; clearTimeout(t1);
      t1 = setTimeout(() => { LP.state.commit('组合分析'); pushed = false; }, 500);
    });
    body.appendChild(ta);

    const row = U.el('div', { style: 'display:flex;gap:5px;margin-top:8px;flex-wrap:wrap' });
    const bp = U.el('button', { class: 'btn xs accent', text: '▶ 连播本组', type: 'button' });
    bp.onclick = () => LP.player.playQueue(ms.map(s => ({ in: s.in, out: s.out })), { label: g.name });
    const bu = U.el('button', { class: 'btn xs', text: '解散组', type: 'button' });
    bu.onclick = () => LP.edit.ungroupSelected();
    row.appendChild(bp); row.appendChild(bu);
    body.appendChild(row);

    body.appendChild(U.el('div', { class: 'field-lb', text: '成员（' + ms.length + ' 镜）', style: 'margin-top:10px' }));
    const list = U.el('div', {});
    ms.forEach(s => {
      const it = U.el('div', { class: 'pool-item' });
      it.innerHTML = '<div class="pool-meta"><div class="pool-name">#' + LP.timeline.indexOf(s.id) + ' ' +
        U.esc(s.size || '未填景别') + '</div><div class="pool-tc">' + U.tc(s.in) + ' → ' + U.tc(s.out) + '</div></div>';
      it.onclick = () => { LP.state.select([s.id], null); LP.player.playRange(s.in, s.out, { shotId: s.id }); };
      list.appendChild(it);
    });
    body.appendChild(list);
    sec.appendChild(body);
    box.appendChild(sec);
  }

  function renderBlocks() {
    const box = U.$('#inspBlocks');
    const s = LP.state.current();
    const g = LP.state.currentGroup();
    const owner = s || g;
    if (!owner) {
      box.innerHTML = '<div class="insp-empty">选中片段或段落组后，在这里写分析记录<br><small>支持 / 命令、语音记录（本地转写）</small></div>';
      return;
    }
    const label = s
      ? '#' + LP.timeline.indexOf(s.id) + '  ' + U.tc(s.in) + ' → ' + U.tc(s.out)
      : '▣ ' + g.name + '（' + LP.state.groupShots(g.id).length + ' 镜）';
    if (LP.blocks && LP.blocks.render) LP.blocks.render(box, owner, label);
    else box.innerHTML = '<div class="insp-empty">块编辑器模块未载入</div>';
  }

  /* ------------------------------------------------------ 片段池 */
  function renderPool() {
    const list = U.$('#poolList'); if (!list) return;
    const kw = (U.$('#poolSearch').value || '').trim().toLowerCase();
    const fil = U.$('#poolFilter').value;
    const sel = LP.state.selection.shotIds;
    const ratio = LP.state.project.videoRatio;
    const frag = document.createDocumentFragment();
    LP.state.shots().forEach((s, i) => {
      if (fil && s.size !== fil) return;
      if (kw) {
        const hay = [s.size, s.sizeNote, (s.move || []).join(''), s.moveWhy, s.blocking, s.light, s.sound, s.cut, s.sevenQ]
          .join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return;
      }
      const it = U.el('div', { class: 'pool-item' + (sel.indexOf(s.id) >= 0 ? ' sel' : ''), 'data-id': s.id });
      const th = s.thumb
        ? '<img class="pool-thumb' + (ratio === '9:16' ? ' vert' : '') + '" src="' + s.thumb + '">'
        : '<div class="pool-thumb' + (ratio === '9:16' ? ' vert' : '') + '"></div>';
      it.innerHTML = th +
        '<div class="pool-meta"><div class="pool-name"><span class="pool-idx">#' + (i + 1) + '</span> ' +
        U.esc(s.size || '—') + (s.move && s.move.length ? ' · ' + U.esc(s.move.join('')) : '') + '</div>' +
        '<div class="pool-tc">' + U.tc(s.in) + ' · ' + U.dur(s.out - s.in) + '</div></div>';
      it.onclick = () => { LP.state.select([s.id], null); LP.player.playRange(s.in, s.out, { shotId: s.id }); LP.timeline.scrollToTime(s.in); };
      frag.appendChild(it);
    });
    list.innerHTML = ''; list.appendChild(frag);
  }
  function fillPoolFilter() {
    const sel = U.$('#poolFilter'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">全部景别</option>' +
      LP.FIELD_MAP.size.options.map(o => '<option value="' + o + '">' + o + '</option>').join('');
    sel.value = cur;
  }

  function render() {
    if (tab === 'dims') renderDims(); else renderBlocks();
    renderPool();
  }

  function init() {
    fillPoolFilter();
    U.$$('.insp-tabs .tab').forEach(b => {
      b.onclick = () => {
        U.$$('.insp-tabs .tab').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        tab = b.dataset.itab;
        U.$('#inspDims').hidden = tab !== 'dims';
        U.$('#inspBlocks').hidden = tab !== 'blocks';
        render();
      };
    });
    U.$('#poolSearch').oninput = renderPool;
    U.$('#poolFilter').onchange = renderPool;
    LP.bus.on('selection', render);
    LP.bus.on('change', () => {
      /* 编辑输入时不整体重绘，避免焦点丢失 */
      const ae = document.activeElement;
      const inside = ae && (U.$('#inspDims').contains(ae) || U.$('#inspBlocks').contains(ae));
      if (inside) { renderPool(); return; }
      render();
    });
    LP.bus.on('project:loaded', render);
    render();
  }
  return { init, render, renderPool };
})();
