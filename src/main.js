import { bitable } from '@lark-base-open/js-sdk';

/* 字段映射：左边是单据上的位置，右边是「隐患整改台账」里的字段名。
   换表或改字段名时只动这里。
   🔴 字段名写错不会报错，只会打出空白栏 —— 09-07 就是这么白开了一批单：
   「整改方案」「责任人」台账里根本没有，真名是「整改措施」「负责人」。
   改这里之前先 `lark-cli base +field-list` 对一遍真实字段名。 */
const FIELDS = {
  no: '整改单编号',
  project: '所在项目',
  unit: '责任单位',
  hazard: '隐患描述',
  require: '整改措施',
  owner: '负责人',
  period: '要求完成整改时间',
  photos: '整改前图片',
  /* 违反条款的来源：「对照标准条目」这个 link 字段。
     🔴 台账里不加 lookup 列 —— 插件自己顺着 link 跨表去读清单表，
     Base 结构一个字不动。取两样：清单序号（印「第 N 条」）＋ 违反条款（印引用的规范）。 */
  standard: '对照标准条目',
};

/* 清单表里要读的两个字段，和单据上「违反条款」那行的出处表述。
   🔴 出处 = 中冶南方政〔2026〕131 号《中冶南方安全检查隐患考核实施细则》，
   Base 的「隐患考核标准清单」345 条即出自该文（见 D08 一）。
   改这里之前先回原件核对文号与附件号——这行要印在正式单据上。 */
const STD = {
  table: '隐患考核标准清单',
  no: '清单序号',
  clause: '违反条款',
  source: '《中冶南方安全检查隐患考核实施细则》（中冶南方政〔2026〕131号）',
};

/* 「要求完成整改时间」常空（18 条里只有 3 条填了），
   而「建议整改期限」是按细则自动算的（I级次日 / II级7天），16 条有值 —— 空了就用它兜底。 */
const PERIOD_FALLBACK = '建议整改期限';

/* 工程名称字段为空时的兜底。留空即打印空白栏，由填表人手写。
   如需固定某个工程名，在这里填。 */
const DEFAULT_PROJECT = '';

const DEPTS = ['工程部', '技术质量部', '安监部', '经营部', '物资设备部', '办公室'];

const host = document.getElementById('sheet-host');
const statusEl = document.getElementById('status');

function setStatus(text, isErr = false) {
  statusEl.textContent = text;
  statusEl.className = isErr ? 'err' : '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

/* 违反条款。没选「对照标准条目」的隐患本栏为空，整段不出——
   空着一行「违反条款：」比不写更难看。 */
function legalHtml(d) {
  if (!d.clause) return '';
  return `<div class="legal-box">
      <span class="legal-head">违反条款：</span>
      <span class="legal-body">${esc(d.clause)}</span>
    </div>`;
}

/* 附件照片页：一行两张的表格，格线就是照片边框 */
function attachPage(d) {
  const cells = d.photos.map(
    (p, i) => `<td class="ph">
         <img src="${esc(p.url || p)}" alt="隐患照片${i + 1}" />
         <div class="ph-cap">${esc(p.cap || `照片 ${i + 1}`)}</div>
       </td>`
  );
  if (cells.length % 2) cells.push('<td class="ph ph-empty"></td>');

  const rows = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push(`<tr>${cells[i]}${cells[i + 1]}</tr>`);
  }

  return `<div class="page">
      <table class="form attach">
        <colgroup><col style="width:79.45mm" /><col style="width:79.45mm" /></colgroup>
        <tr><td class="attach-head" colspan="2">
          附件：隐患照片${d.no ? `（编号 ${esc(d.no)}）` : ''}
        </td></tr>
        ${rows.join('')}
      </table>
    </div>`;
}

