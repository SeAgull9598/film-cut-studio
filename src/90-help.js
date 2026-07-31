/* =========================================================================
 * 拉片台 LaPian Studio — 90 help
 * 小白友好 / 帮助模块
 * 对应需求：
 *   R-026 引导提示卡（看什么 / 怎么写 / 示例话术）
 *   需求表 §5 达芬奇快捷键速查（学习成本兜底）
 *   R-027 术语速查 + 示例镜头库
 *   R-028 AI 初填维度（本地启发式草稿，P6：不调任何云端）
 *   首次使用引导 welcome()
 * 约束：传统 script，无 import/export；无任何网络请求；只用已有 CSS 类与变量。
 * ========================================================================= */
window.LP = window.LP || {};

LP.help = (function () {
  const U = LP.util;
  const el = U.el, $ = U.$, toast = U.toast;

  const IS_MAC = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const MOD = IS_MAC ? '⌘' : 'Ctrl';
  const WELCOME_KEY = 'lapian.welcomed';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  /* =====================================================================
   * 通用模态：点遮罩空白处或 Esc 关闭
   * ===================================================================== */
  let curMask = null, curKeyFn = null;

  function closeModal() {
    if (!curMask) return;
    curMask.remove();
    curMask = null;
    if (curKeyFn) document.removeEventListener('keydown', curKeyFn, true);
    curKeyFn = null;
  }

  /** modal(标题, 内容节点, 底栏节点) -> {mask, box, bd, close} */
  function modal(title, bodyEl, footEl, onClose) {
    hideHint();
    closeModal();

    const bd = el('div', { class: 'modal-bd' });
    if (bodyEl) bd.appendChild(bodyEl);

    const hd = el('div', { class: 'modal-hd' }, [
      el('h3', { text: title }),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn ghost', title: '关闭（Esc）', text: '✕', onclick: done })
    ]);

    const box = el('div', { class: 'modal' }, [hd, bd]);
    if (footEl) {
      const ft = el('div', { class: 'modal-ft' });
      ft.appendChild(footEl);
      box.appendChild(ft);
    }

    const mask = el('div', { class: 'mask' });
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) done(); });
    mask.appendChild(box);
    ($('#modalRoot') || document.body).appendChild(mask);

    curMask = mask;
    curKeyFn = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
    };
    document.addEventListener('keydown', curKeyFn, true);

    function done() {
      closeModal();
      if (onClose) { try { onClose(); } catch (err) { } }
    }
    return { mask: mask, box: box, bd: bd, close: done };
  }

  /* =====================================================================
   * R-026 引导提示卡
   * ===================================================================== */
  let hintEl = null, showTimer = null, hideTimer = null, hintOwner = null;

  /* 字段 -> 术语库定位关键词（提示卡里的「查术语」） */
  const FIELD_TERM = {
    size: '景别', sizeNote: '景别',
    move: '运镜', moveWhy: '运镜',
    blocking: '调度与构图',
    light: '光色',
    sound: '声音', soundRel: '声音',
    cut: '剪辑', cutType: '剪辑'
  };

  function hideHint() {
    clearTimeout(showTimer); clearTimeout(hideTimer);
    if (hintEl) { hintEl.remove(); hintEl = null; }
    hintOwner = null;
    window.removeEventListener('scroll', hideHint, true);
    window.removeEventListener('resize', hideHint, true);
    document.removeEventListener('keydown', onHintKey, true);
  }
  function onHintKey(e) { if (e.key === 'Escape') hideHint(); }

  function buildHint(field) {
    const n = el('div', { class: 'hintcard' });
    n.appendChild(el('h5', { text: field.name || '字段提示' }));
    if (field.watch) {
      n.appendChild(el('div', {}, [el('span', { class: 'hc-k', text: '看什么' }), document.createTextNode(field.watch)]));
    }
    if (field.write) {
      n.appendChild(el('div', {}, [el('span', { class: 'hc-k', text: '怎么写' }), document.createTextNode(field.write)]));
    }
    if (field.demo) n.appendChild(el('div', { class: 'hc-demo', text: field.demo }));

    const kw = FIELD_TERM[field.key];
    if (kw) {
      n.appendChild(el('div', { style: 'margin-top:7px' }, [
        el('button', {
          class: 'btn xs', text: '查术语 · ' + kw,
          onclick: function (e) { e.preventDefault(); e.stopPropagation(); hideHint(); terms(kw); }
        })
      ]));
    }
    /* 允许把鼠标移进卡片里（复制文字 / 点按钮） */
    n.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
    n.addEventListener('mouseleave', function () { hideTimer = setTimeout(hideHint, 140); });
    return n;
  }

  /** 视口避让：优先锚点下方左对齐，放不下就翻上 / 贴边 */
  function placeHint(node, anchor) {
    const gap = 8;
    node.style.left = '0px'; node.style.top = '0px';
    const a = anchor.getBoundingClientRect();
    const b = node.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;

    let left = a.left;
    if (left + b.width + gap > vw) left = vw - b.width - gap;
    if (left < gap) left = gap;

    let top = a.bottom + 6;
    if (top + b.height + gap > vh) {
      const up = a.top - b.height - 6;
      top = up >= gap ? up : Math.max(gap, vh - b.height - gap);
    }
    node.style.left = Math.round(left) + 'px';
    node.style.top = Math.round(top) + 'px';
  }

  function showHint(anchor, field) {
    hideHint();
    hintOwner = anchor;
    hintEl = buildHint(field);
    document.body.appendChild(hintEl);
    placeHint(hintEl, anchor);
    window.addEventListener('scroll', hideHint, true);
    window.addEventListener('resize', hideHint, true);
    document.addEventListener('keydown', onHintKey, true);
  }

  /**
   * R-026：给字段标签旁的小问号绑定提示卡
   * @param {HTMLElement} anchorEl 锚点（一般是 .hint-btn）
   * @param {object} field LP.FIELDS 里的字段定义
   */
  function attachHint(anchorEl, field) {
    if (!anchorEl || !field) return;
    if (!field.watch && !field.write) return;      // 没内容就不显示

    anchorEl.setAttribute('aria-label', (field.name || '') + ' 提示');
    const open = function () {
      clearTimeout(hideTimer); clearTimeout(showTimer);
      showTimer = setTimeout(function () { showHint(anchorEl, field); }, 200); // 200ms 防闪
    };
    const shut = function () {
      clearTimeout(showTimer);
      hideTimer = setTimeout(function () { if (hintOwner === anchorEl) hideHint(); }, 140);
    };
    anchorEl.addEventListener('mouseenter', open);
    anchorEl.addEventListener('mouseleave', shut);
    anchorEl.addEventListener('focus', open);
    anchorEl.addEventListener('blur', shut);
    anchorEl.addEventListener('click', function (e) {
      e.preventDefault();
      if (hintEl && hintOwner === anchorEl) hideHint(); else showHint(anchorEl, field);
    });
  }

  /* =====================================================================
   * 快捷键速查（需求表 §5，达芬奇键位）
   * ===================================================================== */
  const KEYMAP = [
    {
      g: '播放与走带', rows: [
        { k: ['Space'], d: '播放 / 暂停' },
        { k: ['J', 'K', 'L'], d: '倒放 / 暂停 / 正放（连按加速 2×、4×…）' },
        { k: ['←', '→'], d: '上一帧 / 下一帧（找准切点靠它）' },
        { k: ['Shift+←', 'Shift+→'], d: '跳到上一个 / 下一个剪辑点' }
      ]
    },
    {
      g: '入点与出点', rows: [
        { k: ['I'], d: '设入点' },
        { k: ['O'], d: '设出点' },
        { k: ['Shift+I'], d: '跳到入点' },
        { k: ['Shift+O'], d: '跳到出点' }
      ]
    },
    {
      g: '剪辑（拆分 / 合并）', rows: [
        { k: ['B'], d: '刀片工具（在时间线上点一下就切开）' },
        { k: [MOD + '+B'], d: '在播放头处拆分当前片段' },
        { k: ['M'], d: '合并选中的相邻片段（删除中间的假切点，真正并成一段）' },
        { k: ['G'], d: '把选中的相邻片段编成段落组' },
        { k: [MOD + '+Shift+G'], d: '解散段落组（可逆，原片段还在）' }
      ]
    },
    {
      g: '选择与编辑', rows: [
        { k: ['A'], d: '选择 / 箭头工具（从刀片切回来）' },
        { k: ['Del', 'Backspace'], d: '删除选中片段' },
        { k: [MOD + '+C'], d: '复制片段' },
        { k: [MOD + '+V'], d: '粘贴片段' }
      ]
    },
    {
      g: '通用', rows: [
        { k: [MOD + '+Z'], d: '撤销' },
        { k: [MOD + '+Shift+Z'], d: '重做' },
        { k: ['?'], d: '打开这份速查（Shift + /）' }
      ]
    }
  ];

  function keyCell(list) {
    const td = el('td', { style: 'white-space:nowrap' });
    list.forEach(function (combo, ci) {
      if (ci) td.appendChild(document.createTextNode(' / '));
      combo.split('+').forEach(function (part, pi) {
        if (pi) td.appendChild(document.createTextNode('+'));
        td.appendChild(el('kbd', { text: part }));
      });
    });
    return td;
  }

  /** 打开快捷键速查模态 */
  function shortcuts() {
    const body = el('div');
    body.appendChild(el('div', {
      style: 'color:var(--txt3);font-size:12px;margin-bottom:12px;line-height:1.7',
      text: '不用背，鼠标点按钮也能完成所有操作。键位对标达芬奇，习惯了会快很多。'
    }));

    const grid = el('div', { class: 'kbd-grid' });
    KEYMAP.forEach(function (sec) {
      const col = el('div');
      col.appendChild(el('h5', { style: 'margin:0 0 6px;font-size:12px;color:var(--accent)', text: sec.g }));
      const tb = el('table', { class: 'kbd-tb' });
      sec.rows.forEach(function (r) {
        const tr = el('tr');
        tr.appendChild(keyCell(r.k));
        tr.appendChild(el('td', { style: 'color:var(--txt2)', text: r.d }));
        tb.appendChild(tr);
      });
      col.appendChild(tb);
      grid.appendChild(col);
    });
    body.appendChild(grid);

    body.appendChild(el('div', {
      style: 'margin-top:14px;color:var(--txt3);font-size:11.5px;line-height:1.7',
      text: '提示：输入框里打字时快捷键不生效，先点一下画面或时间线再按键。'
    }));

    const ft = el('div', { style: 'display:flex;gap:7px' }, [
      el('button', { class: 'btn', text: '术语库', onclick: function () { terms(); } }),
      el('button', { class: 'btn accent', text: '知道了', onclick: closeModal })
    ]);
    modal('快捷键速查', body, ft);
  }

  /* =====================================================================
   * R-027 术语速查 + 示例镜头库
   * TERMS = [{cat, name, alias[], def, eg, how}]
   * 取向：声画技术拉片（导演视角），落点尽量给到访谈 / 人物纪录片可操作
   * ===================================================================== */
  const TERMS = [
    /* ---------------------------------------------------------- 景别 */
    {
      cat: '景别', name: '大远景', alias: ['ELS', 'extreme long shot', '大全景'],
      def: '人在画面里只是一个点，主角其实是环境本身。它交代地理、时间、天气，顺带交代"人有多小"。',
      eg: '《阿拉伯的劳伦斯》沙漠地平线上那个由黑点走成人形的出场；《荒野猎人》雪原里的格拉斯像一粒灰。',
      how: '给人物纪录片做章节开头：先给他工作生活的那片地（厂区、田、海岸线、楼群），再切进他的脸。观众得先知道他站在哪，才在乎他说什么。'
    },
    {
      cat: '景别', name: '远景', alias: ['LS', 'long shot'],
      def: '人物全身可见，环境仍占大半。看得清动作和走位，看不清微表情。',
      eg: '《牯岭街少年杀人事件》大量远景，人物始终被空间和制度包着。',
      how: '跟拍劳动过程时先给远景，把"他在做什么活儿"说清楚。手不入画、工序看不见，后面的口述就没有落脚点。'
    },
    {
      cat: '景别', name: '全景', alias: ['FS', 'full shot', '全身'],
      def: '人物从头到脚刚好撑满画面高度，环境退成背景。这是"身体的景别"——姿态、步态、肢体语言全在里面。',
      eg: '卓别林坚持用全景拍喜剧："悲剧是特写，喜剧是全景。"摔倒要看见全身才好笑。',
      how: '采访前后补一个全景的日常动作（收工具、走进屋、蹲下检查）。它是从环境切到脸的必经台阶，剪辑时极其好用。'
    },
    {
      cat: '景别', name: '中景', alias: ['MS', 'medium shot', '半身', '腰上'],
      def: '大约腰部以上，人物与背景各占一半。对话戏最常用、最中性的景别。',
      eg: '几乎所有新闻和访谈的标准机位都是中景：稳定、不侵犯、可以看很久。',
      how: '双机位访谈里 A 机中景当"安全画面"（全程可用），B 机近景抓情绪。中景是你的地板，不是天花板。'
    },
    {
      cat: '景别', name: '近景', alias: ['MCU', 'medium close-up', '胸上'],
      def: '胸口以上，头顶留一点空。看得清眼神和嘴角，还留一点肩膀撑住构图。',
      eg: '《美国工厂》里工人讲述被裁的段落，大多落在近景——够近能共情，又不至于逼视。',
      how: '访谈的主力景别。默认把人放在近景，等情绪起来再切特写。一开场就上特写，后面就没有牌可打了。'
    },
    {
      cat: '景别', name: '特写', alias: ['CU', 'close-up', '大头'],
      def: '一张脸或一个物件占满画面。观众被迫只看这一件事，别的都不存在。',
      eg: '《圣女贞德蒙难记》几乎全片特写，脸就是战场；《寄生虫》里那块山水石的特写，让物件承担叙事。',
      how: '特写要"挣来"：前面用中景铺够，等他停顿、吞咽、眼眶发红那一下再切。也别忘了手——老人的手常常比脸更会说话。'
    },
    {
      cat: '景别', name: '大特写', alias: ['ECU', 'extreme close-up', '超特写'],
      def: '只剩一只眼、一张嘴、一道疤、一个指甲缝。已经不是"看人"，而是"看质感"。',
      eg: '《瞬息全宇宙》用大特写切进眼球完成宇宙跳转；莱昂内的西部片靠眼睛的大特写把时间拉长。',
      how: '拿它当"证据"用：烫伤的疤、磨平的工牌、褪色照片上的编号。配他的画外音，一个大特写抵一整段解说。'
    },
    {
      cat: '景别', name: '过肩镜头', alias: ['OTS', 'over the shoulder', '过肩'],
      def: '从一方肩后拍另一方。前景那半个后脑勺不是废料，它是"关系"——观众永远站在某一边。',
      eg: '《社交网络》庭辩戏靠一连串过肩确立立场；《教父》的谈判戏把权力差直接写进构图。',
      how: '有两人对谈时（子女访问父母、师徒对话）过肩最有用：它证明这不是对着镜头背稿，而是真的在跟一个人说话。'
    },
    {
      cat: '景别', name: '双人镜头', alias: ['two shot', '双人'],
      def: '一个画面装下两个人。他们的距离、朝向、谁遮住谁，就是这段关系的图解。',
      eg: '《婚姻故事》用双人镜头维持"还在同一个画框里"，关系破裂时才切成单人正反打。',
      how: '拍夫妻、父子、师徒题材，先想清楚什么时候同框、什么时候切开。同框＝关系还在，切开＝各说各话。'
    },

    /* ---------------------------------------------------------- 运镜 */
    {
      cat: '运镜', name: '推镜头', alias: ['推', 'push in', 'dolly in', '推轨'],
      def: '摄影机整体向被摄物靠近。透视随之改变，背景关系在变——这是"人走过去了"。',
      eg: '《教父2》里对迈克尔的缓推，慢到你察觉不到，等你发现时他已经离你太近了。',
      how: '访谈里给一个"慢到看不出来"的推：两三分钟内从近景推到特写，用在他讲最关键那段。观众不会察觉技法，只会觉得越听越紧。'
    },
    {
      cat: '运镜', name: '拉镜头', alias: ['拉', 'pull back', 'dolly out'],
      def: '摄影机后退，环境一点点被交还给画面。常用来收尾、揭示、抽离。',
      eg: '《闪灵》多次用拉把人交还给巨大空间；很多纪录片结尾拉成远景，让人物回到人群里。',
      how: '段落收束时用拉：他说完最后一句，镜头缓缓退开，露出身后空掉的车间或老屋。不用解说，观众自己会得出结论。'
    },
    {
      cat: '运镜', name: '摇镜头', alias: ['摇', 'pan', 'tilt', '横摇', '俯仰摇'],
      def: '机位不动，机身左右（pan）或上下（tilt）转。相当于"人站着转头"，透视不变。',
      eg: '《银翼杀手2049》大量缓慢横摇扫过废墟交代规模；上摇常用来给建筑、纪念碑加压。',
      how: '拍工作环境用一个慢摇：从他的手摇到墙上的奖状。两样东西在同一个镜头里建立因果，比切两个镜头更有说服力。'
    },
    {
      cat: '运镜', name: '移镜头', alias: ['移', 'tracking', 'truck', '轨道', '横移'],
      def: '机位平行移动（左右或前后），走轨道、滑轨、稳定器。背景产生视差，空间的深度被"摸"出来。',
      eg: '《四百击》的横移跟随；《1917》整片靠移动把空间连成一条线。',
      how: '器材有限就用滑轨拍空镜横移：书桌上的物件、墙上的照片墙。有视差的空镜比固定空镜"贵"得多，剪辑时非常好用。'
    },
    {
      cat: '运镜', name: '跟镜头', alias: ['跟', 'follow', '跟拍'],
      def: '摄影机跟着人物运动，人物在画面里的位置基本不变。观众被绑在他身上。',
      eg: '《鸟人》的长跟拍；《大象》跟在少年背后穿过走廊，跟得越久越不安。',
      how: '"跟着他上工"的一段跟拍，是把观众变成同行者最快的方式。注意在行进方向前方留空间，别把人顶在画框边上。'
    },
    {
      cat: '运镜', name: '升降镜头', alias: ['升降', 'crane', 'jib', '摇臂'],
      def: '机位在垂直方向升或降，常配合摇。视角高度变了，观众与人物的权力关系也跟着变。',
      eg: '经典收尾：镜头从人物身上升起，把他留在越来越大的世界里。',
      how: '没摇臂也能做：手持从蹲姿慢慢起身，配合被摄物从手到脸。低成本升降的关键只有两条——稳，慢。'
    },
    {
      cat: '运镜', name: '手持', alias: ['handheld', '肩扛', '手持摄影'],
      def: '画面里有人的呼吸和步伐。轻微晃动＝在场感、纪实感；剧烈晃动＝失控、焦虑。',
      eg: '《谍影重重》用手持制造紧张；《四月三周两天》用克制的手持保持纪实距离。',
      how: '访谈别用手持（分散注意力、显廉价）；跟拍、现场、冲突用手持。同一部片里手持与固定的分工要一致，不能随机切换。'
    },
    {
      cat: '运镜', name: '变焦', alias: ['zoom', '推变焦', '拉焦'],
      def: '机位不动，只改焦距。画面像被"裁"过来，透视关系不变，背景压缩感变化。这是它和"推"最大的区别：推是人走过去，变焦是望远镜拧过去。',
      eg: '《迷魂记》的滑动变焦（dolly zoom）＝推轨＋反向变焦同时进行，透视被撕开，制造眩晕。',
      how: '记一句话：推＝进入，变焦＝窥视。突然的快变焦有强烈的"抓拍／偷看"味道（早期直接电影常用）；不想要这个味道，就别拿变焦替代推。'
    },
    {
      cat: '运镜', name: '环绕', alias: ['arc', 'orbit', '绕拍', '弧形运动'],
      def: '摄影机绕着被摄物走弧线。背景不断更换，人物被"雕塑化"，也常暗示天旋地转或被围观。',
      eg: '《黑客帝国》的子弹时间是环绕的极端形态；大量演唱会与人物短片用半圈环绕做高潮。',
      how: '人物纪录片慎用整圈环绕（太像广告）。用 30° 以内的小弧线代替死板固定，既有呼吸又不抢戏。'
    },

    /* ------------------------------------------------- 调度与构图 */
    {
      cat: '调度与构图', name: '机位高度（俯／平／仰）', alias: ['俯拍', '仰拍', '平视', '机位高度', 'camera height'],
      def: '镜头高于人眼＝俯，观众俯视他；等高＝平，平等对话；低于视线＝仰，他被抬高。高度直接写进权力关系。',
      eg: '《公民凯恩》反复用低机位仰拍凯恩，把他放大成不可撼动的形象，最后再把他放回空荡的大厅。',
      how: '访谈默认把镜头架在受访者眼睛高度——尊重是拍出来的。要说他被制度压着，可以稍俯；要说他撑起一个家，可以稍仰。幅度小一点，观众不会察觉但会感觉到。'
    },
    {
      cat: '调度与构图', name: '轴线与 180 度规则', alias: ['轴线', '越轴', '180度规则', 'crossing the line'],
      def: '两人之间有一条假想连线，机位保持在同一侧，观众才不会搞混谁看着谁。跨到另一侧叫"越轴"，人物会突然"调头"。',
      eg: '《闪灵》故意越轴制造错乱；绝大多数正反打访谈严格守轴，保证视线能对上。',
      how: '双人访谈先在心里画轴线：A 机在轴左，B 机也在轴左。剪辑时如果两个镜头里人都朝同一方向看，多半越轴了——插一个正面中间镜头就能救回来。'
    },
    {
      cat: '调度与构图', name: '三分法与留白', alias: ['三分法', '井字构图', '留白', 'rule of thirds', '负空间', 'look room'],
      def: '画面横竖各三等分，主体放在线上或交点；人物视线方向多留一点空间（look room），画面才不憋。',
      eg: '《她》用大量留白把主角的孤独写进画框；访谈里视线侧的空白，就是"他在对谁说话"的位置。',
      how: '把人放在画面三分之一侧，留白一侧正好放采访者或字幕。留白方向不要中途改变，除非你就是想制造断裂。'
    },
    {
      cat: '调度与构图', name: '前景遮挡', alias: ['前景', 'foreground', '框中框', '遮挡'],
      def: '在镜头与人物之间放东西——门框、栏杆、树叶、玻璃、路人。既加层次，又制造"我们在偷看"或"他被困住"的意味。',
      eg: '《寄生虫》用扶手、玻璃、门框反复分割阶级；《美国往事》隔着窗看人。',
      how: '拍他的工作空间时，故意从机器缝、货架缝里看过去。同一个人拍一个干净背景的机位＋一个前景遮挡的机位，剪在一起就有"表面／内里"两层。'
    },
    {
      cat: '调度与构图', name: '纵深调度', alias: ['纵深', '深焦', 'deep staging', '前后景关系'],
      def: '把信息分布在前、中、后不同景深层上，观众在一个镜头里读到多条线索，不靠剪辑。',
      eg: '《公民凯恩》著名的深焦：前景签字、中景母亲、窗外雪地里玩耍的孩子，三层同时叙事；《寄生虫》的楼梯戏也是纵深的空间政治。',
      how: '采访别让人贴墙坐。让他离背景远一点，后面留一层可读的信息（工具、家人照片、正在干活的同事），一个镜头同时说人和处境。'
    },
    {
      cat: '调度与构图', name: '视线方向', alias: ['视线', 'eyeline', '视线匹配', '看向'],
      def: '人物看向哪里，观众就期待下一个镜头是什么。视线是剪辑的钩子；对不上，空间就散了。',
      eg: '库里肖夫实验的本质就是"视线＋接续镜头"生成含义；小津反其道而行，让人物对着镜头说话。',
      how: '拍完他讲某样东西，一定补一个他看向的方向的镜头（他的手、窗外、那张照片）。这个"视线—对象"组合，能把一段口述变成一个段落。'
    },

    /* ---------------------------------------------------------- 光色 */
    {
      cat: '光色', name: '伦勃朗光', alias: ['Rembrandt', '三角光', '伦勃朗布光'],
      def: '主光从侧上方约 45° 打来，暗侧脸颊出现一个倒三角形亮块。经典、立体、有古典肖像感。',
      eg: '《教父》里戈登·威利斯的低照度肖像式布光；无数人物纪录片的标准访谈打法。',
      how: '一盏柔光放在受访者斜前方 45°、略高于眼睛，另一侧用白板补一点反光压反差。零基础想把访谈拍"像样"，先把这一盏灯练熟。'
    },
    {
      cat: '光色', name: '侧逆光', alias: ['逆光', '轮廓光', 'rim light', '边缘光'],
      def: '光从侧后方来，勾出一条发亮的轮廓线，把人从背景里剥出来。暗部大，情绪含蓄。',
      eg: '《银翼杀手》系列大量侧逆＋烟雾；纪录片里"窗边侧逆"是最省钱的高级感。',
      how: '让受访者侧对窗户坐，窗光当侧逆，正面补一块反光板。别把脸补平——留下的那半张阴影，正是他没说出口的部分。'
    },
    {
      cat: '光色', name: '硬光 / 柔光', alias: ['hard light', 'soft light', '光质', '硬柔'],
      def: '光源相对被摄物越小越硬：影子边缘锐利、皮肤纹理暴露、情绪紧张；越大越柔：过渡平滑、皮肤干净、情绪温和。',
      eg: '《瞬息全宇宙》税务局段落用硬冷顶光制造压迫；文艺片的人物特写多用大柔光。',
      how: '一块描图纸或白布挡在灯前，硬光立刻变柔——最便宜的改质手段。但拍苦难题材别一味柔，硬光的粗粝有时才是真话。'
    },
    {
      cat: '光色', name: '色温冷暖', alias: ['色温', '冷暖', '白平衡', '5600K', '3200K'],
      def: '日光约 5600K 偏蓝，钨丝灯约 3200K 偏橙。冷＝疏离、清醒、夜；暖＝亲密、回忆、家。混色（暖人物＋冷背景）能在一个画面里放两种情绪。',
      eg: '《爱乐之城》靠冷暖切换标记梦与现实；《瞬息全宇宙》用色彩区分宇宙。',
      how: '访谈务必手动固定白平衡，别用自动（人一动颜色就漂）。回忆段落略压暖、现实段落略压冷，是纪录片里最容易被读懂的一组信号。'
    },
    {
      cat: '光色', name: '明暗对比（高调／低调）', alias: ['高调', '低调', 'high key', 'low key', '反差'],
      def: '高调＝整体明亮、反差小、阴影少，轻盈或"无处可躲"；低调＝大面积暗部、反差大，压抑、神秘、有重量。',
      eg: '《辛德勒的名单》用黑白低调压出历史重量；综艺和广告则偏高调。',
      how: '同一位受访者，讲日常用高调、讲创伤用低调，观众会觉得"这两段本来就不一样"。做法很简单：把补光关掉，让暗部真的暗下去。'
    },
    {
      cat: '光色', name: '实用光源', alias: ['practical', '实用光', '场景光', '动机光'],
      def: '出现在画面里、看得见的光源——台灯、路灯、屏幕、火、冰箱。它让打光有"理由"，也让空间可信。',
      eg: '《爱尔兰人》《毒枭》大量用台灯与街灯做动机光；纪录片里显示器的蓝光是最真实的加班注脚。',
      how: '拍夜戏或室内，先在画面里找一盏灯当借口，其余布光顺着它的方向来。观众不懂布光，但一眼能看出"光不合理"。'
    },

    /* ---------------------------------------------------------- 声音 */
    {
      cat: '声音', name: '同期声', alias: ['同期', '现场声', 'sync sound', '原声'],
      def: '拍摄现场同步录到的声音：说话、脚步、机器、风。它是纪实感的地基，缺了它画面立刻变成广告。',
      eg: '直接电影传统几乎完全依赖同期声，声音一"干净"过头，真实感反而没了。',
      how: '领夹麦贴人＋一支枪麦收环境，永远双轨。宁可画面差一点也别让同期声差——观众能忍糊画面，忍不了糊声音。'
    },
    {
      cat: '声音', name: '环境声底', alias: ['atmos', 'room tone', '环境声', '空气声', '底噪'],
      def: '每个空间独有的持续背景声。它把不同镜头"焊"在同一个空间里；没有它，硬切会"啪"地断气。',
      eg: '任何专业成片的对白下面都铺着 atmos，断掉的一瞬间观众本能地觉得"假"。',
      how: '每换一个场地，单独录 30 秒空场环境声（大家安静别动）。后期补口误、修呼吸、接段落时，这 30 秒能救命。'
    },
    {
      cat: '声音', name: '声画同步', alias: ['同步', 'sync', '声画合一'],
      def: '声音和画面指向同一件事：他说话我们看见他嘴动，关门我们听见门响。最基础，也最容易平庸。',
      eg: '新闻报道的默认形态。用得好是实感，用得多是流水账。',
      how: '访谈不必全程同步。让他的声音继续、画面切到他的手或工位——从同步走向不同步，段落才开始有电影感。'
    },
    {
      cat: '声音', name: '声画对位', alias: ['对位', 'counterpoint', '反差配乐'],
      def: '声音与画面说着不同甚至相反的事，两者相撞产生第三层意思。',
      eg: '《现代启示录》直升机空袭配《女武神的骑行》；《发条橙》暴力配《雨中曲》。',
      how: '纪录片里最有力的一种对位：欢快的年会录音，配着空掉的厂房画面。别解释，让观众自己完成那一下减法。'
    },
    {
      cat: '声音', name: '声画错位', alias: ['错位', '非同步', 'asynchronous', '时空错位'],
      def: '声音属于另一个时间或空间——回忆里的口令、隔壁房间的争吵、未来的对话。声音把画面撬开一道时间裂缝。',
      eg: '《广岛之恋》靠声音在时态间穿梭；《敦刻尔克》的谢泼德音调（无限升高的错觉音）让紧张感永远不落地。',
      how: '把他描述往事的那段声音，贴到今天他走过老地方的画面上。这是纪录片最省钱也最有效的时空缝合术。'
    },
    {
      cat: '声音', name: '声音先入（J-cut）', alias: ['J-cut', 'J cut', '声先入', '声音先行'],
      def: '下一场的声音先进来，画面后到。耳朵先跨过去，眼睛跟着走，转场变柔顺且有牵引力。',
      eg: '成熟对白剪辑几乎全在用；《社交网络》段落之间靠声音提前抢入推动节奏。',
      how: '段落之间不要"画面切、声音也切"。让下一段的环境声或人声提前 0.5–1 秒进来，成片立刻从"素材串联"变成"作品"。'
    },
    {
      cat: '声音', name: '声音延续（L-cut）', alias: ['L-cut', 'L cut', '声延续', '声音拖尾'],
      def: '画面已经切走，上一场的声音还留一会儿。用于余味、犹豫、不舍。',
      eg: '谈话戏常见：切到听的人的脸，说话者的声音还在继续，重点从"说"转到"听"。',
      how: '他说完一句重话，画面切到他的手或窗外，但让那句话的尾音和呼吸再留一秒。留出来的这一秒，是给观众消化的时间。'
    },
    {
      cat: '声音', name: '静默与留白', alias: ['静默', '留白', 'silence', '无声'],
      def: '有意识地把声音拿掉。突然的静默是最响的声音，观众会在静默里补上自己的情绪。',
      eg: '《拯救大兵瑞恩》抢滩时的耳鸣静音；《寄生虫》暴雨之后的一段安静，把落差放大。',
      how: '他讲到最难的地方停住了——别急着补音乐，也别把这三秒剪掉。让音乐提前退出，静默单独存在，这通常是全片最有力的三秒。'
    },
    {
      cat: '声音', name: '音乐进出点', alias: ['music cue', '配乐进出', '音乐点', '入点出点'],
      def: '音乐"何时进、何时出"比"用什么音乐"更重要。进早了抢戏，进晚了没托住；干净地出是水平，一律淡出是偷懒。',
      eg: '好配乐常在台词停顿处进入、在下一个动作开始前退出，观众记住的是情绪不是旋律。',
      how: '给自己定一条规矩：音乐永远不在人说话时起。让它在他停顿的第二秒进，在下一段同期声起来之前退。"哪儿都在响"的音乐等于没有音乐。'
    },

    /* ---------------------------------------------------------- 剪辑 */
    {
      cat: '剪辑', name: '硬切', alias: ['cut', '直切', '切'],
      def: '两个镜头直接相接，零过渡。最基本、最有力，也最常被小看——90% 的镜头都该是硬切。',
      eg: '《疯狂的麦克斯4》全片高密度硬切；剪得越好，观众越察觉不到切过。',
      how: '默认用硬切。想加叠化之前先问一句："这里真的是时间流逝或心理关联吗？"不是的话，硬切。'
    },
    {
      cat: '剪辑', name: '叠化', alias: ['dissolve', '溶', '化', '交叠'],
      def: '前后画面重叠过渡。语义只有两种：时间过去了，或者两件事有心理联系。',
      eg: '《现代启示录》开场把丛林与人脸叠在一起，直接说明主角脑子里的战争。',
      how: '用它标记年代跳转（老照片→今天的他）。注意时长：0.5 秒几乎无感，2 秒是明确的抒情。别全片都用一个长度。'
    },
    {
      cat: '剪辑', name: '匹配剪辑', alias: ['match cut', '匹配', '形状匹配', '动作匹配'],
      def: '用形状、动作、构图或声音的相似，把两个不相干的时空焊在一起。',
      eg: '《2001太空漫游》骨头抛向空中切成太空船——影史最著名的匹配剪辑。',
      how: '拍摄时就要埋：老照片里他握扳手的姿势，今天他握茶杯的姿势，构图对齐。剪起来一秒钟说完二十年。'
    },
    {
      cat: '剪辑', name: '跳切', alias: ['jump cut', '跳接'],
      def: '同机位同景别之间被切掉一段，人物"跳"了一下。传统上算错误，如今是风格：焦躁、压缩时间、故意暴露剪辑本身。',
      eg: '《精疲力尽》让跳切成为语言；《瞬息全宇宙》用高频跳切制造混乱与喜感；口播 Vlog 全靠它。',
      how: '访谈删废话必然产生跳切。要么大方保留、做成风格，要么用 B-roll（他的手、空镜）盖住。最忌讳偷偷做一个不干净的画面微位移。'
    },
    {
      cat: '剪辑', name: '动作剪辑点', alias: ['cutting on action', '动接动', '动作剪辑'],
      def: '在动作进行中切换，让下一个镜头接着把动作完成。注意力被动作牵着走，切点就藏起来了。',
      eg: '经典好莱坞连续性剪辑的基石：开门在 A 镜起手、B 镜完成。',
      how: '同一个动作多拍几个景别（点火、倒水、上锁），后期就能动接动。这是让业余片"变顺"最快的一招。'
    },
    {
      cat: '剪辑', name: '反应镜头', alias: ['reaction', '反应镜头', '听者镜头'],
      def: '切到"听的人"而不是"说的人"。情绪常常不在说话者脸上，而在旁边那张脸上。',
      eg: '《十二怒汉》靠反应镜头搭起整场心理战；访谈节目的力量常在家属沉默的那几秒。',
      how: '双人对谈务必留一台机器对着听的人。单人访谈没有听者，就拍"他讲完之后不说话的十秒"——剪进去，比任何解说都重。'
    },
    {
      cat: '剪辑', name: '蒙太奇与长镜头', alias: ['蒙太奇', '长镜头', 'montage', 'long take'],
      def: '两种造义方式：蒙太奇靠切开与并置，意义由剪辑产生；长镜头靠时间与调度，意义在真实时间里自己发生。',
      eg: '《战舰波将金号》的敖德萨阶梯是蒙太奇教科书；《四百击》结尾与《赎罪》敦刻尔克长镜头则把意义交给时间。',
      how: '问自己一句：这段的力量来自"关系"还是"过程"？劳动、等待、告别，用长镜头别切；对比、积累、时间跨度，用蒙太奇。别为了炫技选长镜头。'
    }
  ];

  function findTerm(kw) {
    if (!kw) return null;
    const k = String(kw).trim().toLowerCase();
    if (!k) return null;
    let t = TERMS.filter(function (x) { return x.name.toLowerCase() === k; })[0];
    if (t) return t;
    t = TERMS.filter(function (x) {
      return x.alias.some(function (a) { return a.toLowerCase() === k; });
    })[0];
    if (t) return t;
    return TERMS.filter(function (x) { return x.name.toLowerCase().indexOf(k) >= 0; })[0] || null;
  }

  function matchTerm(t, kw) {
    if (!kw) return true;
    const k = kw.trim().toLowerCase();
    if (!k) return true;
    return (t.name + ' ' + t.cat + ' ' + t.alias.join(' ') + ' ' + t.def).toLowerCase().indexOf(k) >= 0;
  }

  /** R-027 打开术语库；keyword 可为术语名、别名或分类名 */
  function terms(keyword) {
    const kwHit = findTerm(keyword);
    let sel = kwHit || null;
    let kw = kwHit ? '' : (keyword || '');   // 命中具体术语就不过滤列表，方便继续浏览

    const nav = el('div', { class: 'term-nav' });
    const detail = el('div', { class: 'term-body' });
    const search = el('input', {
      class: 'mini-input',
      placeholder: '搜术语 / 别名，例如：推、变焦、J-cut、越轴、伦勃朗',
      onkeydown: function (e) { e.stopPropagation(); },   // 别让主程序快捷键截走输入
      oninput: function () { renderNav(search.value); renderBody(); }
    });
    search.value = kw;

    function renderNav(k) {
      nav.innerHTML = '';
      const list = TERMS.filter(function (t) { return matchTerm(t, k); });
      if (!list.length) {
        nav.appendChild(el('div', { class: 'tn-g', text: '没找到，换个词试试' }));
        sel = null;
        return list;
      }
      if (!sel || list.indexOf(sel) < 0) sel = list[0];
      let cat = null;
      list.forEach(function (t) {
        if (t.cat !== cat) { cat = t.cat; nav.appendChild(el('div', { class: 'tn-g', text: cat })); }
        nav.appendChild(el('div', {
          class: 'tn' + (sel === t ? ' on' : ''),
          text: t.name,
          onclick: function () { sel = t; renderNav(search.value); renderBody(); }
        }));
      });
      return list;
    }

    function renderBody() {
      detail.innerHTML = '';
      if (!sel) {
        detail.appendChild(el('div', { class: 't-def', text: '换个关键词试试：景别、运镜、光、声音、剪辑，或者直接搜「跳切」「L-cut」。' }));
        return;
      }
      detail.appendChild(el('h4', { text: sel.name }));
      const metaTxt = sel.cat + (sel.alias.length ? ' · ' + sel.alias.join(' / ') : '');
      detail.appendChild(el('div', { style: 'color:var(--txt3);font-size:11px;margin-bottom:8px', text: metaTxt }));
      detail.appendChild(el('div', { class: 't-def', text: sel.def }));
      detail.appendChild(el('div', { class: 't-eg' }, [
        el('b', { text: '经典片例　' }), document.createTextNode(sel.eg)
      ]));
      detail.appendChild(el('div', { class: 't-how' }, [
        el('b', { text: '怎么用在你的片子里　' }), document.createTextNode(sel.how)
      ]));
      detail.scrollTop = 0;
    }

    const body = el('div');
    body.appendChild(el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:10px' }, [
      search,
      el('span', { class: 'badge', text: '共 ' + TERMS.length + ' 条' })
    ]));
    const layout = el('div', { class: 'term-layout' }, [nav, detail]);
    body.appendChild(layout);
    body.appendChild(el('div', {
      style: 'margin-top:10px;color:var(--txt3);font-size:11px;line-height:1.7',
      text: '术语是为了让你看得更准，不是为了在文案里堆名词。写分析时先说人话，再补术语。'
    }));

    renderNav(kw);
    renderBody();

    const ft = el('div', { style: 'display:flex;gap:7px' }, [
      el('button', { class: 'btn', text: '快捷键速查', onclick: function () { shortcuts(); } }),
      el('button', { class: 'btn accent', text: '关闭', onclick: closeModal })
    ]);
    modal('术语速查 · 示例镜头库', body, ft);
    setTimeout(function () { try { search.focus(); } catch (e) { } }, 30);
  }

  /** 供其它模块点击术语时跳转 */
  /** 按名/别名查单条术语，返回术语对象或 null（不弹窗）。要弹窗请用 terms(name) */
  function term(name) { return findTerm(name); }

  /* =====================================================================
   * R-028 AI 初填维度（本地启发式草稿，绝不联网）
   * ===================================================================== */
  const SIZE_ORDER = ['大远景', '远景', '全景', '中景', '近景', '特写', '大特写'];

  function facts(shot) {
    const shots = LP.state.shots();
    const n = shots.length;
    let i = -1;
    for (let x = 0; x < n; x++) { if (shots[x].id === shot.id) { i = x; break; } }
    const d = Math.max(0, (shot.out || 0) - (shot.in || 0));
    const prev = i > 0 ? shots[i - 1] : null;
    const next = (i >= 0 && i < n - 1) ? shots[i + 1] : null;
    const pd = prev ? Math.max(0, prev.out - prev.in) : 0;
    const nd = next ? Math.max(0, next.out - next.in) : 0;
    const vr = LP.state.project.videoRef;
    const total = (vr && vr.duration) || (n ? shots[n - 1].out : 0);
    const ratio = total > 0 ? (shot.in / total) : (n > 1 ? (Math.max(i, 0) / (n - 1)) : 0);
    const posName = ratio < 0.2 ? '开场' : (ratio > 0.8 ? '结尾' : '中段');

    let rhythm = '节奏与上一镜接近', rhythmKey = 'same';
    if (!prev) { rhythm = '全片第一镜，没有上一镜可比'; rhythmKey = 'first'; }
    else if (d < pd * 0.6) { rhythm = '比上一镜明显短，节奏在加快'; rhythmKey = 'faster'; }
    else if (d > pd * 1.6) { rhythm = '比上一镜明显长，节奏在放慢'; rhythmKey = 'slower'; }

    const lenKey = d < 1.5 ? 'short' : (d > 15 ? 'long' : (d > 6 ? 'midlong' : 'mid'));
    return {
      i: i, n: n, d: d, prev: prev, next: next, pd: pd, nd: nd,
      posName: posName, rhythm: rhythm, rhythmKey: rhythmKey, lenKey: lenKey,
      hasThumb: !!shot.thumb
    };
  }

  /** 生成建议行：{key, name, value, reason} —— 只用时长/位置/节奏/邻居这些本地事实 */
  function draft(shot) {
    const f = facts(shot);
    const D = U.dur(f.d);
    const rows = [];
    const add = function (key, value) {
      const fd = LP.FIELD_MAP[key];
      if (fd) rows.push({ key: key, name: fd.name, value: value, type: fd.type });
    };

    /* 1 递进关系 */
    let s1;
    if (f.prev && f.prev.size && shot.size) {
      const a = SIZE_ORDER.indexOf(f.prev.size), b = SIZE_ORDER.indexOf(shot.size);
      const rel = (a < 0 || b < 0 || a === b) ? '同级平移' : (b > a ? '逼近' : '抽离');
      s1 = '上一镜「' + f.prev.size + '」→ 本镜「' + shot.size + '」，属于' + rel + '。补一句：为什么在这里做这个变化？';
    } else if (f.prev && f.prev.size) {
      s1 = '上一镜是「' + f.prev.size + '」。先给本镜选景别，再写"从 ' + f.prev.size + ' 到 ? 是逼近还是抽离"。';
    } else if (!f.prev) {
      s1 = '全片第一镜（' + f.posName + '），景别通常承担交代任务。先定它是"先给环境"还是"先怼脸"，后面的递进都从这里起算。';
    } else {
      s1 = '先填景别，再回来写关系：远→近＝逼近，近→远＝抽离，同级＝平移。';
    }
    add('sizeNote', s1);

    /* 2 运镜意图 */
    let s2;
    if (f.lenKey === 'short') {
      s2 = '只有 ' + D + '，镜头几乎没时间走动作。先确认它是"固定的强调／插入镜头"，还是一段运镜被切下来的一小截。若是固定，写清楚固定是为了让观众盯住什么。';
    } else if (f.lenKey === 'long') {
      s2 = D + ' 的长镜头，注意力不可能靠静止维持——找找是不是有缓推、跟移或重新构图。写"镜头在这段时间里，把观众的注意力从 A 带到了 B"。';
    } else {
      s2 = '写"这样动 → 观众感到什么"，别只描述动作。推＝逼近情绪，拉＝抽离旁观，跟＝与人物同呼吸，固定＝让观众自己看。';
    }
    add('moveWhy', s2);

    /* 3 场面调度 */
    let s3;
    if (f.lenKey === 'long') {
      s3 = '长镜头基本靠调度撑住：谁进画、谁出画、前后景怎么换位。建议按时间顺序写，例如"0–3 秒 … 3–8 秒 …"。';
    } else if (f.lenKey === 'short') {
      s3 = '快切镜头看两件事就够：主体落在画面第几分区、有没有前景遮挡。别硬写。';
    } else {
      s3 = '三件事：机位高度（俯／平／仰）＋ 主体在画面哪一区 ＋ 前后景各有什么。顺带一句：留白留在了哪一侧？';
    }
    add('blocking', s3);

    /* 4 光色 */
    const s4 = '按三件事写：光从哪来（正／侧／侧逆／顶）、冷还是暖、暗部有多暗。'
      + (f.hasThumb ? '本镜已有关键帧，对着缩略图数一遍更准。' : '建议先「抓帧」再写光色，凭回忆容易失真。');
    add('light', s4);

    /* 5 声音设计 */
    const s5 = '闭眼再放一遍这 ' + D + '：同期声／环境声底／音乐／静默各占多少？'
      + (f.lenKey === 'short' ? '这么短的镜头，声音多半是跨过它连续的——重点看它有没有打断声音。'
        : '注意音乐或环境声是否跨过了这个切点：跨过去，说明段落还没结束。')
      + (f.posName === '结尾' ? '结尾段落，特别留意音乐的退出点。' : '');
    add('sound', s5);

    /* 6 剪辑点 */
    let s6 = '本镜 ' + D + (f.prev ? '，上一镜 ' + U.dur(f.pd) : '') + '——' + f.rhythm + '。'
      + '写清楚"切在什么动作或什么声音上"，以及早切／晚切带来的感觉差。';
    if (f.i === 0) s6 += '这是全片第一个切点，它决定观众用什么方式进入。';
    if (f.next && f.nd < f.d * 0.5) s6 += '下一镜明显更短，这里可能是一串加速的起点。';
    add('cut', s6);

    /* 7 七问分析 */
    add('sevenQ', '一句话结论 ＋ 一句话理由：这一镜让观众离人物更近了，还是更远了？'
      + '（可用事实：位置 ' + f.posName + '、时长 ' + D + '、' + f.rhythm + '）');

    /* 保守默认（选项类唯一敢给的一个） */
    rows.push({ key: 'cutType', name: LP.FIELD_MAP.cutType.name, value: '硬切', type: 'select', guess: true });

    return { f: f, rows: rows };
  }

  /** R-028 打开"AI 初填建议"面板 */
  function aiFill(shot) {
    if (!shot) { toast('先在时间线或片段列表里选中一个镜头，再点「AI 初填」'); return; }
    const res = draft(shot);
    const f = res.f;
    const body = el('div');

    /* 免责说明（必须在最上面） */
    const warn = el('div', { class: 'mode', style: 'cursor:default' });
    warn.appendChild(el('div', { class: 'm-t' }, [
      el('span', { text: '⚠ 本地启发式草稿' }),
      el('span', { class: 'badge risk', text: '不联网' })
    ]));
    warn.appendChild(el('div', {
      class: 'm-d',
      text: '这是基于时长／位置／节奏的本地启发式草稿，不是内容理解。它只负责让你有个开头，判断必须你自己下。'
        + '景别、运镜、声画关系这类必须看画面才能定的选项，它不会替你猜。'
    }));
    body.appendChild(warn);

    const guide = el('div', { class: 'mode', style: 'cursor:default' });
    guide.appendChild(el('div', { class: 'm-t', text: '想要真正的内容分析？' }));
    guide.appendChild(el('div', {
      class: 'm-d',
      text: '到底部「素材包 / 报告」页，把维度＋文字＋转写导出成结构化素材包，交给 AI 出完整报告——质量最高，而且素材依然不出机。'
    }));
    body.appendChild(guide);

    /* 本地事实 */
    const stats = el('div', { class: 'stat-grid', style: 'margin:10px 0 12px' });
    [
      { v: U.dur(f.d), l: '本镜时长' },
      { v: (f.i >= 0 ? (f.i + 1) : '?') + ' / ' + f.n, l: '第几镜' },
      { v: f.posName, l: '在全片位置' },
      { v: f.rhythmKey === 'faster' ? '加快' : (f.rhythmKey === 'slower' ? '放慢' : (f.rhythmKey === 'first' ? '起点' : '持平')), l: '相对节奏' },
      { v: f.hasThumb ? '有' : '无', l: '关键帧' }
    ].forEach(function (s) {
      stats.appendChild(el('div', { class: 'stat' }, [
        el('div', { class: 'sv', text: String(s.v) }),
        el('div', { class: 'sl', text: s.l })
      ]));
    });
    body.appendChild(stats);

    /* 逐字段建议行 */
    const rows = [];
    res.rows.forEach(function (r) {
      const cur = shot[r.key];
      const isEmpty = Array.isArray(cur) ? cur.length === 0 : !String(cur == null ? '' : cur).trim();
      const cb = el('input', { type: 'checkbox' });
      cb.checked = isEmpty && !r.guess;      // 空字段默认勾；纯猜测项默认不勾

      const wrap = el('div', { class: 'field' });
      wrap.appendChild(el('div', { class: 'field-lb' }, [
        el('label', { class: 'chk' }, [cb, el('b', { text: r.name })]),
        el('span', { class: 'ftype', text: isEmpty ? '空' : '已有内容' }),
        r.guess ? el('span', { class: 'ftype', text: '保守默认·不确定别勾' }) : el('span', {})
      ]));
      wrap.appendChild(el('div', {
        style: 'font-size:12px;color:var(--txt2);line-height:1.7;padding-left:2px',
        text: r.value
      }));
      body.appendChild(wrap);
      rows.push({ key: r.key, value: r.value, cb: cb, isEmpty: isEmpty });
    });

    /* 底栏 */
    const over = el('input', { type: 'checkbox' });
    const ft = el('div', { style: 'display:flex;gap:7px;align-items:center;width:100%' });
    ft.appendChild(el('label', { class: 'chk' }, [over, el('span', { text: '覆盖已有内容' })]));
    ft.appendChild(el('span', { class: 'grow' }));
    ft.appendChild(el('button', {
      class: 'btn sm', text: '全选',
      onclick: function () { rows.forEach(function (r) { r.cb.checked = true; }); }
    }));
    ft.appendChild(el('button', {
      class: 'btn sm', text: '全不选',
      onclick: function () { rows.forEach(function (r) { r.cb.checked = false; }); }
    }));
    ft.appendChild(el('button', { class: 'btn', text: '取消', onclick: closeModal }));
    ft.appendChild(el('button', { class: 'btn accent', text: '应用勾选项', onclick: apply }));

    function apply() {
      const live = LP.state.shot(shot.id) || shot;
      const targets = rows.filter(function (r) {
        if (!r.cb.checked) return false;
        const cur = live[r.key];
        const empty = Array.isArray(cur) ? cur.length === 0 : !String(cur == null ? '' : cur).trim();
        return empty || over.checked;
      });
      if (!targets.length) {
        toast('没有可写入的字段：勾选项都已有内容，可以先勾「覆盖已有内容」');
        return;
      }
      LP.state.push();                                   // 变更前压栈
      targets.forEach(function (r) { live[r.key] = r.value; });
      LP.state.commit('AI 初填');                        // 落盘 + 广播
      LP.state.select(LP.state.selection.shotIds.slice(), LP.state.selection.groupId); // 让检查器刷新
      closeModal();
      toast('已填入 ' + targets.length + ' 个字段草稿，记得改成你自己的话', 'ok');
    }

    modal('AI 初填维度 · 本地草稿', body, ft);
  }

  /* =====================================================================
   * 首次使用引导
   * ===================================================================== */
  function welcome(force) {
    if (!force && lsGet(WELCOME_KEY)) return false;

    const body = el('div');
    body.appendChild(el('div', {
      style: 'color:var(--txt2);font-size:12.5px;line-height:1.8;margin-bottom:12px',
      text: '把一部片子拆成一个个镜头，逐镜回答"它为什么这么拍"。四步就能跑完一遍，全程在你自己的电脑上，视频不上传、不联网。'
    }));

    [
      ['① 导入视频（素材不出机）', '点顶栏「导入视频」，或把文件直接拖进左边的媒体池。视频只在本机浏览器里打开，工程自动存在本地，关掉页面数据还在。'],
      ['② 切出镜头', '点「自动切分」先切一版，再手动精修：B 刀片在时间线上点一下就切开，⌘/Ctrl+B 在播放头处拆分；也可以用 I / O 打点后点「+ 建片段」。相邻片段选中按 G 可以并成段落组。'],
      ['③ 逐镜填七维度 ＋ 写分析记录', '选中片段，在右侧检查器按 景别／运镜／调度／光色／声音／剪辑点／七问 依次填。不知道写什么，就点字段旁边的「?」看提示卡，或打开顶栏「术语库」查定义和经典片例。左边「分析记录」可以像 Notion 一样写长文、插语音。'],
      ['④ 导出素材包，让 AI 出报告', '到底部「素材包 / 报告」页，一键生成结构化文本包，复制给 AI 出完整分析。默认不调任何云端接口——这是隐私红线，也是这个工具的前提。']
    ].forEach(function (s) {
      const m = el('div', { class: 'mode', style: 'cursor:default' });
      m.appendChild(el('div', { class: 'm-t', text: s[0] }));
      m.appendChild(el('div', { class: 'm-d', text: s[1] }));
      body.appendChild(m);
    });

    body.appendChild(el('div', {
      style: 'margin-top:12px;color:var(--txt3);font-size:11.5px;line-height:1.7',
      text: '一句话原则：字段写结论，记录写论证。填不出来就先看提示卡，别空着也别硬编。'
    }));

    const ft = el('div', { style: 'display:flex;gap:7px' }, [
      el('button', { class: 'btn', text: '先看快捷键', onclick: function () { lsSet(WELCOME_KEY, '1'); shortcuts(); } }),
      el('button', { class: 'btn', text: '打开术语库', onclick: function () { lsSet(WELCOME_KEY, '1'); terms(); } }),
      el('button', { class: 'btn accent', text: '开始拉片', onclick: function () { lsSet(WELCOME_KEY, '1'); closeModal(); } })
    ]);
    /* Esc / 点遮罩关闭也算看过，不再反复打扰 */
    modal('欢迎来到拉片台', body, ft, function () { lsSet(WELCOME_KEY, '1'); });
    return true;
  }

  /* =====================================================================
   * init：按钮绑定（`?` 由主程序统一的快捷键处理调用 shortcuts()）
   * ===================================================================== */
  function init() {
    const bh = $('#btnHelp');
    if (bh) bh.addEventListener('click', function () { shortcuts(); });

    const bg = $('#btnGuide');
    if (bg) bg.addEventListener('click', function () { terms(); });

    const ba = $('#btnAiFill');
    if (ba) ba.addEventListener('click', function () {
      const s = LP.state.current();
      if (!s) { toast('先选中一个镜头片段，再点「AI 初填」'); return; }
      aiFill(s);
    });
  }

  return {
    init: init,
    attachHint: attachHint,
    shortcuts: shortcuts,
    terms: terms,
    term: term,
    aiFill: aiFill,
    welcome: welcome
  };
})();
