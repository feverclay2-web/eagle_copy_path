/*
 * 复制 Eagle 路径 — Inspector 面板（右侧检查器）
 * 选中图片/视频时显示两行路径（文件 / 所在文件夹）和两个复制按钮。
 * 选中文件夹时（若 Eagle 保留面板）只显示文件夹路径与单个按钮。
 */
(function () {
  'use strict';

  if (!window.ECP) { console.error('[eagle-copy-path] core.js 未加载'); return; }
  var ECP = window.ECP;
  var cfg = ECP.loadCfg();
  var LABEL_FILE = '复制文件路径';
  var LABEL_FOLDER = '复制文件夹路径';

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
    ['title', 'gear', 'rFile', 'rFolder', 'rowFile', 'rowFolder', 'folderPick',
      'copyFile', 'copyFolder', 'status', 'settings', 'sep', 'withExt', 'sample', 'close'
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = kind || '';
    el.status.title = text;
  }

  function setRow(node, text, placeholder) {
    if (text) {
      node.textContent = text;
      node.classList.remove('empty');
    } else {
      node.textContent = placeholder || '—';
      node.classList.add('empty');
    }
    node.title = text || '';
  }

  function sampleText() {
    var chain = ['根目录', '子目录'].join(cfg.sep);
    var name = '素材' + (cfg.withExt ? '.jpg' : '');
    return '文件    ' + chain + cfg.sep + name + '\n文件夹  ' + chain;
  }

  function syncSettingsUI() {
    el.sep.value = cfg.sep;
    el.withExt.checked = !!cfg.withExt;
    el.sample.textContent = sampleText();
  }

  function opts() {
    return {
      cfg: cfg,
      selId: st.selId,
      manualPick: st.manualPick,
      activeFolder: st.activeFolder
    };
  }

  async function render() {
    if (!st.idx) return;
    var r = await ECP.describe({ items: st.items, folders: st.folders }, st.idx, opts());
    st.activeFolder = r.activeIdx || 0;

    // 素材归属多个文件夹时给下拉，默认跟随左侧当前选中的文件夹
    var variants = r.variants || [];
    if (variants.length > 1) {
      el.folderPick.innerHTML = '';
      variants.forEach(function (c, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = (i + 1) + '. ' + (c.join(cfg.sep) || '（未归入文件夹）');
        el.folderPick.appendChild(o);
      });
      el.folderPick.value = String(r.activeIdx || 0);
      el.folderPick.classList.add('show');
    } else {
      el.folderPick.classList.remove('show');
    }

    var isItems = r.kind === 'items';
    var isFolder = r.kind === 'folders';

    el.title.textContent = isFolder ? 'Eagle 路径 · 文件夹'
      : (isItems ? 'Eagle 路径 · 文件' : 'Eagle 路径');

    el.rFile.classList.toggle('hide', !isItems);
    if (isItems) setRow(el.rowFile, r.file.lines[0], '（未归入任何文件夹）');

    el.rFolder.classList.toggle('hide', !(isItems || isFolder));
    if (isItems) setRow(el.rowFolder, r.folder.lines[0], '（未归入任何文件夹）');
    else if (isFolder) setRow(el.rowFolder, r.folder.lines[0], '—');

    var hasFile = isItems && r.file.lines.length > 0;
    var hasFolder = (isItems || isFolder) && r.folder.lines.length > 0;

    el.copyFile.classList.toggle('hide', !isItems);
    el.copyFile.classList.toggle('primary', isItems);
    el.copyFile.disabled = !hasFile;

    el.copyFolder.classList.toggle('solo', !isItems);
    el.copyFolder.classList.toggle('primary', !isItems);
    el.copyFolder.disabled = !hasFolder;

    if (isFolder) {
      setStatus('文件夹 · ' + st.folders.length + ' 个 · 复制 ' + r.folder.lines.length + ' 条路径（已去重）');
    } else if (isItems && st.items.length > 1) {
      setStatus('选中 ' + st.items.length + ' 个文件 · 文件 ' + r.file.lines.length
        + ' 条 / 文件夹 ' + r.folder.lines.length + ' 条');
    } else if (isItems && r.file.lines.length) {
      setStatus('文件 · ' + (r.file.chains[0] || []).length + ' 级路径');
    } else if (isItems) {
      setStatus('该素材未归入任何文件夹', 'err');
    } else {
      setStatus('选中素材或文件夹后可用');
    }
  }

  async function refresh() {
    if (st.busy) return;
    var sel;
    try { sel = await ECP.getSelection(); } catch (e) { return; }

    var sig = sel.items.map(function (i) {
      return i.id + ':' + (i.folders || []).join(',');
    }).join('|') + '||' + sel.folders.map(function (f) { return f.id; }).join(',')
      + '#' + cfg.sep + cfg.withExt;

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
    el.copyFile.addEventListener('click', function () { doCopy('file'); });
    el.copyFolder.addEventListener('click', function () { doCopy('folder'); });

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
  async function doCopy(which) {
    if (st.busy) return;
    st.busy = true;
    clearTimeout(st.timer);

    var btn = which === 'file' ? el.copyFile : el.copyFolder;
    var label = which === 'file' ? LABEL_FILE : LABEL_FOLDER;

    try {
      // 不依赖轮询缓存：按按钮时重新读一次当前选中
      var sel = await ECP.getSelection();
      var idx = await ECP.buildIndex();
      var r = await ECP.describe(sel, idx, opts());
      var lines = (which === 'file' ? r.file : r.folder).lines;

      if (!lines.length) {
        flash(which === 'file' ? '没有可复制的文件路径' : '没有可复制的文件夹路径');
        return;
      }

      var text = lines.join('\n');
      await ECP.copy(text);

      btn.textContent = '已复制 ✓';
      btn.classList.add('ok');
      setStatus('已复制 · ' + text.replace(/\n/g, '  |  '), 'ok');
      st.timer = setTimeout(function () {
        btn.textContent = label;
        btn.classList.remove('ok');
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
