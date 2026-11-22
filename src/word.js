/* ── 导出 Word（.docx）────────────────────────────────────────
   版式照搬插件的打印版（已确认过的格式，11-22 王群：「直接看插件里面的模板」），
   尺寸全部取自 style.css 的 mm 值，不另起炉灶。导出给人手工改措辞用，
   所以文字一律做成真段落（一行一段），不用文本框、不锁格式。

   🔴 签字行要压在格子底部：Word 里做不到「内容靠上、签字靠下」同一格，
      所以拆成上下两行，中间那条横线去掉 —— 看起来仍是一格。
   🔴 照片要拿到二进制才能嵌进 Word：fetch 附件临时链接，失败的照片
      在格子里写一句「照片未能载入」，不让整份导出失败。 */
import {
  AlignmentType, BorderStyle, Document, HeightRule, HorizontalPositionAlign, HorizontalPositionRelativeFrom,
  ImageRun, Packer, TextWrappingType, VerticalPositionRelativeFrom,
  Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';

const TW = (mm) => Math.round(mm * 56.6929);           // mm → twip
const EMU_PX = (mm) => Math.round((mm / 25.4) * 96);  // mm → px（ImageRun 用 px）
const FONT = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '宋体' };
const PT = (pt) => Math.round(pt * 2);                // pt → 半磅

const LINE = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

function run(text, { size = 12, bold = false } = {}) {
  return new TextRun({ text, bold, size: PT(size), font: FONT });
}

/* 多行文本 → 每行一段 */
function paras(text, { size = 12, bold = false, align, before = 0, after = 0, line = 300 } = {}) {
  const lines = String(text ?? '').split('\n');
  return lines.map((ln, i) => new Paragraph({
    alignment: align,
    spacing: { before: i === 0 ? before : 0, after: i === lines.length - 1 ? after : 0, line },
    children: [run(ln, { size, bold })],
  }));
}

function cell(children, { w, span = 1, v = VerticalAlign.TOP, borders } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    columnSpan: span,
    width: w ? { size: TW(w), type: WidthType.DXA } : undefined,
    verticalAlign: v,
    margins: { top: TW(1), bottom: TW(1), left: TW(1.4), right: TW(1.4) },
    borders: borders || { top: LINE, bottom: LINE, left: LINE, right: LINE },
  });
}

const row = (cells, h) => new TableRow({
  children: cells,
  height: h ? { value: TW(h), rule: HeightRule.ATLEAST } : undefined,
  cantSplit: true,
});

/* 「标签」格：10.5pt 居中 */
const label = (text, w) => cell(paras(text, { size: 10.5, align: AlignmentType.CENTER }),
  { w, v: VerticalAlign.CENTER });

function table(colsMm, rows) {
  return new Table({
    width: { size: TW(colsMm.reduce((a, b) => a + b, 0)), type: WidthType.DXA },
    columnWidths: colsMm.map(TW),
    layout: TableLayoutType.FIXED,
    rows,
  });
}

/* 上下拆成两行的「一格」：上行无下边框、下行无上边框 */
const TOP_PART = { top: LINE, bottom: NONE, left: LINE, right: LINE };
const BOTTOM_PART = { top: NONE, bottom: LINE, left: LINE, right: LINE };

/* 签字行照打印版 .sign-row：整行靠右，每个标签后留 22mm 手写区（12pt 全角字≈4.23mm，5 个全角空格≈21mm）。
   最后一个标签后面的 22mm 用右缩进给，不用尾随空格 —— Word 右对齐时会吞掉行尾空格。 */
const CH = 4.233;                       // 12pt 全角字宽 mm
const SIGN_GAP = '　　　　　';
const DASH = { style: BorderStyle.DASHED, size: 4, color: '000000', space: 3 };

function signLine(labels) {
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    indent: { right: TW(22) },
    spacing: { line: 300 },
    children: [run(labels.join(SIGN_GAP))],
  });
}

/* 「项目部（章）：」单独一行、左边与下一行「项目负责人：」对齐（公章要压在签名上，09-07 王群） */
function stampLine(text, under) {
  const underW = under.join(SIGN_GAP).length * CH;
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    indent: { right: TW(22 + underW - text.length * CH) },
    spacing: { line: 300 },
    children: [run(text)],
  });
}

