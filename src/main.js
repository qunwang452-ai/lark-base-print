import { bitable } from '@lark-base-open/js-sdk';
import QRCode from 'qrcode';

/* 字段映射：左边是单据上的位置，右边是「隐患整改台账」里的字段名。
   换表或改字段名时只动这里。
   🔴 字段名写错不会报错，只会打出空白栏 —— 09-07 就是这么白开了一批单：
   「整改方案」「责任人」台账里根本没有，真名是「整改措施」「负责人」。
   改这里之前先 `lark-cli base +field-list` 对一遍真实字段名。 */
const FIELDS = {
  no: '整改单编号',
  /* 🔴 考核单要单独一个编号字段 —— 一条隐患可能同时开整改单和考核单，
     共用一个字段会互相覆盖。台账里若还没建这个字段，考核单编号栏留空。 */
  noKh: '考核单编号',
  project: '所在项目',
  unit: '责任单位',
  hazard: '隐患描述',
  require: '整改措施',
  owner: '负责人',
  period: '要求完成整改时间',
  photos: '整改前图片',
  /* 违反条款有两个来源，按顺序取：
     ① 「对照标准条目」link —— 人工选定的，顺着 link 跨表读清单表
     ② 「AI初判结果」 —— link 为空时兜底，序号和条目原文都在这段文本里，不必回表查
     🔴 台账里不加 lookup 列，Base 结构一个字不动。 */
  standard: '对照标准条目',
  aiHint: 'AI初判结果',
  /* 违约事件叙述要用：时间＋地点＋人物＋违章 */
  checkDate: '检查日期',
  place: '现场位置',
  /* 整改回执二维码的目标：台账里的 formula 字段，内容是这条隐患专属的表单链接
     （编号已预填）。链接怎么拼在公式里定义，插件只负责印出来，不在这拼字符串——
     否则改一次链接要改两处。 */
  receipt: '整改回执链接',
};

/* ── 整改回执二维码 ────────────────────────────────────────
   分包扫单子上的码 → 打开「隐患整改回执」表单 → 传整改后照片 → 自动写回台账。

   🔴 只印在整改单（AQ-05）上。考核单是罚款通知，不需要回传照片。

   🔴 一张单合并了多条隐患时印的是**通用码**（不带编号预填），因为一个码只能指一条。
      此时分包必须自己抄编号，抄错就挂不上台账 —— 所以合并开单时码下方会多一行提示。
      要让分包省掉抄编号这一步，就一条隐患开一张单。

   🔴 官方坑：想用飞书分享面板里的二维码是不行的 —— 那个码不带预填参数。
      必须自己按带参数的链接生成码，也就是这里做的事。 */
const RECEIPT_FORM_URL =
  'https://ajptfmp8hncz.jp.larksuite.com/share/base/shrjpi7WmenLVeKV6JyXainn5jd';

/* 生成二维码，返回 PNG 的 dataURL。渲染函数是同步的，所以码必须在读数据阶段就备好。

   🔴 用 PNG 不用 SVG：qrcode 的 SVG 是用 **stroke 描边**画模块的，缩放到 mm 尺寸后
   打印/光栅化会在模块边界产生抗锯齿灰边，**肉眼看完全正常、解码器一个都认不出**。
   09-08 实测：同一条链接，库直出 PNG 能解，走 SVG 渲染进 PDF 后 300dpi 都解不出。
   位图没有这个问题 —— 生成 600px 再缩到 22mm 显示，打印够清晰。

   🔴 margin 是 QR 规范要求的静区（quiet zone），单位是**模块**不是像素，必须留 4。
   errorCorrectionLevel 用 M：单据会被复印、可能沾灰，L 容错太低。 */
async function makeQr(text) {
  try {
    /* 🔴 width 要对准打印尺寸（22mm @300dpi ≈ 260px），不能贪大。
       09-08 实测：生成 600px 再由 CSS 缩到 22mm，缩小重采样会把模块边界糊掉，
       打出来肉眼没问题、解码器全军覆没。配合 CSS 的 image-rendering:pixelated
       让浏览器不做平滑插值。 */
    return await QRCode.toDataURL(text, {
      margin: 4, errorCorrectionLevel: 'M', width: 260,
    });
  } catch {
    return '';
  }
}

/* 合并开单时用的通用码，全局只生成一次 */
let genericQr = '';

/* 给每条记录挂上二维码，并备好通用码。renderAll 之前必须调用。 */
async function attachQr(list) {
  if (!genericQr) genericQr = await makeQr(RECEIPT_FORM_URL);
  for (const d of list) {
    /* 🔴 链接算不出来时回落到通用码，而不是不印码 —— 单子发出去了才发现
       没法回传就太晚了。回落时同样标 qrGeneric，让「须自行填隐患编号」那行出来，
       否则分包不填编号，回执挂不上台账。 */
    d.qr = d.receipt ? await makeQr(d.receipt) : genericQr;
    d.qrGeneric = !d.receipt;
  }
}

