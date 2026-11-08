/*
 * 复制 Eagle 路径 — Inspector 插件
 *
 * 输出格式（默认）：Y-游戏视频 \ J-绝区零
 * 即从最顶层文件夹一路拼到素材直接所属的文件夹，用 " \ " 连接。
 */
(function () {
  'use strict';

  var CFG_KEY = 'eagle-copy-path:cfg';
  var DEFAULTS = { sep: ' \\ ', withName: false, withExt: true };
  var COPY_LABEL = '复制 Eagle 路径';

  var cfg = loadCfg();
  var el = {};
  var inited = false;
  var st = {
    items: [],
    selId: null,
    idx: null,
    sig: '',
    manualPick: false,
    activeFolder: 0,
    busy: false,
    timer: null
  };

  function loadCfg() {
    try {
      return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CFG_KEY) || '{}'));
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }
  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n | 0)); }

  // ---------- 文件夹索引 ----------
  // 资源库的 metadata 是「嵌套 children 树」，API 的 Folder 实例另有 parent。
  // 两条线索都收，优先用 children 反推的父子关系，避免某些版本 parent 缺失。
  async function buildIndex() {
    var idx = { name: new Map(), parent: new Map() };
    var all = [];
    try { all = await eagle.folder.getAll(); } catch (e) { all = []; }

    function walk(f, pid) {
      if (!f || !f.id) return;
      idx.name.set(f.id, String(f.name || ''));
      if (pid) idx.parent.set(f.id, pid);
      else if (f.parent) idx.parent.set(f.id, f.parent);
      var kids = f.children || [];
      for (var i = 0; i < kids.length; i++) walk(kids[i], f.id);
    }
    for (var i = 0; i < (all || []).length; i++) walk(all[i], null);
    return idx;
  }

  // 由文件夹 id 回溯出完整名称链；getAll 没覆盖到的层级按 id 补查一次
  async function chainOf(fid, idx) {
    var out = [];
    var guard = new Set();
    var cur = fid;
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      var n = idx.name.get(cur);
      if (n === undefined) {
        try {
          var f = await eagle.folder.getById(cur);
          if (f) {
            n = String(f.name || '');
            idx.name.set(cur, n);
            if (f.parent) idx.parent.set(cur, f.parent);
          }
        } catch (e) {}
      }
      if (!n) break;
      out.unshift(n);
      cur = idx.parent.get(cur) || null;
    }
    return out;
  }

  // ---------- 计算路径 ----------
  async function resolve(items, idx, selId, manualPick, activeFolder) {
    var variants = [];
    var chains = [];
    var activeIdx = 0;

    if (!items.length) return { variants: variants, chains: chains, activeIdx: 0 };

    if (items.length === 1) {
      var fids = (items[0].folders || []).filter(Boolean);
      for (var i = 0; i < fids.length; i++) {
        variants.push(await chainOf(fids[i], idx));
      }
      if (variants.length) {
        if (manualPick) activeIdx = clamp(activeFolder, 0, variants.length - 1);
        else if (selId && fids.indexOf(selId) >= 0) activeIdx = fids.indexOf(selId);
        chains.push(variants[activeIdx]);
      } else {
        chains.push([]);
      }
    } else {
      for (var j = 0; j < items.length; j++) {
        var ids = (items[j].folders || []).filter(Boolean);
        var pick = null;
        if (selId && ids.indexOf(selId) >= 0) pick = selId;
        else if (ids.length) pick = ids[0];
        chains.push(pick ? await chainOf(pick, idx) : []);
      }
    }
    return { variants: variants, chains: chains, activeIdx: activeIdx };
  }

  function renderLine(chain, item) {
    var parts = (chain || []).slice();
    if (cfg.withName && item) {
      var n = String(item.name || '');
      var ext = String(item.ext || '');
      if (cfg.withExt && ext && !n.toLowerCase().endsWith('.' + ext.toLowerCase())) {
        n += '.' + ext;
      }
      if (n) parts.push(n);
    }
    return parts.join(cfg.sep);
  }

  // 批量产出默认去重（高度重叠的条目没有意义）
  function linesOf(items, chains) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var t = renderLine(chains[i] || [], items[i]);
      if (t && out.indexOf(t) < 0) out.push(t);
    }
    return out;
  }

  // ---------- 界面 ----------
  function grab() {
    ['gear', 'preview', 'folderPick', 'copy', 'status', 'settings', 'sep', 'withName',
      'withExt', 'sample', 'close'].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = kind || '';
    el.status.title = text;
  }

  function sampleText() {
    var parts = ['根目录', '子目录', '三级目录'];
    if (cfg.withName) parts.push('文件名' + (cfg.withExt ? '.jpg' : ''));
    return '示例  ' + parts.join(cfg.sep);
  }

  function syncSettingsUI() {
    el.sep.value = cfg.sep;
    el.withName.checked = !!cfg.withName;
    el.withExt.checked = !!cfg.withExt;
    el.sample.textContent = sampleText();
  }

  async function render() {
    if (!st.idx) return;
    var r = await resolve(st.items, st.idx, st.selId, st.manualPick, st.activeFolder);
    st.activeFolder = r.activeIdx;
    var lines = linesOf(st.items, r.chains);

    // 多归属时给一个下拉，默认优先跟随左侧当前选中的文件夹
    if (r.variants.length > 1) {
      var opts = r.variants.map(function (c) { return c.join(cfg.sep) || '（未归入文件夹）'; });
      el.folderPick.innerHTML = '';
      opts.forEach(function (label, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = (i + 1) + '. ' + label;
        el.folderPick.appendChild(o);
      });
      el.folderPick.value = String(r.activeIdx);
      el.folderPick.classList.add('show');
    } else {
      el.folderPick.classList.remove('show');
    }

    if (lines.length) {
      el.preview.textContent = lines[0];
      el.preview.classList.remove('empty');
    } else {
      el.preview.textContent = st.items.length ? '（未归入任何文件夹）' : '未选中素材';
      el.preview.classList.add('empty');
    }
    el.preview.title = lines.join('\n');

    el.copy.disabled = lines.length === 0;
    if (st.items.length > 1) {
      setStatus('选中 ' + st.items.length + ' 个素材 · 将复制 ' + lines.length + ' 条路径（已去重）');
    } else if (lines.length) {
      var level = (r.chains[0] || []).length;
      setStatus('就绪 · ' + level + ' 级文件夹路径');
    } else {
      setStatus('素材未归入文件夹，无法生成路径', 'err');
    }
  }

  async function refresh() {
    if (st.busy) return;
    var items = [];
    var selId = null;
    try {
      items = (await eagle.item.getSelected()) || [];
      var sel = await eagle.folder.getSelected();
      if (sel && sel[0]) selId = sel[0].id;
    } catch (e) { return; }

    var sig = items.map(function (i) {
      return i.id + ':' + (i.folders || []).join(',');
    }).join('|') + '#' + cfg.sep + cfg.withName + cfg.withExt;

    if (sig === st.sig) return;
    st.sig = sig;
    st.items = items;
    st.selId = selId;
    st.manualPick = false;
    st.activeFolder = 0;
    st.idx = await buildIndex();
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

    el.sep.addEventListener('change', function () {
      cfg.sep = el.sep.value;
      saveCfg();
      el.sample.textContent = sampleText();
      st.sig = '';
      refresh();
    });
    el.withName.addEventListener('change', function () {
      cfg.withName = el.withName.checked;
      saveCfg();
      el.sample.textContent = sampleText();
      st.sig = '';
      refresh();
    });
    el.withExt.addEventListener('change', function () {
      cfg.withExt = el.withExt.checked;
      saveCfg();
      el.sample.textContent = sampleText();
      st.sig = '';
      refresh();
    });

    el.folderPick.addEventListener('change', function () {
      st.manualPick = true;
      st.activeFolder = clamp(parseInt(el.folderPick.value, 10), 0, 999);
      render();
    });
  }

  // ---------- 复制 ----------
  async function doCopy() {
    if (st.busy) return;
    st.busy = true;
    clearTimeout(st.timer);
    try {
      // 不依赖轮询缓存：按按钮时重新读一次当前选中，避免复制到上一个素材
      var items = (await eagle.item.getSelected()) || [];
      if (!items.length) { flash('没有选中素材'); return; }

      var sel = [];
      try { sel = await eagle.folder.getSelected(); } catch (e) {}
      var selId = (sel && sel[0]) ? sel[0].id : null;

      var idx = await buildIndex();
      var r = await resolve(items, idx, selId, st.manualPick, st.activeFolder);
      var lines = linesOf(items, r.chains);
      if (!lines.length) { flash('素材未归入任何文件夹'); return; }

      var text = lines.join('\n');
      await eagle.clipboard.writeText(text);

      // 读回校验，不报「假成功」
      var back = await eagle.clipboard.readText();
      if (back !== text) { flash('剪贴板读回不一致，请重试'); return; }

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
  // Inspector 插件切换素材时不会重建，也不推送变更，只能轻量轮询刷新预览
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
