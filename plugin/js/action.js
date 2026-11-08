/*
 * 复制 Eagle 路径 — 「一键复制」窗口
 * 由插件菜单或快捷键 Ctrl+Alt+Shift+P 唤起；打开即复制当前对象的路径，随后自动隐藏。
 * 选中素材时复制素材所属文件夹路径；没有选中素材时复制左侧当前选中文件夹自身的路径。
 */
(function () {
  'use strict';

  if (!window.ECP) { console.error('[eagle-copy-path] core.js 未加载'); return; }
  var ECP = window.ECP;

  var el = {};
  var pinned = false;
  var lastRun = 0;
  var hideTimer = null;

  function grab() {
    ['ttl', 'badge', 'path', 'hint', 'pin', 'close'].forEach(function (id) {
      el[id] = document.getElementById(id);
    });
  }

  function showResult(status, text, kind) {
    el.badge.textContent = status;
    el.badge.className = kind || '';
    el.path.textContent = text || '';
  }

  function hide() {
    clearTimeout(hideTimer);
    try { eagle.window.hide(); } catch (e) {}
  }

  async function run() {
    // onPluginCreate / onPluginRun / onPluginShow 在窗口创建或复用时可能连续触发
    var now = Date.now();
    if (now - lastRun < 400) return;
    lastRun = now;
    clearTimeout(hideTimer);

    try {
      var sel = await ECP.getSelection();
      var idx = await ECP.buildIndex();
      var cfg = ECP.loadCfg();
      var r, kind;

      if (sel.items.length) {
        r = await ECP.itemLines(sel.items, idx, {
          cfg: cfg,
          selId: sel.folders.length ? sel.folders[0].id : null,
          manualPick: false,
          activeFolder: 0
        });
        kind = '素材';
      } else if (sel.folders.length) {
        r = await ECP.folderLines(sel.folders, idx, cfg);
        kind = '文件夹';
      } else {
        r = { lines: [] };
        kind = '无';
      }

      if (!r.lines.length) {
        showResult('未选中', '没有选中素材或文件夹，没有可复制的路径。', 'err');
        el.ttl.textContent = 'Eagle 路径';
      } else {
        var text = r.lines.join('\n');
        await ECP.copy(text);
        showResult('已复制 · ' + kind + (r.lines.length > 1 ? ' · ' + r.lines.length + ' 条' : ''), text, 'ok');
        el.ttl.textContent = kind === '文件夹' ? 'Eagle 路径 · 文件夹' : 'Eagle 路径 · 素材';
      }
    } catch (e) {
      showResult('复制失败', (e && e.message ? e.message : String(e)), 'err');
    }

    if (!pinned) hideTimer = setTimeout(hide, 1800);
  }

  function bind() {
    el.pin.addEventListener('click', function () {
      pinned = !pinned;
      clearTimeout(hideTimer);
      el.pin.textContent = pinned ? '自动隐藏' : '保持显示';
      el.hint.textContent = pinned ? '窗口不会自动隐藏' : 'Ctrl+Alt+Shift+P 再次触发';
    });
    el.close.addEventListener('click', hide);
  }

  eagle.onPluginCreate(async function () {
    grab();
    bind();
    try { document.body.setAttribute('theme', await eagle.app.theme); } catch (e) {}
    run();
  });
  eagle.onPluginRun(run);
  eagle.onPluginShow(run);
  eagle.onThemeChanged(function (theme) {
    document.body.setAttribute('theme', theme);
  });
})();
