# Film Cut Studio · 拉片软件

> 一个**纯前端、零依赖、全程离线**的专业声画拉片工具。把视频拖进来，自动切镜头，按"导演视角"逐镜标注画面与声音，最后一键导出结构化拉片报告。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Privacy: 100% Offline](https://img.shields.io/badge/Privacy-100%25%20Offline-blue.svg)](#隐私红线)
[![Deploy: GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-green.svg)](#在线试用)

---

## 这是什么

「拉片」是导演/剪辑把一部影片逐镜拆解、研究其视听语言的方法。本工具服务于**专业·声画技术方向**的拉片（对标：摄影And1、小鱼陪拉片、拉片实验室），不是剧情/人物文本拆解。

它解决的核心痛点：截图只能看单帧，而拉片一半价值在**跨帧连续**——长镜运镜、蒙太奇组合、声画对位。所以工具以**时间线 + 虚拟片段**为核心，存的是时间码引用而非重编码画面，零画质损失、数据量≈0。

---

## 在线试用

仓库开启 GitHub Pages 后，直接访问：

```
https://<你的GitHub用户名>.github.io/film-cut-studio/
```

（本地也可直接双击 `index.html` 用浏览器打开，无需服务器、无需联网。推荐 Chrome / Edge。）

---

## 功能特性

| 模块 | 能力 |
|---|---|
| **导入** | 拖入本地视频（横屏 16:9 与竖屏 9:16 均自适应），素材不出本机 |
| **自动切镜头 (SBD)** | 抽帧→直方图差分→自适应阈值→非极大值抑制→最短镜头过滤；灵敏度滑块（对标达芬奇紫色阈值条），纯本地计算 |
| **时间线（达芬奇风格）** | 三栏暗色布局（媒体池 / 检视器 / 时间线+检查器）；In/Out 设入出点、JKL 播控、B 刀片切分 |
| **拆分 / 合并 / 编组** | `B` 在切点切开；`M` 合并相邻镜头（删假切点）；`G` 编段落组、`Cmd/Ctrl+Shift+G` 解散组——均非破坏性（只改时间码） |
| **边界吸附** | 拖动镜头边缘调 in/out 时，自动吸附到相邻镜头边缘 / 播放头 / 端点，黄色辅助线提示 |
| **多维表格（飞书风格）** | 一镜一行；7 类单元格（单选/多选/文本/长文/附件/关联/公式）；四视图（表格/看板/画廊/表单）；搜索/筛选/分组/排序 |
| **块编辑器（Notion 风格）** | `/` 命令菜单、行内格式、拖拽；语音块支持本地录音→`webkitSpeechRecognition` 转写（中文） |
| **分析记录 → AI 报告** | 记录按镜头/时间码关联；汇总为素材包，喂给 AI 生成结构化报告（镜头语言/声音设计/人物塑造/节奏/可复制清单）。AI 三模式：本地 WebLLM / 云端 API(自带 key) / 导出给 WorkBuddy 手动分析 |
| **导出** | CSV（Excel 友好，UTF-8 BOM）/ Markdown 报告 / 工程 JSON；一键复制 |
| **小白友好** | 每维度配"看什么/怎么写"提示卡；术语库（46 条）；AI 初填维度建议 |

---

## 快速开始

**方式一：直接打开**
1. 下载本仓库的 `index.html`
2. 双击用浏览器打开（推荐 Chrome / Edge）

**方式二：克隆仓库**
```bash
git clone https://github.com/<你的GitHub用户名>/film-cut-studio.git
cd film-cut-studio
# 直接打开 index.html，或本地起静态服务：
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000
```

---

## 从源码构建

`index.html` 是由 `src/` 下 14 个模块 + `styles.css` + `body.html` 经 `build.js` 内联打包而成的单文件。修改源码后重新构建：

```bash
# 需要 Node.js（>= 16）
node build.js
# 产物：index.html（已内联所有 CSS/JS，可直接发布）
```

源码结构：

```
src/
  00-core.js      状态/工具/存储
  10-media.js     媒体导入
  20-viewer.js    检视器（播放/逐帧/JKL）
  30-timeline.js  时间线 + 边界吸附
  40-edit.js      拆分/合并/编组/解散/删除
  45-inspector.js 检查器（维度标注）
  50-table.js     飞书式多维表格四视图
  60-blocks.js    Notion 式块编辑器 + 语音块
  70-sbd.js       自动切镜头（镜头边界检测）
  80-export-ai.js 导出 CSV/MD/JSON + AI 报告
  90-help.js      帮助 / 快捷键
  99-main.js      启动装配
  body.html       页面骨架
  styles.css      样式
build.js          内联打包脚本
test/             冒烟测试 + 截图脚本（Puppeteer）
```

---

## 快捷键速查（达芬奇风格）

| 键 | 功能 |
|---|---|
| `I` / `O` | 设入点 / 出点 |
| `J` `K` `L` | 倒放 / 暂停 / 播放（JKL 播控） |
| `,` / `.` | 上一帧 / 下一帧 |
| `B` | 刀片工具（在时间线点一下切开） |
| `Cmd/Ctrl+B` | 在播放头处拆分当前片段 |
| `M` | **合并相邻镜头**（删假切点） |
| `G` | 把选中相邻片段编成段落组 |
| `Cmd/Ctrl+Shift+G` | 解散段落组 |
| `Delete` | 删除选中片段 |
| `Cmd/Ctrl+Z` | 撤销 |

---

## 隐私红线

- **全程零外部网络请求**：素材只在本地浏览器处理，绝不上传任何服务器。
- 适合处理敏感素材（如人物采访原始片）。AI 分析若走云端有泄露风险，优先本地或"导出给 WorkBuddy 手动分析"模式。

---

## 技术架构

- **纯前端单文件应用**：传统 `<script>` 内联（非 ESM），全部挂在 `window.LP` 命名空间；`build.js` 把 `src/*.js` + `styles.css` + `body.html` 内联进 `index.html`。
- **存储**：`localStorage` + `IndexedDB`（语音块音频）。
- **无构建依赖**：`build.js` 仅用 Node 内置模块，无需 `npm install`。

---

## 已知局限

- 自动切镜头对**极缓慢的亮度漂移**在极限灵敏度下可能多切 1–2 个假镜头，可用 `M` 合并或手动删。
- 语音转写依赖浏览器内置 `webkitSpeechRecognition`，需 Chrome/Edge 且授予麦克风权限；Safari/Firefox 不支持时降级为纯录音回放。
- AI 报告三种模式：本地 WebLLM 模型较弱；云端 API 需自带 key；手动分析最稳。

---

## 许可证

[MIT](LICENSE) © 2026 海鸥 (Haiou)
