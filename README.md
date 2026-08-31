# Lark Base 记录打印插件

一个 Lark Base（多维表格）前端扩展：选中一条记录，按固定版式排版成 A4 单据，直接打印或导出 PDF。

## 为什么不用现成的排版打印插件

通用模板编辑器让每个使用者自己拖版式，代价是：

- 模板导出不可靠（字段元素会丢）
- 模板存在使用者本地，不随表共享——N 个人各配一遍，版式必然不统一
- 拖拽定位精度差，改版要重拖

本插件把**版式写死在代码里**：不用配、不用分发，改一次重新部署，所有人下次打开就是新版。

## 特点

- **纯前端**，无后端、无数据库
- **不需要 API 授权**：Base 前端扩展的权限跟随执行者本人，读的是使用者自己有权限看的数据
- 版式尺寸按 A4 精确定义（毫米级），表格页与附件页自动分页
- 附件图片一行两张，等比缩放不变形
- 脱离 Base 打开时显示样例数据，方便本地调版式

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
```

在 Base 右上角插件面板 →「自定义插件」→ 新增插件 → 填服务地址。

## 打印验证

不要在页面上点打印按钮做自动化验证（会拉起系统对话框）。用 headless Chrome：

```bash
npm run build && npx vite preview --port 4173 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --no-pdf-header-footer --virtual-time-budget=8000 \
  --print-to-pdf=out.pdf http://localhost:4173/
```

## 改成你自己的版式

- 字段映射：`src/main.js` 顶部的 `FIELDS`，左边是单据上的位置，右边是表里的字段名
- 版式：`src/main.js` 的 `render()` 是表格结构，`src/style.css` 是尺寸
- 列宽行高：`style.css` 里 `table.form` 及 `tr.r0`–`tr.r7`，全部用 mm 定义

## License

MIT