/* ── 整改单编号 ──────────────────────────────────────────────
   格式 `ZG-<项目编号>-<年><3位流水>`，例 `ZG-07-26001`（09-07 王群定）。

   | 段 | 取值 | 为什么 |
   |---|---|---|
   | ZG | 整改单；考核单是 KH | 🔴 王群定：考核单与处罚单是同一种单据，一律称考核单 |
   | 项目编号 | 01–10 | 项目信息表里现成的，不另造英文缩写 |
   | 年 | 26 | 跨年重置流水，否则三年后变五位 |
   | 流水 | 001–999 | **按项目 ＋ 年度独立计数**，不是全库连续 |

   🔴 与 `D06` 原先记的「整改单编号全局连续」不同 —— 09-07 改为按项目独立，
   因为 10 个项目各自对分包开单、各自归档，全局连续时项目内会跳号没法查。

   🔴 **何时生成**：点「生成编号」按钮时，不是隐患录入时 ——
   不是每条隐患都开单（II 级以上才开），录入即编号会大量占空号。
   已有编号的记录**不会重新生成**（幂等），重复打印同一张单编号不变。 */
const ORDER = {
  projTable: '项目信息表',
  projCode: '项目编号',
  width: 3,
  /* 整改单 ZG-07-26001 ／ 考核单 KH-07-26001，各自独立走号 */
  zg: { prefix: 'ZG', field: '整改单编号', label: '整改单' },
  kh: { prefix: 'KH', field: '考核单编号', label: '考核单' },
};

/* 清单表里要读的字段，和单据上「违反条款」那行的出处表述。
   🔴 出处 = 中冶南方政〔2026〕131 号《中冶南方安全检查隐患考核实施细则》，
   Base 的「隐患考核标准清单」345 条即出自该文（见 D08 一）。
   改这里之前先回原件核对文号与附件号——这行要印在正式单据上。 */
const STD = {
  table: '隐患考核标准清单',
  no: '清单序号',
  content: '隐患内容',
  source: '《中冶南方安全检查隐患考核实施细则》（中冶南方政〔2026〕131号）',
};

/* ── 考核单（CCEPC-PM-AQ-28《环境、职业健康安全条款违约金通知单》）──────
   🔴 数据源同样是**隐患整改台账**，不是处罚单台账 ——
   处罚单台账是开完单之后形成的结果记录，拿它当源头等于用结果生成原因（09-07 王群纠正）。
   一条隐患既可能开整改单、也可能开考核单，两张单共用一次选中。

   🔴 考核单比整改单多一套引用：
     一、安全隐患依据  ← 对照标准条目 → 隐患考核标准清单（说明违反了什么，同整改单）
     二、合同违约条款  ← 违章条目   → 分包违约处罚对照表（说明凭什么扣钱，签字合同附件）
   缺第二套 = 没有扣款依据，单子站不住 —— 所以开考核单**强制要求**选了违章条目。

   🔴 版面宽度用**整改单的 158.9mm**，不是 AQ-28 原件的 150.3mm（09-07 王群定：
   「参考通知单的大小」），两种单据摆在一起才整齐。列宽按 150.3→158.9 等比放大。 */
