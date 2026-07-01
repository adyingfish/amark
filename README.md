<div align="center">

<img src="src-tauri/icons/128x128.png" alt="AMark" width="90" />

# AMark

**面向 AI Agent 原生的轻量本地 Markdown 编辑器**

AI Agent 的产出，值得一个像样的阅读器。

[English](./README.en.md) · 简体中文

<img src="docs/literary-theme-interface-screenshot.png" alt="AMark 文艺主题界面" width="800" />

<img src="docs/dark-theme-interface-screenshot.png" alt="AMark 深色主题界面" width="800" />

</div>

## AI Agent 产物的第一位读者

写作正在交给 Agent，阅读依然属于你。

LLM wiki、本地知识库、Claude Code 的 memory、OpenSpec 产出的 spec、迭代中的 PRD……它们通常有层级、有交叉引用，也会被 Agent 一轮又一轮地修改。

在使用已有编辑器时，时常感觉难以顺畅阅读这些内容：界面不够现代美观，引用不能跳转，注释混在正文，Agent 刚改动了哪些文件不够直观。

AMark 正在试图打造那个像样的阅读器：

整个目录以所见即所得的方式渲染，文件树、标签页、实时刷新、@path 跳转、最近变更、Agent 写入状态提示。

## 特性

**多文件工作区**

- 文件树：整个文件夹作为工作区，支持浏览、新建、重命名、删除文件与文件夹
- 多标签页：支持脏状态标记，以及关闭其他、关闭全部、关闭未修改标签
- @path 文件引用：渲染为可点击引用块，Ctrl/Cmd + 点击跳转到目标文件
- 块级 HTML 注释：渲染为弱化提示块，适合保留写给 Agent 的上下文

**Agent 写作实时可见**

- 工作区目录文件监听：外部程序写入后编辑器自动刷新
- 高频写入合并：减少闪烁与重复渲染
- Agent 活动指示：黄色表示正在写入，绿色表示写入完成
- 最近变更面板：按时间列出被改动的文件，点击即打开

**编辑、预览与导出**

- 基于 Milkdown 的所见即所得编辑，支持 CommonMark + GFM
- 四种视图模式：源码 / 分屏（滚动同步）/ 纯预览 / 所见即所得
- 支持富文本复制，可直接粘贴到邮件、聊天工具或文档系统
- 导出 PDF / HTML
- 5 套内置主题
- 中英文界面
- 跨平台桌面应用（Windows / macOS / Linux）

## 适用场景

**浏览 LLM wiki 与本地知识库** —— 时不时管理你的 LLM wiki 或 本地知识库内容。以工作区打开，沿文件树浏览、沿引用跳转，读起来更像一个整体。

**评审 plan、spec 与 PRD** —— Claude Code 的 plan、OpenSpec 产出的 spec、迭代中的 PRD，本来就是目录组织的。在 AMark 里逐篇阅读、沿引用跳转，被改动的文件按时间列在一处。

**观察 Agent 写作** —— 终端里运行 Claude Code，旁边开着 AMark：文档一边生成一边成型，黄色表示正在写，绿色表示写完了，不会读到写了一半的中间态。

**日常 Markdown 编辑** —— 所见即所得、轻量、本地优先、无账号、无云端、无私有格式。毕竟，人类偶尔也要自己写点东西。

## 安装

从 [Releases](../../releases) 页面下载对应平台的安装包：

| 平台    | 安装包          |
| ------- | --------------- |
| Windows | `.msi` / `.exe` |
| macOS   | `.dmg`          |
| Linux   | `.deb`          |

装好之后，用 AMark 打开你的项目目录——比如 Claude Code 正在工作的仓库，或它的 memory 目录——然后回到终端，让 agent 继续干活。

## 设计原则

- **AI Agent Native**：对 AI Agent 生态变化保持敏感。今天有用的功能，明天可能变成包袱——AMark 会果断纳入新能力，也会果断移除过时的。宁可小而对，不要大而全。
- **轻量**：AMark 使用 Tauri 构建，在提供跨平台桌面体验的同时，尽可能减少应用体积和运行时资源占用。

## 路线图

- **搜索支持**：在当前文件与工作区范围内快速查找内容。
- **公式渲染**：支持常见 Markdown 数学公式的渲染。
- **类 LaTeX 排版预览**：在「仅预览」模式中提供更接近论文与正式文档的对齐等排版效果，让 Markdown 也更适合长文阅读。
- **更多 AI Agent Native 场景**：仍在探索更适合 Agent 产物阅读、评审与协作的交互方式。如果你在使用 AI Agent 工具时遇到了特别适合的 Markdown 工作流，欢迎提交 issue 分享想法。

## License

[MIT](./LICENSE)
