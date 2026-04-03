# 悬浮待办 (Floating Todo)

一个 macOS 桌面悬浮待办应用，始终置顶显示在屏幕上，帮你随时记录和管理任务。

基于 **Tauri + React + TypeScript + Rust** 构建。

## 截图

> TODO: 添加应用截图

## 功能特性

### 核心功能
- **悬浮药丸条** — 始终置顶，显示当前任务名和计时，可拖拽移动、调整宽度
- **球形模式** — 药丸条可缩成圆球，单击展开面板，双击恢复药丸条
- **待办管理** — 创建、编辑、完成、归档，支持编辑标题/标签/耗时（已完成也可编辑）
- **计时器** — 每个任务自带计时，支持开始/暂停/停止
- **标签系统** — 自定义标签（颜色/图标），新建待办自动匹配标签，未匹配自动归入"其他"

### 统计与搜索
- **标签统计** — 按日/周/月/指定日期查看各标签耗时占比
- **日历视图** — 按月查看每天的待办完成情况
- **全局搜索** — 搜索所有待办（含已归档）

### 导入导出
- **导出** — 导出为 JSON 文件（含所有待办和标签数据）
- **导入** — 支持 JSON / TXT(Markdown) / CSV 多格式导入，自动去重

### 其他
- **深色/浅色主题** — 支持跟随系统或手动切换
- **透明度调节** — 药丸条背景透明度可调
- **高度调节** — 药丸条高度可自定义
- **开机自启** — 可选开机自动启动
- **凌晨自动完成** — 可选在凌晨自动完成所有运行中的任务
- **系统托盘** — 托盘图标快速访问

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | [Tauri](https://tauri.app/) v1.6 |
| 前端 | React 18 + TypeScript + Vite |
| 后端 | Rust + SQLite (rusqlite) |
| 图标 | [Lucide React](https://lucide.dev/) |
| 平台 | macOS（使用了 macOS Private API） |

## 开发

### 环境要求
- Node.js 18+
- Rust toolchain（`rustup`）
- macOS（Xcode Command Line Tools）

### 启动开发
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run tauri:dev
```

### 构建发布
```bash
npm run tauri:build
```

构建产物在 `src-tauri/target/release/bundle/` 目录下。

## 项目结构

```
├── src/                  # 前端代码
│   ├── App.tsx           # 主组件（UI + 逻辑）
│   ├── style.css         # 样式
│   └── main.tsx          # 入口
├── src-tauri/            # Rust 后端
│   ├── src/
│   │   ├── main.rs       # Tauri 命令 + 应用入口
│   │   ├── db.rs         # 数据库操作（SQLite）
│   │   └── models.rs     # 数据模型
│   ├── icons/            # 应用图标
│   ├── Cargo.toml        # Rust 依赖
│   └── tauri.conf.json   # Tauri 配置
├── CHANGELOG.md          # 变更日志
└── package.json
```

## 许可证

MIT