function header(title, code, no) {
  return [
    ...paras(title, { bold: true, align: AlignmentType.CENTER }),
    ...paras(`（${code}）`, { align: AlignmentType.CENTER, before: 40 }),
  ].concat([new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [run(`编号：${no || ''}`)],
  })]);
}

/* dataURL / 附件链接 → {data, w, h, type}；失败返回 null */
async function loadImage(src) {
  try {
    const blob = await (await fetch(src)).blob();
    const bmp = await createImageBitmap(blob);
    const type = /png/i.test(blob.type) ? 'png' : /gif/i.test(blob.type) ? 'gif' : 'jpg';
    let data = new Uint8Array(await blob.arrayBuffer());
    let { width: w, height: h } = bmp;
    /* 非 jpg/png（如 heic、webp、svg）Word 不认，先画到 canvas 转 jpg */
    if (!/image\/(jpe?g|png|gif)/i.test(blob.type)) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0);
      const jb = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      data = new Uint8Array(await jb.arrayBuffer());
      return { data, w, h, type: 'jpg' };
    }
    return { data, w, h, type };
  } catch {
    return null;
  }
}

/* 等比缩进框（mm），返回 px 尺寸 */
function fit(img, boxW, boxH) {
  const k = Math.min(boxW / img.w, boxH / img.h);
  return { width: EMU_PX(img.w * k), height: EMU_PX(img.h * k) };
}

/* 附件照片页：一行两张，同 style.css（每格 79.45mm，照片高 62mm） */
async function attachSection(photos, no) {
  const half = 158.9 / 2;
  const cells = [];
  let fail = 0;
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const img = await loadImage(p.url || p);
    if (!img) fail++;
    cells.push(cell([
      img
        ? new Paragraph({ alignment: AlignmentType.CENTER,
            children: [new ImageRun({ type: img.type, data: img.data,
              transformation: fit(img, half - 4, 62) })] })
        : new Paragraph({ alignment: AlignmentType.CENTER, children: [run('（照片未能载入，请手动插入）', { size: 10.5 })] }),
      ...paras(p.cap || `照片 ${i + 1}`, { size: 10.5, align: AlignmentType.CENTER, before: 40 }),
    ], { w: half }));
  }
  if (cells.length % 2) cells.push(cell(new Paragraph(''), { w: half }));

  const rows = [row([cell(paras(`附件：隐患照片${no ? `（编号 ${no}）` : ''}`,
    { bold: true, align: AlignmentType.CENTER }), { w: 158.9, span: 2 })])];
  for (let i = 0; i < cells.length; i += 2) rows.push(row([cells[i], cells[i + 1]], 66));

  return { blocks: [table([half, half], rows)], fail };
}

