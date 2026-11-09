/*
 * 复制 Eagle 路径 — 共用核心逻辑
 * Inspector 面板与「一键复制」窗口都走这里，保证两边格式、配置、去重规则一致。
 */
(function (root) {
  'use strict';

  var CFG_KEY = 'eagle-copy-path:cfg';
  var CFG_SCHEMA = 2;
  // 选中文件默认带文件名；选中文件夹只输出文件夹链（folderLines 不传 item）
  var DEFAULTS = { sep: ' \\ ', withName: true, withExt: true, schema: CFG_SCHEMA };

  function loadCfg() {
    var raw = {};
    try { raw = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) {}
    var cfg = Object.assign({}, DEFAULTS, raw);
    // v1.0 / v1.1 持久化过「不带文件名」，升级一次并写回，避免旧值盖掉新默认；
    // 之后用户自己改的开关会带 schema:2，不会再被重置。
    if (raw.schema !== CFG_SCHEMA) {
      cfg.withName = true;
      cfg.schema = CFG_SCHEMA;
      saveCfg(cfg);
    }
    return cfg;
  }

  function saveCfg(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n | 0)); }

  // 资源库的 metadata 是「嵌套 children 树」，API 的 Folder 另有 parent。
  // 两条线索都收，优先用 children 反推，避免某些版本 parent 缺失。
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

  // 由文件夹 id 回溯完整名称链；getAll 没覆盖到的层级按 id 补查一次
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

  function renderLine(chain, item, cfg) {
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

  // 批量产出默认去重
  function dedupe(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] && out.indexOf(lines[i]) < 0) out.push(lines[i]);
    }
    return out;
  }

  // 当前选中的素材与文件夹
  async function getSelection() {
    var items = [], folders = [];
    try { items = (await eagle.item.getSelected()) || []; } catch (e) {}
    try { folders = (await eagle.folder.getSelected()) || []; } catch (e) {}
    return { items: items, folders: folders };
  }

  // 选中素材：生成每条素材所属文件夹的路径；单素材多归属时提供全部候选
  async function itemLines(items, idx, o) {
    var cfg = o.cfg;
    var variants = [], chains = [], activeIdx = 0;

    if (items.length === 1) {
      var fids = (items[0].folders || []).filter(Boolean);
      for (var i = 0; i < fids.length; i++) {
        variants.push(await chainOf(fids[i], idx));
      }
      if (variants.length) {
        if (o.manualPick) activeIdx = clamp(o.activeFolder, 0, variants.length - 1);
        else if (o.selId && fids.indexOf(o.selId) >= 0) activeIdx = fids.indexOf(o.selId);
        chains.push(variants[activeIdx]);
      } else {
        chains.push([]);
      }
    } else {
      for (var j = 0; j < items.length; j++) {
        var ids = (items[j].folders || []).filter(Boolean);
        var pick = null;
        if (o.selId && ids.indexOf(o.selId) >= 0) pick = o.selId;
        else if (ids.length) pick = ids[0];
        chains.push(pick ? await chainOf(pick, idx) : []);
      }
    }

    var lines = [];
    for (var k = 0; k < items.length; k++) {
      lines.push(renderLine(chains[k] || [], items[k], cfg));
    }
    return { lines: dedupe(lines), chains: chains, variants: variants, activeIdx: activeIdx };
  }

  // 选中文件夹：生成每个文件夹自身的完整链路（从根到自己）
  async function folderLines(folders, idx, cfg) {
    var chains = [], lines = [];
    for (var i = 0; i < folders.length; i++) {
      var f = folders[i];
      var chain = f && f.id ? await chainOf(f.id, idx) : [];
      // 智能文件夹等不在普通文件夹树里的对象，用名字兜底
      if (!chain.length && f && f.name) chain = [String(f.name)];
      chains.push(chain);
      lines.push(renderLine(chain, null, cfg));
    }
    return { lines: dedupe(lines), chains: chains, variants: [] };
  }

  // 一次算出两种结果，供「复制文件路径 / 复制文件夹路径」两个按钮使用。
  // file  = 文件夹链 + 文件名；folder = 仅文件夹链。
  // 选中文件夹时没有「文件名」概念，file 置空，只留 folder。
  async function describe(sel, idx, o) {
    var base = o.cfg;
    function withName(v) { return Object.assign({}, base, { withName: v }); }

    var out = {
      kind: 'none',
      file: { lines: [], chains: [], variants: [], activeIdx: 0 },
      folder: { lines: [], chains: [], variants: [], activeIdx: 0 },
      variants: [],
      activeIdx: 0
    };

    if (sel.items && sel.items.length) {
      out.kind = 'items';
      out.file = await itemLines(sel.items, idx, Object.assign({}, o, { cfg: withName(true) }));
      out.folder = await itemLines(sel.items, idx, Object.assign({}, o, { cfg: withName(false) }));
      out.variants = (out.file && out.file.variants) || [];
      out.activeIdx = (out.file && out.file.activeIdx) || 0;
    } else if (sel.folders && sel.folders.length) {
      out.kind = 'folders';
      out.folder = await folderLines(sel.folders, idx, base);
    }
    return out;
  }

  // 写入剪贴板并读回校验，不报假成功
  async function copy(text) {
    await eagle.clipboard.writeText(text);
    var back = await eagle.clipboard.readText();
    if (back !== text) throw new Error('剪贴板读回不一致，请重试');
    return true;
  }

  root.ECP = {
    CFG_KEY: CFG_KEY,
    DEFAULTS: DEFAULTS,
    loadCfg: loadCfg,
    saveCfg: saveCfg,
    buildIndex: buildIndex,
    chainOf: chainOf,
    renderLine: renderLine,
    dedupe: dedupe,
    getSelection: getSelection,
    itemLines: itemLines,
    folderLines: folderLines,
    describe: describe,
    copy: copy
  };
})(typeof window !== 'undefined' ? window : globalThis);
