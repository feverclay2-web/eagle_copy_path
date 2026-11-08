/*
 * 复制 Eagle 路径 — Inspector 面板（右侧检查器）
 * 选中图片/视频时显示；若 Eagle 保留了面板，选中文件夹时同样可用。
 */
(function () {
  'use strict';

  if (!window.ECP) { console.error('[eagle-copy-path] core.js 未加载'); return; }
  var ECP = window.ECP;
  var cfg = ECP.loadCfg();
  var COPY_LABEL = '复制 Eagle 路径';

  var el = {};
  var inited = false;
  var st = {
    items: [],
    folders: [],
    selId: null,
    idx: null,
    sig: '',
    manualPick: false,
    activeFolder: 0,
    busy: false,
    timer: null
  };

  // ---------- 界面 ----------
  function grab() {
    ['title', 'gear', 'preview', 'folderPick', 'copy', 'status', 'settings', 'sep', 'withName',
      'withExt', 'sample', 'close'].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = kind || '';
    el.status.title = text;
  }

  function sampleText() {
    var chain = ['根目录', '子目录'].join(cfg.sep);
    var name = '素材' + (cfg.withExt ? '.jpg' : '');
    return '文件    ' + (cfg.withName ? chain + cfg.sep + name : chain)
      + '\n文件夹  ' + chain;
  }

  function syncSettingsUI() {
    el.sep.value = cfg.sep;
    el.withName.checked = !!cfg.withName;
    el.withExt.checked = !!cfg.withExt;
    el.sample.textContent = sampleText();
  }

  async function compute(items, folders, idx) {
    if (items.length) {
      var r = await ECP.itemLines(items, idx, {
        cfg: cfg,
        selId: st.selId,
        manualPick: st.manualPick,
        activeFolder: st.activeFolder
      });
      st.activeFolder = r.activeIdx;
      return { kind: 'items', lines: r.lines, chains: r.chains, variants: r.variants, activeIdx: r.activeIdx };
    }
    if (folders.length) {
      var f = await ECP.folderLines(folders, idx, cfg);
      return { kind: 'folders', lines: f.lines, chains: f.chains, variants: [], activeIdx: 0 };
    }
    return { kind: 'none', lines: [], chains: [], variants: [], activeIdx: 0 };
  }

  async function render() {
    if (!st.idx) return;
    var r = await compute(st.items, st.folders, st.idx);

    // 素材归属多个文件夹时给下拉，默认跟随左侧当前选中的文件夹
    if (r.variants.length > 1) {
      el.folderPick.innerHTML = '';
      r.variants.forEach(function (c, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = (i + 1) + '. ' + (c.join(cfg.sep) || '（未归入文件夹）');
        el.folderPick.appendChild(o);
      });
      el.folderPick.value = String(r.activeIdx);
      el.folderPick.classList.add('show');
    } else {
      el.folderPick.classList.remove('show');
    }

    el.title.textContent = r.kind === 'folders' ? 'Eagle 路径 · 文件夹'
      : (r.kind === 'items' ? 'Eagle 路径 · 文件' : 'Eagle 路径');

    if (r.lines.length) {
      el.preview.textContent = r.lines[0];
      el.preview.classList.remove('empty');
    } else {
      el.preview.textContent = st.items.length ? '（未归入任何文件夹）' : '未选中素材或文件夹';
      el.preview.classList.add('empty');
    }
    el.preview.title = r.lines.join('\n');

    el.copy.disabled = r.lines.length === 0;
    if (r.kind === 'folders') {
      setStatus('文件夹 · ' + st.folders.length + ' 个 · 将复制 ' + r.lines.length + ' 条路径（已去重）');
    } else if (st.items.length > 1) {
      setStatus('选中 ' + st.items.length + ' 个文件 · 将复制 ' + r.lines.length + ' 条路径（已去重）');
    } else if (r.lines.length) {
      setStatus('文件 · ' + (r.chains[0] || []).length + ' 级路径' + (cfg.withName ? ' + 文件名' : ''));
    } else {
      setStatus('未选中素材或文件夹，无法生成路径', 'err');
    }
  }

  async function refresh() {
    if (st.busy) return;
    var sel;
    try { sel = await ECP.getSelection(); } catch (e) { return; }

    var sig = sel.items.map(function (i) {
      return i.id + ':' + (i.folders || []).join(',');
    }).join('|') + '||' + sel.folders.map(function (f) { return f.id; }).join(',')
      + '#' + cfg.sep + cfg.withName + cfg.withExt;

    if (sig === st.sig) return;
    st.sig = sig;
    st.items = sel.items;
    st.folders = sel.folders;
    st.selId = sel.folders.length ? sel.folders[0].id : null;
    st.manualPick = false;
    st.activeFolder = 0;
    st.idx = await ECP.buildIndex();
    await render();
  }

  function bind() {
    el.copy.addEventListener('click', doCopy);

    el.gear.addEventListener('click', function () {
      syncSettingsUI();
      el.settings.classList.toggle('show');
    });
    el.close.addEventListener('click', function () {
      el.settings.classList.remove('show');
    });

    function updateSample() { el.sample.textContent = sampleText(); }

    el.sep.addEventListener('change', function () {
      cfg.sep = el.sep.value; ECP.saveCfg(cfg); updateSample(); st.sig = ''; refresh();
    });
    el.withName.addEventListener('change', function () {
      cfg.withName = el.withName.checked; ECP.saveCfg(cfg); updateSample(); st.sig = ''; refresh();
    });
    el.withExt.addEventListener('change', function () {
      cfg.withExt = el.withExt.checked; ECP.saveCfg(cfg); updateSample(); st.sig = ''; refresh();
    });

    el.folderPick.addEventListener('change', function () {
      st.manualPick = true;
      st.activeFolder = parseInt(el.folderPick.value, 10) || 0;
      render();
    });
  }

  // ---------- 复制 ----------
  async function doCopy() {
    if (st.busy) return;
    st.busy = true;
    clearTimeout(st.timer);
    try {
      // 不依赖轮询缓存：按按钮时重新读一次当前选中
      var sel = await ECP.getSelection();
      var idx = await ECP.buildIndex();
      var r = await compute(sel.items, sel.folders, idx);
      if (!r.lines.length) { flash('未选中素材或文件夹'); return; }

      var text = r.lines.join('\n');
      await ECP.copy(text);

      el.copy.textContent = '已复制 ✓';
      el.copy.classList.add('ok');
      setStatus('已复制：' + text.replace(/\n/g, '  |  '), 'ok');
      st.timer = setTimeout(function () {
        el.copy.textContent = COPY_LABEL;
        el.copy.classList.remove('ok');
      }, 1800);
    } catch (e) {
      flash('复制失败：' + (e && e.message ? e.message : String(e)));
    } finally {
      st.busy = false;
    }
  }

  function flash(msg) {
    setStatus(msg, 'err');
    clearTimeout(st.timer);
    st.timer = setTimeout(function () { if (st.idx) render(); }, 2600);
  }

  // ---------- 生命周期 ----------
  // Inspector 切换选中时不重建、也不推送事件，只能轻量轮询刷新预览
  eagle.onPluginCreate(async function () {
    if (inited) return;
    inited = true;
    grab();
    bind();
    syncSettingsUI();
    try { document.body.setAttribute('theme', await eagle.app.theme); } catch (e) {}
    await refresh();
    setInterval(function () { if (!document.hidden) refresh(); }, 700);
  });

  eagle.onThemeChanged(function (theme) {
    document.body.setAttribute('theme', theme);
  });
})();