function renderOne(d) {
  const checkboxes = DEPTS.map((n) => `▢${n}`).join('&nbsp;&nbsp;');

  /* 第一页：单据本体。列宽用 colgroup 锁死，与模板 tblGrid 一致 */
  const page1 = `
    <div class="page">
      <p class="doc-title">安全隐患通知(整改)单</p>
      <p class="doc-subtitle">（CCEPC-PM-AQ-05）</p>
      <p class="doc-no">编号：${esc(d.no)}</p>
      <table class="form">
        <colgroup>
          <col style="width:31.2mm" /><col style="width:28.7mm" />
          <col style="width:27.0mm" /><col style="width:26.5mm" />
          <col style="width:19.2mm" /><col style="width:26.3mm" />
        </colgroup>
        <tr class="r0">
          <td class="label">工程名称</td>
          <td class="val" colspan="3">${esc(d.project || DEFAULT_PROJECT)}</td>
          <td class="label">合同号</td>
          <td class="val"></td>
        </tr>
        <tr class="r1">
          <td class="label">责任单位</td>
          <td class="val" colspan="5">${esc(d.unit)}</td>
        </tr>
        <tr class="r2">
          <td class="label">责任部门</td>
          <td class="val-sm" colspan="5">${checkboxes}&nbsp;&nbsp;▢其他：</td>
        </tr>
        <tr class="r3">
          <td class="block" colspan="6">
            <span class="block-head">存在安全隐患：</span>
            <span class="block-body">${esc(d.hazard)}</span>
            ${legalHtml(d)}
            <div class="sign-row"><span>签发人签字：</span><span>日&emsp;期：</span></div>
          </td>
        </tr>
        <tr class="r4">
          <td class="block" colspan="6">
            <span class="block-head">整改要求：</span>
            <span class="block-body">${esc(d.require)}</span>
          </td>
        </tr>
        <tr class="r5">
          <td class="label">整改单位<br/>责任人</td>
          <td class="val">${esc(d.owner)}</td>
          <td class="label">整改期限</td>
          <td class="val-sm" colspan="3">${esc(d.period)}</td>
        </tr>
        <tr class="r6">
          <td class="block" colspan="6">
            <span class="block-head">审核意见：</span>
            <div class="sign-row">
              <span>项目部（章）：</span><span>项目负责人：</span><span>日&emsp;期：</span>
            </div>
          </td>
        </tr>
        <tr class="r7">
          <td class="block" colspan="6">
            <span class="block-head">复查结果记录：</span>
            <div class="sign-row"><span>复查人：</span><span>日&emsp;期：</span></div>
          </td>
        </tr>
      </table>
    </div>`;

  /* 第二页：附件照片。做成真正的表格 —— 与单据表同宽、同边框，
     照片和图注共处一格，格线即照片边框，不再是「表格一套线、图片另一套线」。
     一行两张，行内不足两张时补一个空格子，保证右边框闭合。 */
  const page2 = d.photos.length ? attachPage(d) : '';

  return page1 + page2;
}

/* 多条隐患合并成「一张」整改单：
   隐患和整改要求在同一栏内逐条编号列出，照片统一附在后面。
   工程名称/责任单位/责任人/期限这类单值字段取第一条。 */
function mergeRecords(list) {
  if (list.length === 1) return list[0];

  const numbered = (key) =>
    list
      .map((d, i) => (d[key] ? `${i + 1}. ${d[key]}` : ''))
      .filter(Boolean)
      .join('\n');

  /* 照片标注来自第几条隐患，否则混在一起认不出对应关系 */
  const photos = [];
  list.forEach((d, i) => {
    d.photos.forEach((u, j) => {
      photos.push({ url: u, cap: `隐患 ${i + 1} · 照片 ${j + 1}` });
    });
  });

  return {
    no: list[0].no,
    project: list[0].project,
    unit: list[0].unit,
    owner: list[0].owner,
    period: list[0].period,
    hazard: numbered('hazard'),
    require: numbered('require'),
    /* 条款按隐患编号对应列出；多条隐患引同一款时去重，否则整改单上会重复刷屏 */
    clause: [...new Set(list.map((d) => d.clause).filter(Boolean))]
      .map((c, i) => (list.length > 1 ? `${i + 1}. ${c}` : c))
      .join('\n'),
    photos,
  };
}

function renderAll(list) {
  host.innerHTML = renderOne(mergeRecords(list));
}

function renderHint(msg, sub = '', diag = '') {
  host.innerHTML = `<div class="empty-hint">
      <p>${esc(msg)}</p>
      ${sub ? `<p style="font-size:12px;color:#8f959e">${esc(sub)}</p>` : ''}
      ${diag ? `<pre style="text-align:left;display:inline-block;margin-top:16px;padding:10px 14px;
                 background:#f2f3f5;border-radius:6px;font-size:11px;line-height:1.7;
                 white-space:pre-wrap;word-break:break-all;color:#4e5969">${esc(diag)}
${esc(dbg())}</pre>` : ''}
    </div>`;
}

/* Base 里「选中」有两种，SDK 的取法不一样，两种都要支持：
   ① 点击单元格 → 光标激活，getSelection().recordId 有值
   ② 勾选行首复选框 → 光标不动，要从视图取 getSelectedRecordIdList()
   用户更习惯②，但 SDK 默认只给①，所以必须回落。 */