const PENALTY = {
  clauseField: '违章条目',          // link → 分包违约处罚对照表
  amountField: '考核金额',          // number，实际扣款额，开单前必填
  peopleField: '违章人员姓名',      // formula，多人用、拼接
  refTable: {
    item: '违章情形',
    no: '协议书序号',
    money: '处罚金额',
  },
  source: '《职业健康安全、环境管理协议书》附表2',
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

/* 上次读到的表与选中记录，「生成整改单编号」按钮要用。
   🔴 必须在 load() 之前声明 —— let 有暂时性死区，声明写在文件末尾的话
   load() 里赋值会抛 ReferenceError，而且是运行时才炸，构建查不出来。 */
let ctx = null;
let lastList = [];

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
        <colgroup><col style="width:300px" /><col style="width:300px" /></colgroup>
        <tr><td class="attach-head" colspan="2">
          附件：隐患照片${(() => {
            /* 🔴 编号要跟着当前单据类型取：考核单打印时 d.no（整改单编号）是空的，
               照抄会印出一个没有编号的附件页标题 */
            const n = docType === 'kh' ? d.noKh : d.no;
            return n ? `（编号 ${esc(n)}）` : '';
          })()}
        </td></tr>
        ${rows.join('')}
      </table>
    </div>`;
}

function renderOne(d) {
  const checkboxes = DEPTS.map((n) => `▢${n}`).join('&nbsp;&nbsp;');

  /* 整改回执二维码：绝对定位挂在编号行右侧，**不占流式高度** ——
     🔴 这是故意的：单据版面按 mm 排到 A4 满格，「存在安全隐患」栏一页只装得下
     CONTENT_LIMIT 字。二维码若参与流式布局会往下挤，那个字数边界就得重测。 */
  /* 🔴 说明文字排在码的**左侧**而不是下方：标题区到表格顶只有 ~23mm，
     文字放下方会溢进表格第一行的「合同号」格里（09-08 出图实测）。 */
  const qrHtml = d.qr
    ? `<span class="qr-badge">
         <span class="qr-caps">
           <span class="qr-cap">扫码上传<br/>整改照片</span>
           ${d.qrGeneric ? '<span class="qr-cap qr-warn">须自行填<br/>隐患编号</span>' : ''}
         </span>
         <span class="qr-img"><img src="${d.qr}" alt="整改回执二维码" /></span>
       </span>`
    : '';

  /* 第一页：单据本体。列宽用 colgroup 锁死，与模板 tblGrid 一致 */
  const page1 = `
    <div class="page">
      <p class="doc-title">安全隐患通知(整改)单</p>
      <p class="doc-subtitle">（CCEPC-PM-AQ-05）</p>
      <p class="doc-no">编号：${esc(d.no)}${qrHtml}</p>
      <table class="form">
        <colgroup>
          <col style="width:118px" /><col style="width:108px" />
          <col style="width:102px" /><col style="width:100px" />
          <col style="width:73px" /><col style="width:99px" />
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
            <div class="block-inner">
              <div class="block-fill">
                <span class="block-head">存在安全隐患：</span>
                <span class="block-body">${esc(d.hazard)}</span>
                ${legalHtml(d)}
              </div>
              <div class="sign-row"><span>签发人：</span><span>日&emsp;期：</span></div>
            </div>
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
            <div class="block-inner">
              <div class="block-fill"><span class="block-head">审核意见：</span></div>
              <!-- 项目部（章）单独一行、压在项目负责人正上方：
                   盖章时公章要压住项目经理签名 -->
              <div class="sign-stamp"><span>项目部（章）：</span></div>
              <div class="sign-row"><span>项目负责人：</span><span>日&emsp;期：</span></div>
            </div>
          </td>
        </tr>
        <tr class="r7">
          <td class="block" colspan="6">
            <div class="block-inner">
              <div class="block-fill"><span class="block-head">复查结果记录：</span></div>
              <div class="sign-row"><span>复查人：</span><span>日&emsp;期：</span></div>
            </div>
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

/* 「存在安全隐患」格一页能装多少字 —— 🔴 headless Chrome 打 PDF 逐档实测的边界，
   不是按行高估算的（估算会高估，09-07 一度报成 320 字，实测只有 260）：
     250 字 → 2 页 ✅ ／ 280 字 → 3 页 ❌（第一页空白、表被推走）
   注意这个值与 r3 行高设多大无关：总容量由页面总可用高度决定，
   r3=68.3 和 r3=82 实测都是 250 ✅／270~280 ❌，加大 r3 只是把余量从页底挪进格内。

   按内容字数判断而不是按条数 —— 有条款的隐患约 130 字/条、没条款的约 40 字/条，
   差三倍，只数条数会误判。 */
const CONTENT_LIMIT = 250;

/* ── 考核单版面（CCEPC-PM-AQ-28）────────────────────────────
   栏位照原件：项目名称/合同编号 → 供应商名称 → 违约事件及合同违约条款 →
   扣除违约金结果 → 项目经理审核意见 → 上传平台扣款情况 → 注。
   列宽 150.3→158.9 等比放大：24.4/80.1/27.3/18.5 → 25.8/84.7/28.9/19.5 */
function renderPenalty(d) {
  const p = d.penalty;
  const twoRefs = `
    ${d.clause ? `<div class="ref-block">
        <div class="ref-head">一、安全隐患依据</div>
        <div class="ref-body">${esc(d.clause)}</div>
      </div>` : ''}
    ${p ? `<div class="ref-block">
        <div class="ref-head">二、合同违约条款</div>
        <div class="ref-body">${esc(p.item)}
——${PENALTY.source}${p.no ? ` 第 ${esc(p.no)} 条` : ''}${p.money ? `　违约金 ${esc(p.money)}` : ''}</div>
      </div>` : ''}`;

  const page1 = `
    <div class="page">
      <p class="doc-title">环境、职业健康安全条款违约金通知单</p>
      <p class="doc-subtitle">（CCEPC-PM-AQ-29）</p>
      <p class="doc-no">编号：${esc(d.noKh)}</p>
      <table class="form kh">
        <colgroup>
          <col style="width:112px" /><col style="width:276px" />
          <col style="width:108px" /><col style="width:104px" />
        </colgroup>
        <tr class="k0">
          <td class="label">项目名称</td>
          <td class="val">${esc(d.project || DEFAULT_PROJECT)}</td>
          <td class="label">合同编号</td>
          <td class="val"></td>
        </tr>
        <tr class="k1">
          <td class="label">供应商名称</td>
          <td class="val" colspan="3">${esc(d.unit)}</td>
        </tr>
        <tr class="k2">
          <td class="block" colspan="4">
            <div class="block-inner">
              <div class="block-fill">
                <span class="block-head">违约事件及合同违约条款：</span>
                <span class="block-body">${esc(buildEvent(d))}</span>
                ${twoRefs}
              </div>
            </div>
          </td>
        </tr>
        <tr class="k3">
          <td class="block" colspan="4">
            <span class="block-head">扣除违约金结果：</span>
            <span class="block-body">${d.amount ? `基于上述事实及合同约定，经项目部研究决定，对贵单位作出如下处理：
处以违约金人民币 ${esc(d.amount)} 元（大写：${esc(rmbUpper(d.amount))}）${
  d.people ? `，涉事人员：${esc(d.people)}` : ''}。该款项将从贵单位当月工程进度款中直接扣除。
如贵单位再次发生同类事件，项目部将依据合同加倍处罚，并同步追究贵单位现场管理人员的连带管理责任。` : ''}</span>
          </td>
        </tr>
        <tr class="k4">
          <td class="block" colspan="4">
            <div class="block-inner">
              <div class="block-fill"><span class="block-head">项目经理审核意见：</span></div>
              <!-- 四个签字位，两两成对：照实际发出的单据（CCEPC-KPN-AQWY180/187）。
                   审批链见单末「注」：安全工程师出具 → 安全生产监督管理部、标段项目经理
                   审核 → 项目部批准。 -->
              <div class="sign-grid">
                <div class="sg-cell"><div>安全工程师：</div><div>日&emsp;期：</div></div>
                <div class="sg-cell"><div>标段项目经理：</div><div>日&emsp;期：</div></div>
                <div class="sg-cell"><div>安全生产监督管理部：</div><div>日&emsp;期：</div></div>
                <div class="sg-cell"><div>项目部（章）：</div><div>日&emsp;期：</div></div>
              </div>
            </div>
          </td>
        </tr>
        <tr class="k5">
          <td class="block" colspan="4">
            <span class="block-head">上传平台扣款情况：</span>
            <span class="block-body">▢是　上传日期：　　年　　月　　日　　　▢否</span>
          </td>
        </tr>
        <tr class="k6">
          <td class="note" colspan="4">
            注：<br/>
            1、本表一式 2 份，由总包安全工程师出具，经安全生产监督管理部、标段项目经理审核，项目部批准后生效，
            纸质文件总包安监部、施工单位各存 1 份。本违约金通知单由施工单位统计提交至经营部，违约金从当月进度款中扣除。<br/>
            2、本违约金通知单扫描版（签字盖章后）同当周安全周报一并提交。
          </td>
        </tr>
      </table>
    </div>`;

  return page1 + (d.photos.length ? attachPage(d) : '');
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
    noKh: list[0].noKh,
    project: list[0].project,
    unit: list[0].unit,
    owner: list[0].owner,
    period: list[0].period,
    hazard: numbered('hazard'),
    require: numbered('require'),
    /* 多条隐患引同一条款时只印一遍（09-07 王群：「引用的法条一样就不用重复录入」）。
       🔴 编号看的是**去重之后**还剩几条，不是原始隐患条数：
       3 条隐患都违反第 154 条 → 去重后只剩 1 条 → 直接印，不带「1.」这种孤零零的编号。 */
    clause: (() => {
      const uniq = [...new Set(list.map((d) => d.clause).filter(Boolean))];
      if (uniq.length <= 1) return uniq[0] || '';
      return uniq.map((c, i) => `${i + 1}. ${c}`).join('\n');
    })(),
    /* 🔴 考核单三件必须跟着合并结果走，漏了就印出一张没有扣款依据的单
       （09-07 第一版就漏了，版面上「二、合同违约条款」和「扣除违约金结果」全空）。
       违约条款取第 1 条（同责任单位/期限的处理），金额按各条求和。 */
    checkDate: list.map((d) => d.checkDate).find(Boolean) || '',
    place: [...new Set(list.map((d) => d.place).filter(Boolean))].join('、'),
    penalty: list.map((d) => d.penalty).find(Boolean) || null,
    amount: (() => {
      const nums = list.map((d) => parseFloat(d.amount)).filter((n) => Number.isFinite(n));
      return nums.length ? String(nums.reduce((a, b) => a + b, 0)) : '';
    })(),
    people: [...new Set(list.map((d) => d.people).filter(Boolean))].join('、'),
    photos,
    /* 🔴 合并单印通用码：一个码指不了多条隐患。分包得自己抄编号，
       所以 qrGeneric 置真，版面上会多印一行提示。 */
    qr: genericQr,
    qrGeneric: true,
  };
}

