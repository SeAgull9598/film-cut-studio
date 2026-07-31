/* =========================================================================
 * 40 edit — 拆分 / 合并(编组) / 解散组 / 删除 / 复制粘贴 / 撤销 / 快捷键
 * R-011 拆分非破坏性：拆后两段 in/out 之和等于原段
 * R-012 合并为段落组：非破坏性，点组=虚拟顺序连播
 * R-013 解散组可逆：组合分析保留，可再组
 * 第 5 节 达芬奇快捷键表
 * ========================================================================= */
LP.edit = (function () {
  const U = LP.util;
  let clipboard = null;
  const MINLEN = () => 1 / (LP.state.project.meta.fps || 25);

  /* ------------------------------------------------------ 新建片段 */
  function addShotFromIO() {
    const io = LP.player.getIO();
    const dur = LP.player.duration();
    if (!dur) return U.toast('请先导入视频', 'err');
    let a = io.in, b = io.out;
    if (a == null && b == null) return U.toast('先按 I / O 设入出点', 'err');
    if (a == null) a = 0;
    if (b == null) b = dur;
    if (b - a < MINLEN()) return U.toast('区间太短', 'err');
    LP.state.push();
    const s = LP.model.newShot(a, b);
    LP.state.project.shots.push(s);
    LP.state.commit('新建片段');
    LP.state.select([s.id], null);
    U.toast('已建片段 #' + LP.timeline.indexOf(s.id) + '  ' + U.dur(b - a), 'ok');
    LP.player.clearIO();
    return s;
  }

  /** 把整片按现有切点补满（空隙自动成段） */
  function fillGaps() {
    const dur = LP.player.duration();
    if (!dur) return U.toast('请先导入视频', 'err');
    const shots = LP.state.shots();
    const gaps = [];
    let cursor = 0;
    shots.forEach(s => { if (s.in - cursor > 0.3) gaps.push([cursor, s.in]); cursor = Math.max(cursor, s.out); });
    if (dur - cursor > 0.3) gaps.push([cursor, dur]);
    if (!gaps.length) return U.toast('没有需要补的空隙');
    LP.state.push();
    gaps.forEach(g => LP.state.project.shots.push(LP.model.newShot(g[0], g[1])));
    LP.state.commit('补满空隙');
    U.toast('已补 ' + gaps.length + ' 个片段', 'ok');
  }

  /* -------------------------------------------------- R-011 拆分 */
  function splitAt(shot, t) {
    if (!shot) return U.toast('先选中一个片段', 'err');
    const min = MINLEN();
    if (t <= shot.in + min || t >= shot.out - min) return U.toast('切点在片段边缘，拆不动', 'err');
    LP.state.push();
    const right = LP.model.newShot(+t.toFixed(3), shot.out);
    /* 非破坏性：维度标注复制到后半段，块记录留在前半段 */
    LP.FIELDS.forEach(f => {
      if (['select', 'text', 'longtext'].indexOf(f.type) >= 0) right[f.key] = shot[f.key] || '';
      if (f.type === 'multi') right[f.key] = (shot[f.key] || []).slice();
    });
    right.groupId = shot.groupId;
    shot.out = +t.toFixed(3);
    LP.state.project.shots.push(right);
    if (right.groupId) {
      const g = LP.state.group(right.groupId);
      if (g && g.memberShotIds.indexOf(right.id) < 0) g.memberShotIds.push(right.id);
    }
    LP.state.commit('拆分片段');
    LP.state.select([right.id], null);
    U.toast('已拆分 → #' + LP.timeline.indexOf(shot.id) + ' / #' + LP.timeline.indexOf(right.id), 'ok');
  }
  function splitAtPlayhead() {
    const t = LP.player.time();
    let s = LP.state.current();
    if (!s || t <= s.in || t >= s.out) s = LP.state.shots().find(x => t > x.in && t < x.out);
    if (!s) return U.toast('播放头不在任何片段内', 'err');
    splitAt(s, t);
  }

  /* ---------------------------------------- R-012 合并（编组） */
  function groupSelected() {
    const ids = LP.state.selection.shotIds;
    if (ids.length < 2) return U.toast('至少选 2 个相邻片段（Shift 点选）', 'err');
    const shots = LP.state.shots().filter(s => ids.indexOf(s.id) >= 0);
    /* 相邻性校验：按时间排序后不允许中间夹着未选中的片段 */
    const all = LP.state.shots();
    const first = all.indexOf(shots[0]), last = all.indexOf(shots[shots.length - 1]);
    if (last - first + 1 !== shots.length) {
      if (!confirm('选中的片段不完全相邻，仍要编组吗？（组内将按时间顺序连播）')) return;
    }
    if (shots.some(s => s.groupId)) {
      if (!confirm('部分片段已属于其它段落组，继续将把它们移到新组。')) return;
    }
    LP.state.push();
    shots.forEach(s => {
      if (s.groupId) {
        const old = LP.state.group(s.groupId);
        if (old) old.memberShotIds = old.memberShotIds.filter(i => i !== s.id);
      }
    });
    const name = '段落 ' + (LP.state.project.groups.length + 1);
    const g = LP.model.newGroup(name, shots.map(s => s.id));
    shots.forEach(s => { s.groupId = g.id; });
    LP.state.project.groups.push(g);
    /* 清理空组 */
    LP.state.project.groups = LP.state.project.groups.filter(x => x.id === g.id || LP.state.groupShots(x.id).length);
    LP.state.commit('编组');
    LP.state.select(shots.map(s => s.id), g.id);
    U.toast('已编组「' + name + '」' + shots.length + ' 镜 · 点色带可连播', 'ok');
  }

  /* --------------------------------------- R-013 解散组（可逆） */
  function ungroupSelected() {
    let gid = LP.state.selection.groupId;
    if (!gid) {
      const s = LP.state.current();
      gid = s && s.groupId;
    }
    if (!gid) return U.toast('先选中一个段落组', 'err');
    const g = LP.state.group(gid); if (!g) return;
    LP.state.push();
    const members = LP.state.groupShots(gid);
    members.forEach(s => { s.groupId = null; });
    /* 可逆：组对象连同组合分析保留在回收区，可再组 */
    g.memberShotIds = [];
    g.dissolved = true;
    LP.state.commit('解散组');
    LP.state.select(members.map(s => s.id), null);
    U.toast('已解散「' + g.name + '」，组合分析已保留，可再次编组恢复', 'ok');
  }
  /* ----------------------------------- R-011 合并相邻镜头（删除中间切点） */
  /** 把选中的相邻镜头合成一段：保留最左 in + 最右 out，删除中间切点。
   *  与"编组"不同——编组只是打标签、两段仍在；合并是真正把两段并成一段。 */
  function mergeSelected() {
    const all = LP.state.shots();                       // 已按 in 排序
    const ids = LP.state.selection.shotIds.slice();
    if (ids.length < 2) return U.toast('请先选中 2 个以上相邻镜头（Shift 点选）再合并', 'err');
    const sel = all.filter(s => ids.indexOf(s.id) >= 0).sort((a, b) => a.in - b.in);
    if (sel.length < 2) return U.toast('至少选 2 个相邻镜头才能合并', 'err');
    /* 相邻性校验：选中片段在时间线上必须连续，中间不能夹着未选中的镜头 */
    const first = all.indexOf(sel[0]), last = all.indexOf(sel[sel.length - 1]);
    if (last - first + 1 !== sel.length)
      return U.toast('选中的镜头不连续，请只选相邻的一串', 'err');
    LP.state.push();
    const left = sel[0], right = sel[sel.length - 1];
    left.out = +right.out.toFixed(3);                   // 合并 = 最左 in + 最右 out
    const keepGid = left.groupId || right.groupId || null;   // 归属：最左优先，其次最右
    if (keepGid) {
      const g = LP.state.group(keepGid);
      if (g && g.memberShotIds.indexOf(left.id) < 0) g.memberShotIds.push(left.id);
    }
    sel.slice(1).forEach(s => {
      if (s.groupId) { const g = LP.state.group(s.groupId); if (g) g.memberShotIds = g.memberShotIds.filter(id => id !== s.id); }
      LP.state.project.shots = LP.state.project.shots.filter(x => x.id !== s.id);
    });
    left.groupId = keepGid;
    LP.state.commit('合并镜头');
    LP.state.select([left.id], keepGid);
    U.toast('已合并 ' + sel.length + ' 镜 → #' + (all.indexOf(left) + 1) + '（' + U.tc(left.in) + ' → ' + U.tc(left.out) + '）', 'ok');
  }

  /** 把选中片段并入一个已解散/已有的组（恢复用） */
  function regroupInto(gid) {
    const g = LP.state.group(gid); if (!g) return;
    const ids = LP.state.selection.shotIds;
    if (!ids.length) return U.toast('先选中片段', 'err');
    LP.state.push();
    ids.forEach(id => { const s = LP.state.shot(id); if (s) { s.groupId = gid; if (g.memberShotIds.indexOf(id) < 0) g.memberShotIds.push(id); } });
    g.dissolved = false;
    LP.state.commit('恢复编组');
    U.toast('已并入「' + g.name + '」', 'ok');
  }

  /* -------------------------------------------------------- 删除 */
  function deleteSelected() {
    const ids = LP.state.selection.shotIds.slice();
    const gid = LP.state.selection.groupId;
    if (!ids.length && !gid) return U.toast('没有选中的片段', 'err');
    if (ids.length > 1 && !confirm('删除 ' + ids.length + ' 个片段？（可 Cmd/Ctrl+Z 撤销）')) return;
    LP.state.push();
    LP.state.project.shots = LP.state.project.shots.filter(s => ids.indexOf(s.id) < 0);
    LP.state.project.groups.forEach(g => { g.memberShotIds = g.memberShotIds.filter(i => ids.indexOf(i) < 0); });
    LP.state.select([], null);
    LP.state.commit('删除片段');
    U.toast('已删除 ' + ids.length + ' 个片段（可撤销）');
  }

  /* --------------------------------------------------- 复制 / 粘贴 */
  function copySelected() {
    const ss = LP.state.selection.shotIds.map(id => LP.state.shot(id)).filter(Boolean);
    if (!ss.length) return;
    clipboard = U.clone(ss);
    U.toast('已复制 ' + ss.length + ' 个片段的标注');
  }
  /** 粘贴：在播放头处贴入同样时长与标注的片段 */
  function paste() {
    if (!clipboard || !clipboard.length) return U.toast('剪贴板是空的');
    LP.state.push();
    let cursor = LP.player.time();
    const created = [];
    clipboard.forEach(c => {
      const len = c.out - c.in;
      const s = LP.model.newShot(cursor, Math.min(cursor + len, LP.player.duration()));
      LP.FIELDS.forEach(f => {
        if (f.type === 'multi') s[f.key] = (c[f.key] || []).slice();
        else if (['select', 'text', 'longtext'].indexOf(f.type) >= 0) s[f.key] = c[f.key] || '';
      });
      s.thumb = c.thumb || null;
      s.blocks = U.clone(c.blocks || []);
      LP.state.project.shots.push(s); created.push(s.id);
      cursor += len;
    });
    LP.state.commit('粘贴片段');
    LP.state.select(created, null);
    U.toast('已粘贴 ' + created.length + ' 个片段', 'ok');
  }

  /* ------------------------------------------------ 选择辅助 */
  function selectByOffset(delta) {
    const list = LP.state.shots();
    if (!list.length) return;
    const cur = LP.state.current();
    let i = cur ? list.indexOf(cur) : -1;
    i = U.clamp(i + delta, 0, list.length - 1);
    const s = list[i];
    LP.state.select([s.id], null);
    LP.player.playRange(s.in, s.out, { shotId: s.id, noPlay: true });
    LP.timeline.scrollToTime(s.in);
  }

  /* -------------------------------------------- 达芬奇快捷键 */
  function isTyping(e) {
    const t = e.target;
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function onKey(e) {
    if (isTyping(e)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;

    /* 通用 */
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); return e.shiftKey ? LP.state.redo() : LP.state.undo(); }
    if (mod && (k === 'c' || k === 'C')) { e.preventDefault(); return copySelected(); }
    if (mod && (k === 'v' || k === 'V')) { e.preventDefault(); return paste(); }
    if (mod && (k === 'b' || k === 'B')) { e.preventDefault(); return splitAtPlayhead(); }
    if (mod && e.shiftKey && (k === 'g' || k === 'G')) { e.preventDefault(); return ungroupSelected(); }
    if (mod && (k === 's' || k === 'S')) { e.preventDefault(); LP.storage.save(); return U.toast('工程已保存到本机', 'ok'); }
    if (mod) return;   /* 其它带修饰键的交给浏览器 */

    switch (k) {
      case ' ': e.preventDefault(); LP.player.toggle(); break;
      case 'i': case 'I':
        e.preventDefault();
        if (e.shiftKey) { const io = LP.player.getIO(); if (io.in != null) LP.player.seek(io.in); }
        else LP.player.setIn();
        break;
      case 'o': case 'O':
        e.preventDefault();
        if (e.shiftKey) { const io = LP.player.getIO(); if (io.out != null) LP.player.seek(io.out); }
        else LP.player.setOut();
        break;
      case 'j': case 'J': e.preventDefault(); LP.player.jkl(-1); break;
      case 'k': case 'K': e.preventDefault(); LP.player.jkl(0); break;
      case 'l': case 'L': e.preventDefault(); LP.player.jkl(1); break;
      case 'ArrowLeft': e.preventDefault(); e.shiftKey ? LP.player.jumpCut(-1) : LP.player.stepFrame(-1); break;
      case 'ArrowRight': e.preventDefault(); e.shiftKey ? LP.player.jumpCut(1) : LP.player.stepFrame(1); break;
      case 'ArrowUp': e.preventDefault(); selectByOffset(-1); break;
      case 'ArrowDown': e.preventDefault(); selectByOffset(1); break;
      case 'b': case 'B': LP.timeline.setTool('blade'); U.toast('刀片工具：点击片段处切开'); break;
      case 'a': case 'A': LP.timeline.setTool('arrow'); U.toast('选择工具'); break;
      case 'g': case 'G': e.preventDefault(); groupSelected(); break;
    case 'm': case 'M': e.preventDefault(); mergeSelected(); break;
      case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); break;
      case 'Enter': {
        const s = LP.state.current();
        if (s) LP.player.playRange(s.in, s.out, { shotId: s.id });
        break;
      }
      case '?': if (LP.help && LP.help.shortcuts) LP.help.shortcuts(); break;
      case 'Escape': LP.player.clearRange(); LP.timeline.setTool('arrow'); break;
      default:
        if (k === '/' && e.shiftKey && LP.help) LP.help.shortcuts();
    }
  }

  function init() {
    document.addEventListener('keydown', onKey);
    U.$('#btnSplit').onclick = splitAtPlayhead;
    U.$('#btnGroup').onclick = groupSelected;
    U.$('#btnUngroup').onclick = ungroupSelected;
    U.$('#btnMerge').onclick = mergeSelected;
    U.$('#btnDelShot').onclick = deleteSelected;
    U.$('#btnFillGaps').onclick = fillGaps;
    U.$('#btnUndo').onclick = () => LP.state.undo();
    U.$('#btnRedo').onclick = () => LP.state.redo();
  }

  return {
    init, addShotFromIO, splitAt, splitAtPlayhead, groupSelected, ungroupSelected, mergeSelected,
    regroupInto, deleteSelected, copySelected, paste, fillGaps, selectByOffset
  };
})();