let lastDiag = '';

async function resolveRecords(table, sel) {
  const d = [`selection = ${JSON.stringify({
    tableId: sel.tableId, viewId: sel.viewId,
    recordId: sel.recordId, fieldId: sel.fieldId })}`];

  if (sel.recordId) {
    lastDiag = d.join('\n');
    return { ids: [sel.recordId], from: '光标记录' };
  }

  if (sel.viewId) {
    try {
      const view = await table.getViewById(sel.viewId);
      try { d.push(`viewType = ${await view.getType()}`); } catch { d.push('viewType = 取不到'); }
      const hasFn = typeof view.getSelectedRecordIdList === 'function';
      d.push(`view.getSelectedRecordIdList 存在 = ${hasFn}`);
      if (hasFn) {
        const ids = await view.getSelectedRecordIdList();
        d.push(`勾选返回 = ${JSON.stringify(ids)}`);
        if (ids?.length) {
          lastDiag = d.join('\n');
          return { ids, from: ids.length > 1 ? `勾选 ${ids.length} 条` : '勾选记录' };
        }
      }
    } catch (e) {
      d.push(`异常 = ${e?.message || e}`);
    }
  } else {
    d.push('selection 里没有 viewId');
  }

  lastDiag = d.join('\n');
  return null;
}

/* 读取选中的记录（可多条），逐份渲染 */
async function load() {
  setStatus('读取中…');
  const sel = await bitable.base.getSelection();
  if (!sel?.tableId) {
    renderHint('未识别到数据表，请在左侧打开一张表。');
    setStatus('无数据表');
    return;
  }

  const table = await bitable.base.getTableById(sel.tableId);
  const picked = await resolveRecords(table, sel);
  if (!picked) {
    renderHint('请在左侧表格中勾选或点选隐患记录（可多选）。',
               '勾选后如果这里没自动刷新，点上方「重新读取」。', lastDiag);
    setStatus('未选中记录');
    return;
  }

  const metas = await table.getFieldMetaList();
  const byName = new Map(metas.map((m) => [m.name, m]));
  const missing = Object.values(FIELDS).filter((name) => !byName.has(name));

  const list = [];
  for (let i = 0; i < picked.ids.length; i++) {
    if (picked.ids.length > 1) setStatus(`读取中 ${i + 1}/${picked.ids.length}…`);
    list.push(await readOne(table, byName, picked.ids[i]));
  }

  renderAll(list);

  const uniq = (k) => [...new Set(list.map((d) => d[k]).filter(Boolean))];
  const clash = ['unit', 'owner', 'period']
    .filter((k) => uniq(k).length > 1)
    .map((k) => ({ unit: '责任单位', owner: '整改责任人', period: '整改期限' }[k]));

  const head = list.length > 1
    ? `已合并 ${list.length} 条隐患到一张单　·　${picked.from}`
      + (clash.length ? `；${clash.join('、')}各条不一致，已取第 1 条` : '')
    : `已生成：${list[0].no || '(无编号)'}　·　${picked.from}`;
  setStatus(missing.length ? `${head}；这些字段在当前表里找不到：${missing.join('、')}` : head,
            missing.length > 0 || clash.length > 0);
}

