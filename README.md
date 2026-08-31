# Lark Base 记录打印插件

一个 Lark Base（多维表格）前端扩展：选中记录，按固定版式排版成 A4 单据，直接打印或导出 PDF。

## 为什么不用现成的排版打印插件

通用模板编辑器让每个使用者自己拖版式，代价是：

- 模板导出不可靠（Base 自带的「打印设计器」导出时，**字段元素会全部序列化成 `{}`**，只有静态文字能导出）
- 模板存在使用者本地、不随表共享——N 个人各配一遍，版式必然不统一
- 拖拽定位精度差，改版要重拖

本插件把**版式写死在代码里**：不用配、不用分发，改一次重新部署，所有人下次打开就是新版。

## 特点

- **纯前端**，无后端、无数据库
- **不需要 API 授权**：Base 前端扩展的权限跟随执行者本人，读的是使用者自己有权限看的数据
- 版式尺寸按 A4 精确定义（毫米级），单据页与附件页自动分页
- 附件图片一行两张，等比缩放不变形
- 脱离 Base 打开时显示样例数据，方便本地调版式

## 行为规则

**勾选多条记录 = 合并成「一张」单，不是一条一张。**
对应真实用法：一次检查发现的多个问题，给同一个责任方开一张单。

| 栏位 | 多条时怎么处理 |
|---|---|
| 主描述栏 / 要求栏 | 同一栏内逐条编号 `1. … 2. …` |
| 附件图片 | 全部汇总到附件页，每张标注「第 N 条 · 图 M」——不标注就认不出对应关系 |
| 单值字段（责任方、责任人、期限等） | 取第 1 条；各条不一致时状态栏提示「已取第 1 条」 |

## Base 里「选中」有两种，SDK 只认一种

这是开发时最容易踩的坑：

| 用户操作 | `bitable.base.getSelection()` |
|---|---|
| 点击单元格（光标激活） | `recordId` 有值 |
| **勾选行首复选框**（底部显示「已选择 N 条记录」） | **`recordId` 为空** |

用户更习惯勾选，但 SDK 默认只反映光标。只读 `getSelection().recordId` 会一直显示「未选中记录」，
看起来像插件坏了。必须回落：

```js
const view = await table.getViewById(sel.viewId);
const ids = await view.getSelectedRecordIdList();   // 仅表格视图有此方法
```

另一条经验：**出错时一定要把错误画在主体区域**。只更新角落的状态文字等于白屏，无从判断卡在哪。
本插件保留了诊断块——未选中记录时会显示 selection 原始返回、视图类型、SDK 方法是否存在、build 号，
排查时让现象自己说话。

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
```

在 Base 右上角插件面板 →「自定义插件」→ 新增插件 → 填服务地址。

## 打印验证

不要在页面上点打印按钮做自动化验证（会拉起系统对话框卡住）。用 headless Chrome：

```bash
npm run dev &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --no-pdf-header-footer --virtual-time-budget=9000 \
  --print-to-pdf=out.pdf http://localhost:5173/
pdfinfo out.pdf | grep Pages
```

## 改成你自己的版式

- **字段映射**：`src/main.js` 顶部的 `FIELDS`，左边是单据上的位置，右边是表里的字段名
- **版式结构**：`src/main.js` 的 `renderOne()`
- **尺寸**：`src/style.css` 里 `table.form` 及 `tr.r0`–`tr.r7`，全部用 mm 定义；
  取自原 Word 模板的 XML（`tblGrid` 列宽、`trHeight` 行高），不是目测
- **分页**：`.page + .page { page-break-before: always; }` 一条规则统管附件页和多份之间

## License

MIT