/* ── 整改单 AQ-05：6 列 31.2/28.7/27.0/26.5/19.2/26.3mm ── */
async function zgDoc(d) {
  const C = [31.2, 28.7, 27.0, 26.5, 19.2, 26.3];
  const W = 158.9;
  const qr = d.qr ? await loadImage(d.qr) : null;

  const hazardCell = [
    ...paras('存在安全隐患：'),
    ...paras(d.hazard || '', { before: 40 }),
  ];
  if (d.clause) {
    /* 同打印版 .legal-box：细虚线隔开，「违反条款：」加粗后直接接第一行 */
    const [first, ...rest] = String(d.clause).split('\n');
    hazardCell.push(new Paragraph({
      spacing: { before: 120, line: 261 },
      border: { top: DASH },
      children: [run('违反条款：', { size: 9, bold: true }), run(first, { size: 9 })],
    }), ...rest.map((ln) => new Paragraph({ spacing: { line: 261 }, children: [run(ln, { size: 9 })] })));
  }

  const rows = [
    row([label('工程名称', C[0]),
      cell(paras(d.project || ''), { w: C[1] + C[2] + C[3], span: 3, v: VerticalAlign.CENTER }),
      label('合同号', C[4]), cell(new Paragraph(''), { w: C[5] })], 14.1),
    row([label('责任单位', C[0]),
      cell(paras(d.unit || ''), { w: W - C[0], span: 5, v: VerticalAlign.CENTER })], 11.6),
    row([label('责任部门', C[0]),
      cell(paras('□工程部　　□技术质量部　　□安监部　　□经营部\n□物资设备部　□办公室　　　□其他：', { size: 10.5 }),
        { w: W - C[0], span: 5, v: VerticalAlign.CENTER })], 9.9),
    row([cell(hazardCell, { w: W, span: 6, borders: TOP_PART })], 72),   // 打印版 86mm 含签字；Word 渲染比浏览器略高，留余量防翻页
    row([cell(signLine(['签发人：', '日　期：']), { w: W, span: 6, borders: BOTTOM_PART, v: VerticalAlign.BOTTOM })], 8),
    row([cell([...paras('整改要求：'), ...paras(d.require || '', { before: 40 })], { w: W, span: 6 })], 19.5),
    row([label('整改单位\n责任人', C[0]),
      cell(paras(d.owner || ''), { w: C[1], v: VerticalAlign.CENTER }),
      label('整改期限', C[2]),
      cell(paras(d.period || '', { size: 10.5 }), { w: C[3] + C[4] + C[5], span: 3, v: VerticalAlign.CENTER })], 12.9),
    row([cell(paras('审核意见：'), { w: W, span: 6, borders: TOP_PART })], 11),
    row([cell([stampLine('项目部（章）：', ['项目负责人：', '日　期：']), signLine(['项目负责人：', '日　期：'])],
      { w: W, span: 6, borders: BOTTOM_PART, v: VerticalAlign.BOTTOM })], 14),
    row([cell(paras('复查结果记录：'), { w: W, span: 6, borders: TOP_PART })], 12),
    row([cell(signLine(['复查人：', '日　期：']), { w: W, span: 6, borders: BOTTOM_PART, v: VerticalAlign.BOTTOM })], 8),
  ];

  const head = header('安全隐患通知(整改)单', 'CCEPC-PM-AQ-05', d.no);
  /* 二维码：同打印版，浮动挂在编号行右上方（伸到标题右侧空白处），不占流式高度，
     否则编号行被撑高 20mm，整张单挤到第二页（11-22 出样实测） */
  if (qr) {
    head.splice(head.length - 1, 1, new Paragraph({
      spacing: { before: 200, after: 80 },
      tabStops: [{ type: 'right', position: TW(W - 23) }],
      children: [run(`编号：${d.no || ''}`), new TextRun({ text: '\t' }),
        run(d.qrGeneric ? '扫码上传整改照片（须自行填隐患编号）' : '扫码上传整改照片', { size: 9 }),
        new ImageRun({ type: 'png', data: qr.data,
          transformation: { width: EMU_PX(21), height: EMU_PX(21) },
          floating: {
            horizontalPosition: { relative: HorizontalPositionRelativeFrom.MARGIN, align: HorizontalPositionAlign.RIGHT },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: -15 * 36000 },
            wrap: { type: TextWrappingType.NONE },
            allowOverlap: true,
          } })],
    }));
  }

  const body = [...head, table(C, rows)];
  const a = d.photos?.length ? await attachSection(d.photos, d.no) : null;
  return { body, attach: a?.blocks, fail: a?.fail || 0 };
}

