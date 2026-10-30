# MagReader · 杂志阅读器

像读书一样读 PDF 杂志：双页对开、卷页翻页动画、书脊阴影。纯本地离线运行，零运行时依赖。

![双页对开](docs/screenshot.png)
![亮色模式](docs/screenshot-light.png)

## 用法

**方式 A（推荐，带书架）**

```sh
python3 serve.py          # 默认端口 8666
# 浏览器打开 http://localhost:8666
```

把 PDF 放进 `books/` 目录，左侧"书架"就会出现，点开即读。自带 `magazine-test.pdf` 测试页，clone 下来立刻可试。

**方式 B（零依赖）**

直接双击 `index.html`，把 PDF 拖进窗口即可（没有书架列表，其余功能相同）。

## 功能

- 双页对开 + 真实卷页动画（拖拽页角 / 点击页面 / 滑动翻页）
- 封面单页展示（LTR 模式）
- 记住每本书的阅读进度与翻页方向（localStorage，按文件名+大小区分）
- 左侧缩略图栏，点击跳页
- RTL 模式：从右到左翻页（日漫/竖排杂志），动画和手势方向同步镜像
- 双击页面 → 高清放大浮层（滚轮缩放、拖拽平移）
- 亮色 / 暗色主题切换（☀️/🌙 按钮，默认跟随系统）
- 界面语言：简体中文 / 繁體中文 / English（默认跟随浏览器语言）
- 窗口窄时自动切单页模式

## 批注（划线 / 高亮 / 笔记）

- ▮ **高亮标记**：横向拖动刷出固定行高的荧光带，像荧光笔扫过一行字
- ～ **波浪下划线**：拖过一行文字，自动在字下生成规整的正弦波浪线
- 📝 **笔记**：点一下放图钉，弹出编辑框写笔记；再点图钉可改可删
- 🧽 **擦除**：点击任意批注删掉它
- 批注随书保存在浏览器 localStorage，翻页不丢
- 侧栏「批注」列表列出全部笔记，点击跳到对应页
- 快捷键 `1`/`2`/`3`/`4` 切换工具，`0` 或 `Esc` 退出工具

## 快捷键

| 键 | 作用 |
|---|---|
| → / 空格 | 下一页（RTL 下为 ←） |
| ← | 上一页（RTL 下为 →） |
| 1 / 2 / 3 / 4 | 高亮 / 划线 / 笔记 / 擦除 |
| 0 / Esc | 退出工具 · 关闭浮层 |
| T | 缩略图栏开关 |
| R | LTR/RTL 切换 |
| F | 全屏 |
| Home / End | 首页 / 末页 |

## 文件结构

```
index.html      页面骨架
css/style.css   样式（CSS 变量主题）
js/app.js       全部逻辑
vendor/         pdf.js 3.11 + page-flip 2.0.7（已本地化，无 CDN 依赖）
serve.py        可选本地服务器（书架 API）
books/          把杂志 PDF 放这里
docs/           README 截图
```

## English

A local, dependency-free PDF magazine reader that feels like a real book: two-page spreads, realistic page-curl animation with spine shadow.

**Run it:** `python3 serve.py` then open http://localhost:8666 — drop PDFs into `books/` to see them on the shelf. Or just double-click `index.html` and drag a PDF in.

**Features:** two-page spread with curl animation · per-book reading progress & direction memory (localStorage) · thumbnail sidebar · RTL mode for manga/vertical-layout magazines (fully mirrored layout & gestures) · double-click zoom overlay · annotations: highlight blocks, freehand strokes and pinned notes (persisted per book, jump-to-page list) · dark/light themes · UI in 简体中文 / 繁體中文 / English.

## 第三方依赖（已 vendored，均有宽松开源许可）

- [PDF.js](https://github.com/mozilla/pdf.js) 3.11 — Apache-2.0
- [page-flip (StPageFlip)](https://github.com/Nodlik/StPageFlip) 2.0.7 — MIT

## License

MIT
