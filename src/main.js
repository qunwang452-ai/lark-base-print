import { bitable } from '@lark-base-open/js-sdk';

/* 字段映射：左边是单据上的位置，右边是「隐患整改台账」里的字段名。
   换表或改字段名时只动这里。 */
const FIELDS = {
  no: '整改单编号',
  project: '所在项目',
  unit: '责任分包单位',
  hazard: '隐患描述',
  require: '整改要求',
  owner: '整改责任人',
  period: '整改期限',
  photos: '隐患照片',
};

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

  /* 第二页：附件照片，一行两张。没有照片就不出这一页 */
  const page2 = d.photos.length
    ? `<div class="page page-attach">
         <p class="attach-title">附件：隐患照片（编号 ${esc(d.no)}）</p>
         <div class="attach-grid">
           ${d.photos
             .map(
               (u, i) => `<figure>
                  <img src="${esc(u)}" alt="隐患照片${i + 1}" />
                  <figcaption>照片 ${i + 1}</figcaption>
                </figure>`
             )
             .join('')}
         </div>
       </div>`
    : '';

  return page1 + page2;
}

/* 多份单据依次排下去，份与份之间由 CSS 分页 */
function renderAll(list) {
  host.innerHTML = list.map(renderOne).join('');
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

  const head = list.length > 1
    ? `已生成 ${list.length} 份　·　${picked.from}`
    : `已生成：${list[0].no || '(无编号)'}　·　${picked.from}`;
  setStatus(missing.length ? `${head}；这些字段在当前表里找不到：${missing.join('、')}` : head,
            missing.length > 0);
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
    period: await text(FIELDS.period),
    photos: await urls(FIELDS.photos),
  };
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

const BUILD = '2026-08-31e';

/* 脱离飞书直接打开时（本地调版式用），SDK 不会就绪，显示样例数据 */
const OFFLINE_SAMPLE = [{
  no: 'SAMPLE-001',
  project: '（样例）某某建设工程项目',
  unit: '（样例）某某劳务分包有限公司',
  hazard: '（样例）××部位安全防护缺失，不符合规范要求。',
  require: '（样例）限期整改到位并经验收；整改期间设置警戒区。',
  owner: '（样例）张三',
  period: '2026-01-01',
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
