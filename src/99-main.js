/* =========================================================================
 * 99 main — 启动装配 / 页面切换 / 工程恢复
 * ========================================================================= */
LP.ui = (function () {
  const U = LP.util;
  let page = 'cut';

  function setPage(p) {
    page = p;
    ['cut', 'table', 'report'].forEach(k => {
      const sec = U.$('#page-' + k); if (sec) sec.hidden = (k !== p);
    });
    U.$$('#pagebar .pg').forEach(b => b.classList.toggle('on', b.dataset.page === p));
    LP.bus.emit('page', p);
    /* 切回拉片台时时间线尺寸可能变了 */
    if (p === 'cut' && LP.timeline) setTimeout(() => LP.timeline.render(), 0);
  }

  function status(txt) { const el = U.$('#statusBar'); if (el) el.textContent = txt; }

  function bindTitle() {
    const t = U.$('#projTitle');
    t.value = LP.state.project.meta.title || '未命名拉片工程';
    t.onchange = () => { LP.state.project.meta.title = t.value.trim() || '未命名拉片工程'; LP.state.commit('改名'); };
  }

  function refreshStatus() {
    const p = LP.state.project;
    const n = p.shots.length;
    const cov = LP.exporter.coverage();
    status(n ? (n + ' 镜 · 覆盖 ' + cov.toFixed(0) + '% · ' + p.groups.filter(g => LP.state.groupShots(g.id).length).length + ' 组') : '就绪 · 先导入视频');
  }

  async function boot() {
    /* 1. 恢复本地工程（R-025） */
    const saved = LP.storage.load();
    if (saved && saved.meta) {
      saved.shots = saved.shots || []; saved.groups = saved.groups || [];
      saved.shots.forEach(s => { if (!Array.isArray(s.blocks)) s.blocks = []; });
      LP.state.setProject(saved);
    }

    /* 2. 各模块初始化（顺序：底层 → 交互层） */
    LP.player.init();
    LP.timeline.init();
    LP.media.init();
    LP.edit.init();
    LP.inspector.init();
    LP.exporter.init();
    if (LP.table && LP.table.init) LP.table.init();
    if (LP.blocks && LP.blocks.init) LP.blocks.init();
    if (LP.sbd && LP.sbd.init) LP.sbd.init();
    if (LP.help && LP.help.init) LP.help.init();

    bindTitle();

    /* 3. 页面切换 */
    U.$$('#pagebar .pg').forEach(b => { b.onclick = () => setPage(b.dataset.page); });

    /* 4. 视频恢复 */
    if (LP.state.project.videoRef) {
      LP.media.applyRatioUI();
      LP.media.renderMediaCard();
      await LP.media.tryRestore();
      LP.timeline.fit();
    }

    LP.bus.on('change', refreshStatus);
    LP.bus.on('project:loaded', refreshStatus);
    refreshStatus();

    /* 5. 首次引导（R-026 小白友好） */
    if (LP.help && LP.help.welcome) LP.help.welcome();

    /* 6. 离开前保存 */
    window.addEventListener('beforeunload', () => LP.storage.save());

    LP.bus.emit('app:ready');
    console.log('%c拉片台 v2 已就绪 · 全程本地运行，无任何网络请求', 'color:#e08b3a');
  }

  return { boot, setPage, status, get page() { return page; } };
})();

document.addEventListener('DOMContentLoaded', () => {
  LP.ui.boot().catch(e => { console.error(e); LP.util.toast('启动失败：' + e.message, 'err'); });
});