/* 当前单据类型：'zg' 整改单 ／ 'kh' 考核单。两种共用一次选中，切换即换版式。 */
let docType = 'zg';

function renderAll(list) {
  const d = mergeRecords(list);
  host.innerHTML = docType === 'kh' ? renderPenalty(d) : renderOne(d);
}

/* 「生成编号」按钮的文案与显隐：跟着当前单据类型走 */
function refreshNoButton() {
  const cfg = ORDER[docType];
  const key = docType === 'kh' ? 'noKh' : 'no';
  const lack = lastList.filter((d) => !d[key]).length;
  const btn = document.getElementById('btn-no');
  btn.hidden = lack === 0;
  btn.textContent = lack > 1
    ? `生成${cfg.label}编号（${lack} 条）`
    : `生成${cfg.label}编号`;
}

/* 开考核单的硬性前提（09-07 王群定）：
   ① 必须选了「违章条目」——没有合同违约条款就没有扣款依据，单子站不住
   ② 必须填了「考核金额」——对照表给的是标准（2000/人·次），实际扣多少要人定
   缺任一项就拦住，并说清缺什么，而不是印出一张缺依据的单。 */
function penaltyBlockers(list) {
  const miss = [];
  if (list.some((d) => !d.penalty)) miss.push('「违章条目」未选');
  if (list.some((d) => !d.amount)) miss.push('「考核金额」未填');
  return miss;
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

  /* 🔴 必须在 renderAll 之前：渲染是同步的，二维码得先备好 */
  await attachQr(list);
  lastList = list;
  renderAll(list);

  /* 记住这次的上下文，「生成整改单编号」按钮要用 */
  ctx = { table, byName, ids: picked.ids };
  refreshNoButton();

  const uniq = (k) => [...new Set(list.map((d) => d[k]).filter(Boolean))];
  const clash = ['unit', 'owner', 'period']
    .filter((k) => uniq(k).length > 1)
    .map((k) => ({ unit: '责任单位', owner: '整改责任人', period: '整改期限' }[k]));

  /* 按合并后「存在安全隐患」格的实际字数判断会不会挤爆分页 */
  const merged = mergeRecords(list);
  const chars = (merged.hazard || '').length + (merged.clause || '').length;
  const over = chars > CONTENT_LIMIT;
  const head = list.length > 1
    ? `已合并 ${list.length} 条隐患到一张单　·　${picked.from}`
      + (clash.length ? `；${clash.join('、')}各条不一致，已取第 1 条` : '')
    : `已生成：${list[0].no || '(无编号)'}　·　${picked.from}`;
  const warn = over
    ? `${head}；🔴 隐患栏共 ${chars} 字，超过一页可容的 ${CONTENT_LIMIT} 字，`
      + `打印会多出一张空白页 —— 建议拆成多张单`
    : head;
  setStatus(missing.length ? `${warn}；这些字段在当前表里找不到：${missing.join('、')}` : warn,
            missing.length > 0 || clash.length > 0 || over);
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
    noKh: await text(FIELDS.noKh),
    project: await text(FIELDS.project),
    unit: await text(FIELDS.unit),
    hazard: await text(FIELDS.hazard),
    require: await text(FIELDS.require),
    owner: await text(FIELDS.owner),
    /* 要求完成整改时间常空，回落到按细则自动算的建议整改期限 */
    period: (await text(FIELDS.period)) || (await text(PERIOD_FALLBACK)),
    clause: await readClause(table, byName, recordId),
    photos: await urls(FIELDS.photos),
    /* 考核单专用：合同违约条款 ＋ 实际扣款额 ＋ 违章人员 */
    checkDate: fmtDate(await text(FIELDS.checkDate)),
    place: await text(FIELDS.place),
    penalty: await readPenaltyClause(table, byName, recordId),
    amount: await text(PENALTY.amountField),
    people: await text(PENALTY.peopleField),
    /* 整改回执链接（formula 字段，getCellString 能直接读出文本） */
    receipt: await text(FIELDS.receipt),
  };
}