/* 读一条记录的全部字段 */
async function readOne(table, byName, recordId) {
  const text = async (name) => {
    const m = byName.get(name);
    if (!m) return '';
    try {
      return (await table.getCellString(m.id, recordId)) || '';
    } catch {
      return '';
    }
  };

  /* 附件字段单独走 getAttachmentUrls，且必须容错——
     记录里没有附件时该调用会抛错或返回 null。 */
  const urls = async (name) => {
    const m = byName.get(name);
    if (!m) return [];
    try {
      const field = await table.getField(m.id);
      const listed = await field.getAttachmentUrls(recordId);
      return Array.isArray(listed) ? listed.filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  return {
    no: await text(FIELDS.no),
    project: await text(FIELDS.project),
    unit: await text(FIELDS.unit),
    hazard: await text(FIELDS.hazard),
    require: await text(FIELDS.require),
    owner: await text(FIELDS.owner),
    /* 要求完成整改时间常空，回落到按细则自动算的建议整改期限 */
    period: (await text(FIELDS.period)) || (await text(PERIOD_FALLBACK)),
    clause: await readClause(table, byName, recordId),
    photos: await urls(FIELDS.photos),
  };
}

/* 顺着「对照标准条目」link 跨表读清单，拼出「第 N 条 · 违反的规范」。
   🔴 不读 AI初判结果 里的序号：那是 AI 的建议，安全员改选了条目它不会跟着变，
   照它印会印出跟定级不一致的条款。以人工选定的 link 为准。 */
async function readClause(table, byName, recordId) {
  const meta = byName.get(FIELDS.standard);
  if (!meta) return '';
  try {
    const cell = await table.getCellValue(meta.id, recordId);
    if (!Array.isArray(cell) || !cell.length) return '';

    const linkTableId = cell[0]?.tableId || cell[0]?.table_id;
    if (!linkTableId) return '';
    const stdTable = await bitable.base.getTableById(linkTableId);
    const stdMeta = new Map((await stdTable.getFieldMetaList()).map((m) => [m.name, m]));
    const noId = stdMeta.get(STD.no)?.id;
    const clauseId = stdMeta.get(STD.clause)?.id;

    const parts = [];
    for (const link of cell) {
      const rid = link?.recordIds?.[0] || link?.record_ids?.[0] || link?.recordId;
      if (!rid) continue;
      const no = noId ? await stdTable.getCellString(noId, rid) : '';
      const cl = clauseId ? await stdTable.getCellString(clauseId, rid) : '';
      const head = no ? `${STD.source}第 ${no} 条` : STD.source;
      parts.push(cl ? `${head}\n${cl}` : head);
    }
    return parts.join('\n');
  } catch {
    return '';
  }
}

document.getElementById('btn-print').onclick = () => window.print();
document.getElementById('btn-reload').onclick = () => load().catch(onErr);

function onErr(e) {
  console.error(e);
  const msg = e?.message || String(e);
  setStatus(`读取失败：${msg}`, true);
  /* 出错时必须在主体里显示，否则用户看到的是一片空白，无从判断 */
  host.innerHTML = `<div class="empty-hint">
      <p style="color:#e8642c;font-weight:600">插件读取数据失败</p>
      <p style="font-family:monospace;font-size:12px;word-break:break-all">${esc(msg)}</p>
      <p style="font-size:12px;color:#8f959e">${esc(dbg())}</p>
    </div>`;
}

/* 诊断信息：出问题时能一眼看出卡在哪一步 */
function dbg() {
  return [
    `SDK: ${typeof bitable === 'undefined' ? '未加载' : '已加载'}`,
    `环境: ${window.self === window.top ? '独立窗口（不在 Base 里）' : 'iframe'}`,
    `build: ${BUILD}`,
  ].join(' ｜ ');
}

const BUILD = '2026-09-07a';

/* 脱离飞书直接打开时（本地调版式用），SDK 不会就绪，显示样例数据 */
const OFFLINE_SAMPLE = [{
  no: 'SAMPLE-001',
  project: '（样例）某某建设工程项目',
  unit: '（样例）某某劳务分包有限公司',
  hazard: '（样例）××部位安全防护缺失，不符合规范要求。',
  require: '（样例）限期整改到位并经验收；整改期间设置警戒区。',
  owner: '（样例）张三',
  period: '2026-01-01',
  clause: '《中冶南方安全检查隐患考核实施细则》（中冶南方政〔2026〕131号）第 154 条\n'
        + '1、《建筑施工高处作业安全技术规范》（JGJ 80-2016）4.1.2。\n'
        + '2、《安全带》（GB 6095-2021）5.1。',
  photos: [ph('样例照片 1'), ph('样例照片 2'), ph('样例照片 3')],
}, {
  no: 'SAMPLE-002',
  project: '（样例）某某建设工程项目',
  unit: '（样例）另一家分包单位',
  hazard: '（样例）第二条隐患，用于验证多份连续打印的分页。',
  require: '（样例）按规范整改并复查。',
  owner: '（样例）李四',
  period: '2026-01-02',
  photos: [],
}];

/* 占位图，仅离线调版式时使用 */
function ph(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <rect width="100%" height="100%" fill="#e5e6e8"/>
    <text x="50%" y="50%" font-size="42" fill="#8f959e"
          text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

let ready = false;
const offlineTimer = setTimeout(() => {
  if (!ready) {
    renderAll(OFFLINE_SAMPLE);
    setStatus('未连接到多维表格，当前显示样例数据（仅用于调版式）', true);
  }
}, 2500);

bitable.base
  .getSelection()
  .then(() => {
    ready = true;
    clearTimeout(offlineTimer);
    bitable.base.onSelectionChange(() => load().catch(onErr));
    return load();
  })
  .catch(onErr);