/* ── 考核单：4 列 25.8/84.7/28.9/19.5mm ── */
async function khDoc(d, t) {
  const C = [25.8, 84.7, 28.9, 19.5];
  const W = 158.9;

  const L = 270;   // 考核单 12pt 正文行距：1.25 倍时「注」被挤到第 2 页（11-22 实测）
  const k2 = [...paras('违约事件及合同违约条款：', { line: L }), ...paras(t.event || '', { before: 40, line: L })];
  /* 同打印版 .ref-block：每套引用上面一条细虚线 */
  const refHead = (text) => new Paragraph({
    spacing: { before: 100, line: 280 }, border: { top: DASH },
    children: [run(text, { size: 10.5, bold: true })],
  });
  const refBody = (text) => String(text).split('\n').map((ln) =>
    new Paragraph({ spacing: { line: 261 }, children: [run(ln, { size: 9 })] }));
  if (d.clause) k2.push(refHead('一、安全隐患依据'), ...refBody(d.clause));
  if (t.ref) k2.push(refHead('二、合同违约条款'), ...refBody(t.ref));

  const signL = paras(`安全工程师：\n日　期：\n安全生产监督管理部：\n日　期：`, { line: L });
  const signR = paras(`标段项目经理：\n日　期：\n项目部（章）：\n日　期：`, { line: L });

  const rows = [
    row([label('项目名称', C[0]), cell(paras(d.project || ''), { w: C[1], v: VerticalAlign.CENTER }),
      label('合同编号', C[2]), cell(new Paragraph(''), { w: C[3] })], 11),
    row([label('供应商名称', C[0]), cell(paras(d.unit || ''), { w: W - C[0], span: 3, v: VerticalAlign.CENTER })], 11),
    row([cell(k2, { w: W, span: 4 })], 50),   // 打印版 70mm；Word 行高比浏览器大，70 会把「注」挤到第 2 页（11-22 实测）
    row([cell([...paras('扣除违约金结果：', { line: L }), ...paras(t.result || '', { before: 40, line: L })], { w: W, span: 4 })], 26),
    row([cell(paras('项目经理审核意见：', { line: L }), { w: W, span: 4, borders: TOP_PART })], 10),
    /* 四个签字位 2×2：外格一整格，里面套一张无框两列小表（4 列网格前后两半不等宽，直接拆格会一宽一窄） */
    row([cell([new Table({
      width: { size: TW(W - 6), type: WidthType.DXA },
      columnWidths: [TW((W - 6) / 2), TW((W - 6) / 2)],
      layout: TableLayoutType.FIXED,
      borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
      rows: [new TableRow({ children: [
        cell(signL, { w: (W - 6) / 2, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE } }),
        cell(signR, { w: (W - 6) / 2, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE } }),
      ] })],
    }), new Paragraph({ spacing: { line: 240 }, children: [run('', { size: 2 })] })], { w: W, span: 4, borders: BOTTOM_PART })], 28),
    row([cell(paras('上传平台扣款情况：\n□是　上传日期：　　年　　月　　日　　　□否', { line: L }), { w: W, span: 4 })], 12),
    row([cell(paras('注：\n'
      + '1、本表一式 2 份，由总包安全工程师出具，经安全生产监督管理部、标段项目经理审核，项目部批准后生效，'
      + '纸质文件总包安监部、施工单位各存 1 份。本违约金通知单由施工单位统计提交至经营部，违约金从当月进度款中扣除。\n'
      + '2、本违约金通知单扫描版（签字盖章后）同当周安全周报一并提交。', { size: 9, line: 261 }), { w: W, span: 4 })]),
  ];

  const body = [...header('环境、职业健康安全条款违约金通知单', 'CCEPC-PM-AQ-29', d.noKh), table(C, rows)];
  const a = d.photos?.length ? await attachSection(d.photos, d.noKh) : null;
  return { body, attach: a?.blocks, fail: a?.fail || 0 };
}

/* 生成 .docx 的 Blob。kind: 'zg' | 'kh'；t：考核单的拼好文字 {event, result, ref} */
export async function buildDocx(kind, d, t = {}) {
  const { body, attach, fail } = kind === 'kh' ? await khDoc(d, t) : await zgDoc(d);
  /* 🔴 附件页单独一节（节首自动换页），不用「分页符段落」：
     表格后面那个段落在第一页挤不下时会自己流到第二页再分页，多出一张空白页（11-22 出样实测） */
  const page = { page: {
    size: { width: TW(210), height: TW(297) },
    margin: { top: TW(20), bottom: TW(20), left: TW(25.55), right: TW(25.55) },
  } };
  const sections = [{ properties: page, children: body }];
  if (attach) sections.push({ properties: page, children: attach });
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: PT(12) } } } },
    sections,
  });
  return { blob: await Packer.toBlob(doc), fail };
}

/* 触发下载。🔴 Lark 插件跑在 iframe 里，若 iframe 没开 allow-downloads，
   <a download> 会被浏览器静默拦下 —— 拦没拦住 JS 侧看不出来，所以调用方
   要在状态栏提示「没出现下载就告诉我」，由人确认。 */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
