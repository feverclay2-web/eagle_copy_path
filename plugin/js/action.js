/*
 * 复制 Eagle 路径 — 「一键复制」窗口
 * 由插件菜单或快捷键 Ctrl+Alt+Shift+P 唤起。选中文件时给「文件路径 / 文件夹路径」两个按钮；
 * 选中文件夹时只给「文件夹路径」。窗口不自动复制，点哪个复制哪个。
 */
(function () {
  'use strict';

  if (!window.ECP) { console.error('[eagle-copy-path] core.js 未加载'); return; }
  var ECP = window.ECP;
  var cfg = ECP.loadCfg();
  var LABEL_FILE = '复制文件路径';
  var LABEL_FOLDER = '复制文件夹路径';

  var el = {};
  var firstRun = 0;
  var timer = null;
  var busy = false;

  function grab() {
    ['ttl', 'badge', 'rFile', 'rFolder', 'rowFile', 'rowFolder',
      'copyFile', 'copyFolder', 'hint', 'close'
    ].forEach(function (id) { el[id] = document.getElementById(id); });
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

  function setBadge(text, kind) {
    el.badge.textContent = text;
    el.badge.className = kind || '';
  }

  async function refresh() {
    var sel, idx, r;
    try {
      sel = await ECP.getSelection();
      idx = await ECP.buildIndex();
      r = await ECP.describe(sel, idx, {
        cfg: cfg,
        selId: sel.folders.length ? sel.folders[0].id : null,
        manualPick: false,
        activeFolder: 0
      });
    } catch (e) {
      setBadge('读取失败', 'err');
      el.hint.textContent = e && e.message ? e.message : String(e);
      return;
    }

    var isItems = r.kind === 'items';
    var isFolder = r.kind === 'folders';

    el.ttl.textContent = isFolder ? 'Eagle 路径 · 文件夹'
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

    if (isItems) {
      setBadge(sel.items.length > 1 ? '选中 ' + sel.items.length + ' 个文件' : '文件');
      el.hint.textContent = '两个路径都可复制 · Esc 关闭';
    } else if (isFolder) {
      setBadge(sel.folders.length > 1 ? '选中 ' + sel.folders.length + ' 个文件夹' : '文件夹');
      el.hint.textContent = 'Esc 关闭';
    } else {
      setBadge('未选中');
      el.hint.textContent = '先在 Eagle 里选中文件或文件夹';
    }
  }

  async function doCopy(which) {
    if (busy) return;
    busy = true;
    clearTimeout(timer);

    var btn = which === 'file' ? el.copyFile : el.copyFolder;
    var label = which === 'file' ? LABEL_FILE : LABEL_FOLDER;

    try {
      var sel = await ECP.getSelection();
      var idx = await ECP.buildIndex();
      var r = await ECP.describe(sel, idx, {
        cfg: cfg,
        selId: sel.folders.length ? sel.folders[0].id : null,
        manualPick: false,
        activeFolder: 0
      });
      var lines = (which === 'file' ? r.file : r.folder).lines;

      if (!lines.length) {
        setBadge('没有可复制的路径', 'err');
        return;
      }

      var text = lines.join('\n');
      await ECP.copy(text);

      btn.textContent = '已复制 ✓';
      btn.classList.add('ok');
      setBadge('已复制' + (lines.length > 1 ? ' · ' + lines.length + ' 条' : ''), 'ok');
      el.hint.textContent = text.replace(/\n/g, '  |  ');
      timer = setTimeout(function () {
        btn.textContent = label;
        btn.classList.remove('ok');
      }, 1800);
    } catch (e) {
      setBadge('复制失败', 'err');
      el.hint.textContent = e && e.message ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function hide() {
    clearTimeout(timer);
    try { eagle.window.hide(); } catch (e) {}
  }

  function bind() {
    el.copyFile.addEventListener('click', function () { doCopy('file'); });
    el.copyFolder.addEventListener('click', function () { doCopy('folder'); });
    el.close.addEventListener('click', hide);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hide();
    });
  }

  // 窗口被复用时会连续触发 create / run / show，600ms 内只刷新一次
  function show() {
    var now = Date.now();
    if (now - firstRun < 600) return;
    firstRun = now;
    clearTimeout(timer);
    el.copyFile.textContent = LABEL_FILE;
    el.copyFolder.textContent = LABEL_FOLDER;
    el.copyFile.classList.remove('ok');
    el.copyFolder.classList.remove('ok');
    refresh();
  }

  eagle.onPluginCreate(async function () {
    grab();
    bind();
    try { document.body.setAttribute('theme', await eagle.app.theme); } catch (e) {}
    show();
  });
  eagle.onPluginRun(show);
  eagle.onPluginShow(show);
  eagle.onThemeChanged(function (theme) {
    document.body.setAttribute('theme', theme);
  });
})();