/* 违反条款：条目内容 ＋ 条款号。
   两个来源按顺序取：① 人工选的「对照标准条目」link ② 「AI初判结果」兜底。

   🔴 为什么 AI 的序号可以直接印、不标「待核」：
   打印这个动作本身就是人工核定 —— 安全员看过隐患、决定开单才会来打印，
   09-07 王群定。所以两个来源在单据上不做区分。
   （这不违反「AI 只归类不判级」：等级仍由「对照标准条目」lookup 带出，
   这里只是取条款号印在单子上，不参与定级。） */
async function readClause(table, byName, recordId) {
  const fromLink = await clauseFromLink(table, byName, recordId);
  if (fromLink) return fromLink;
  return clauseFromAI(await textOf(table, byName, FIELDS.aiHint, recordId));
}

async function textOf(table, byName, name, recordId) {
  const m = byName.get(name);
  if (!m) return '';
  try {
    return (await table.getCellString(m.id, recordId)) || '';
  } catch {
    return '';
  }
}

/* 来源①：顺着 link 跨表读清单表的「清单序号」+「隐患内容」 */
async function clauseFromLink(table, byName, recordId) {
  const meta = byName.get(FIELDS.standard);
  if (!meta) return '';
  try {
    const link = linkOf(await table.getCellValue(meta.id, recordId));
    if (!link) return '';

    const stdTable = await bitable.base.getTableById(link.tableId);
    const stdMeta = new Map((await stdTable.getFieldMetaList()).map((m) => [m.name, m]));
    const noId = stdMeta.get(STD.no)?.id;
    const contentId = stdMeta.get(STD.content)?.id;

    const parts = [];
    for (const rid of link.recordIds) {
      const no = noId ? await stdTable.getCellString(noId, rid) : '';
      const content = contentId ? await stdTable.getCellString(contentId, rid) : '';
      parts.push(fmtClause(content, no));
    }
    return parts.filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

/* 来源②：从「AI初判结果」文本里解析序号和条目原文。
   实测只有这四种写法（09-07 全表导出核对）：
     a) 'I级 [232] 1、基坑周边堆载超过设计允许值…'
     b) 'AI建议对照清单第 41 条 · 临时用电｜…（I级）\n条目原文：1、未采用三级配电…\n\n这会定成…'
     c) 'AI在清单里没有找到对应条目 → …'      ← 无序号，不出这一行
     d) 'III级 一般及轻微隐患'                ← 无序号，同上 */
function clauseFromAI(ai) {
  if (!ai) return '';

  const a = ai.match(/\[(\d+)\]\s*([\s\S]+)/);
  if (a) return fmtClause(a[2].trim(), a[1]);

  const b = ai.match(/清单第\s*(\d+)\s*条/);
  if (b) {
    const body = ai.match(/条目原文：([\s\S]*?)(?:\n\s*\n|$)/);
    return fmtClause(body ? body[1].trim() : '', b[1]);
  }
  return '';
}

/* ── 生成整改单编号 ──────────────────────────────────────── */

/* 🔴 link 字段的 cell value 是**对象**不是数组（SDK 的 IOpenLink）：
     { text, type, recordIds: string[], tableId, record_ids, table_id }
   09-07 我按数组写成 `Array.isArray(cell) ? cell[0] : 返回空`，
   结果三处读 link 的地方全都静默失败 —— 整改单的「违反条款」自上线起就没印出来过，
   因为 catch 之后返回空串、不报错，版面上只是少一段，没人看得出来。
   旧版本 SDK 可能返回数组，两种都兜住。 */
function linkOf(cell) {
  const o = Array.isArray(cell) ? cell[0] : cell;
  if (!o) return null;
  const tableId = o.tableId || o.table_id;
  const ids = o.recordIds || o.record_ids || (o.recordId ? [o.recordId] : []);
  if (!tableId || !ids.length) return null;
  return { tableId, recordIds: ids, text: o.text || '' };
}

/* 顺着「所在项目」link 读出项目编号（01–10） */
async function readProjectCode(table, byName, recordId) {
  const meta = byName.get(FIELDS.project);
  if (!meta) return '';
  try {
    const link = linkOf(await table.getCellValue(meta.id, recordId));
    if (!link) return '';
    const rid = link.recordIds[0];
    const pt = await bitable.base.getTableById(link.tableId);
    const pm = new Map((await pt.getFieldMetaList()).map((m) => [m.name, m]));
    const codeId = pm.get(ORDER.projCode)?.id;
    return codeId ? (await pt.getCellString(codeId, rid) || '').trim() : '';
  } catch {
    return '';
  }
}

/* 算该项目该年度的下一个流水号。
   🔴 扫全表的「整改单编号」列取最大值，而不是数记录条数 ——
   数条数在删过记录后会重号，取最大值不会。 */
async function nextOrderNo(table, byName, projCode, kind = 'zg') {
  const cfg = ORDER[kind];
  const yy = String(new Date().getFullYear()).slice(2);
  const prefix = `${cfg.prefix}-${projCode}-${yy}`;
  const noMeta = byName.get(cfg.field);
  if (!noMeta) throw new Error(`表里没有「${cfg.field}」字段`);

  const ids = await table.getRecordIdList();
  let max = 0;
  for (const rid of ids) {
    let v = '';
    try { v = (await table.getCellString(noMeta.id, rid)) || ''; } catch { continue; }
    if (!v.startsWith(prefix)) continue;
    const n = parseInt(v.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(ORDER.width, '0');
}

/* 给当前选中的记录生成并写回编号。已有编号的跳过（幂等）。 */
async function assignOrderNos(table, byName, recordIds, kind = 'zg') {
  const cfg = ORDER[kind];
  const noMeta = byName.get(cfg.field);
  if (!noMeta) throw new Error(`表里没有「${cfg.field}」字段`);
  const done = [];
  for (const rid of recordIds) {
    const cur = (await table.getCellString(noMeta.id, rid) || '').trim();
    if (cur) { done.push({ rid, no: cur, skipped: true }); continue; }
    const code = await readProjectCode(table, byName, rid);
    if (!code) {
      /* 🔴 带上实际读到的结构 —— 09-07 就是因为报错信息里没有它，
         我把 SDK 的 link 结构猜错了还查了半天 */
      let raw = '(读不到)';
      try {
        const m = byName.get(FIELDS.project);
        raw = JSON.stringify(await table.getCellValue(m.id, rid)).slice(0, 200);
      } catch (e) { raw = `读取异常 ${e?.message || e}`; }
      throw new Error(
        `取不到项目编号。「所在项目」原始值 = ${raw}；`
        + `请确认该记录已选所在项目，且项目信息表里有「${ORDER.projCode}」字段`
      );
    }
    const no = await nextOrderNo(table, byName, code, kind);
    await table.setCellValue(noMeta.id, rid, no);
    done.push({ rid, no, skipped: false });
  }
  return done;
}

/* 违约事件叙述 —— 🔴 不是直接甩隐患描述，要按「时间＋地点＋人物＋违章」组合
   （09-07 王群要求，句式照搬台账里已有 29 张单的人工写法）：

     2026年8月22日现场检查发现，贵单位在2#龙门吊进行吊装烟风道翻转作业，
     因指挥人员选择钢丝绳过长……，此前我单位已多次宣贯，贵单位仍未贯彻执行，安全管理未履职。

   缺哪段就跳过哪段，不留「在，」这种断头标点。 */
const EVENT_TAIL = '此前我单位已多次宣贯，贵单位仍未贯彻执行，安全管理未履职。';

/* Base 的日期读出来是 2026/08/26 这类，单据上要写成「2026年8月26日」 */
function fmtDate(v) {
  const m = String(v || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : '';
}

function buildEvent(d) {
  const fact = (d.hazard || '').trim().replace(/[。．.]$/, '');
  if (!fact) return '';

  /* 语序照范本：贵单位 ＋ 作业人员X ＋ 在Y ＋ ，违章事实
     （范本第2条「贵单位作业人员在2#龙门吊开展焊接作业过程中，梯子使用不规范」）
     🔴 「贵单位」后面不能直接跟逗号 —— 第一版写成「贵单位，配电箱接线杂乱」，不通。 */
  let who = '贵单位';
  if (d.people) who += `作业人员${d.people}`;
  if (d.place) who += `在${d.place}`;
  const sep = who === '贵单位' ? '' : '，';

  const when = d.checkDate ? `${d.checkDate}现场检查发现，` : '现场检查发现，';
  return `${when}${who}${sep}${fact}。${EVENT_TAIL}`;
}

/* 人民币金额转中文大写 —— 正式单据上要大写（09-07 王群要求）。
   规则按《正确填写票据和结算凭证的基本规定》：
   数字 零壹贰叁肆伍陆柒捌玖，单位 拾佰仟万亿，末尾补「整」。 */
function rmbUpper(input) {
  const n = Number(String(input).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return '零元整';

  const D = '零壹贰叁肆伍陆柒捌玖';
  const U = ['', '拾', '佰', '仟'];
  const G = ['', '万', '亿', '万亿'];

  const yuan = Math.floor(n);
  const cents = Math.round((n - yuan) * 100);

  /* 整数部分按四位一组，组内补单位，组间补万/亿 */
  let out = '';
  let groups = [];
  let rest = yuan;
  while (rest > 0) { groups.push(rest % 10000); rest = Math.floor(rest / 10000); }
  if (!groups.length) groups = [0];

  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const g = groups[gi];
    let seg = '';
    let zero = false;
    for (let i = 3; i >= 0; i--) {
      const digit = Math.floor(g / Math.pow(10, i)) % 10;
      if (digit === 0) {
        zero = seg !== '';
      } else {
        if (zero) seg += D[0];
        seg += D[digit] + U[i];
        zero = false;
      }
    }
    if (!seg) continue;
    /* 🔴 组间补零：高位组已有内容、而本组不足四位（最高位是 0）时要补「零」，
       否则 10001 会写成「壹万壹元」这种在票据上不成立的写法。 */
    if (out && g < 1000) out += D[0];
    out += seg + G[gi];
  }
  out = out.replace(/零+$/, '') || D[0];

  /* 角分 */
  if (cents === 0) return `${out}元整`;
  const jiao = Math.floor(cents / 10);
  const fen = cents % 10;
  let tail = '';
  if (jiao) tail += D[jiao] + '角';
  else if (fen) tail += D[0];
  if (fen) tail += D[fen] + '分';
  return `${out}元${tail}`;
}

/* 读「违章条目」→ 分包违约处罚对照表，取出合同违约条款（考核单第二套引用）。
   返回 {item, no, money}；没选违章条目返回 null —— 调用方据此拦住开单。 */
async function readPenaltyClause(table, byName, recordId) {
  const meta = byName.get(PENALTY.clauseField);
  if (!meta) return null;
  try {
    const link = linkOf(await table.getCellValue(meta.id, recordId));
    if (!link) return null;
    const rid = link.recordIds[0];
    const rt = await bitable.base.getTableById(link.tableId);
    const rm = new Map((await rt.getFieldMetaList()).map((m) => [m.name, m]));
    const get = async (name) => {
      const id = rm.get(name)?.id;
      return id ? ((await rt.getCellString(id, rid)) || '').trim() : '';
    };
    return {
      item: await get(PENALTY.refTable.item),
      no: await get(PENALTY.refTable.no),
      /* 🔴 金额原样取文本，不转数字 ——
         对照表里是「2000/项」「2000/人·次」这种，计费方式本身就是依据的一部分 */
      money: await get(PENALTY.refTable.money),
    };
  } catch {
    return null;
  }
}

/* 单据上的呈现：条目内容在前，条款号在后（09-07 王群定） */
function fmtClause(content, no) {
  const tail = no ? `——${STD.source}第 ${no} 条` : '';
  if (!content) return tail;
  return tail ? `${content}\n${tail}` : content;
}

document.getElementById('btn-print').onclick = () => {
  docType = 'zg';
  renderAll(lastList);
  refreshNoButton();
  window.print();
};

document.getElementById('btn-print-kh').onclick = () => {
  const miss = penaltyBlockers(lastList);
  if (miss.length) {
    setStatus(`开考核单前必须先补齐：${miss.join('、')} —— 请在台账里填好再来`, true);
    return;
  }
  docType = 'kh';
  renderAll(lastList);
  refreshNoButton();
  window.print();
};
document.getElementById('btn-reload').onclick = () => load().catch(onErr);

/* 🔴 全插件唯一一处写 Base 的地方，且只在用户点这个按钮时执行。
   打印不写数据 —— 免得预览一下就把编号占掉。 */
document.getElementById('btn-no').onclick = async () => {
  if (!ctx) return;
  const btn = document.getElementById('btn-no');
  btn.disabled = true;
  setStatus('生成编号中…');
  try {
    const done = await assignOrderNos(ctx.table, ctx.byName, ctx.ids, docType);
    const made = done.filter((d) => !d.skipped).map((d) => d.no);
    const kept = done.filter((d) => d.skipped).length;
    setStatus(
      (made.length ? `已生成：${made.join('、')}` : '没有需要生成的')
      + (kept ? `；${kept} 条本来就有编号，未改动` : '')
      + '　·　正在刷新…'
    );
    await load();
  } catch (e) {
    onErr(e);
  } finally {
    btn.disabled = false;
  }
};

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

const BUILD = '2026-09-08a';

/* 版本号常驻工具条 —— 排查「线上到底更新没有」时第一眼就能看到 */
document.getElementById('build-tag').textContent = `build ${BUILD}`;

/* 脱离飞书直接打开时（本地调版式用），SDK 不会就绪，显示样例数据 */
const OFFLINE_SAMPLE = [{
  no: 'ZG-07-26001',
  noKh: 'KH-07-26001',
  project: '（样例）某某建设工程项目',
  unit: '（样例）某某劳务分包有限公司',
  hazard: '（样例）××部位安全防护缺失，不符合规范要求。',
  require: '（样例）限期整改到位并经验收；整改期间设置警戒区。',
  owner: '（样例）张三',
  period: '2026-01-01',
  clause: '1、高处作业人员未按规定系挂安全带。\n'
        + '——《中冶南方安全检查隐患考核实施细则》（中冶南方政〔2026〕131号）第 154 项',
  penalty: { item: '进入施工现场高处作业不按规定系挂安全带的',
             no: '1.2', money: '2000/人·次' },
  amount: '4000',
  people: '王子清、张三',
  receipt: 'https://ajptfmp8hncz.jp.larksuite.com/share/base/'
         + 'shrjpi7WmenLVeKV6JyXainn5jd?prefill_%E9%9A%90%E6%82%A3%E7%BC%96%E5%8F%B7=YH-20260831010',
  photos: [ph('样例照片 1'), ph('样例照片 2'), ph('样例照片 3')],
}, {
  no: 'ZG-07-26002',
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
const offlineTimer = setTimeout(async () => {
  if (!ready) {
    await attachQr(OFFLINE_SAMPLE);
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
