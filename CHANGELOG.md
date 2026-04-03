# 浮动待办 - 变更日志

## 2026-04-03 (第二轮优化)

### 新功能

#### 5. 标签管理 UI
- **文件**: `src/App.tsx`, `src/style.css`
- **改动**: 设置页新增"标签管理"区块，支持：
  - 查看所有标签（色点 + 名称）
  - 点击编辑：颜色选择器 + 名称输入，Enter 保存 / Esc 取消
  - 删除标签（红色按钮确认）
  - 底部新增标签（颜色选择器 + 名称 + Plus 按钮）

#### 6. 编辑弹窗增加删除按钮
- **文件**: `src/App.tsx`, `src/style.css`
- **改动**: 编辑弹窗 footer 左侧增加红色"删除"按钮，调用 `delete_todo` 彻底删除待办

#### 7. 编辑运行中待办时自动暂停计时器
- **文件**: `src/App.tsx`
- **改动**: `openEdit` 函数检测 `timer_status === "running"` 时先调用 `pause_timer` 暂停，再计算准确耗时填入编辑表单
- **原因**: 如果不暂停，编辑耗时会与正在运行的计时器冲突

### Bug 修复

#### 5. 日历视图跨时区分组不准
- **文件**: `src-tauri/src/db.rs`, `src-tauri/src/main.rs`, `src/App.tsx`
- **问题**: `get_todo_dates` 用 `created_at / 86400` 按 UTC 天分组，不考虑本地时区
- **修复**: 新增 `tz_offset_sec` 参数，SQL 改为 `(created_at + tz) / 86400 * 86400 - tz`，前端传入 `-getTimezoneOffset() * 60`

### 优化

- **导出成功 toast**: `handleExport` 成功后显示"✓ 导出成功"，失败显示错误信息
- **JSON 导入计数**: `import_todos` 改为返回 `ImportResult { imported, skipped }`，前端统一显示导入/跳过数
- **清理 dead code**: 删除未使用常量 `COLLAPSED_ICON_W`/`COLLAPSED_ICON_H`，删除 `auto_complete_running` 函数

---

## 2026-04-03

### 新功能

#### 1. 多格式导入 (TXT, CSV, JSON)
- **文件**: `src-tauri/src/db.rs`, `src-tauri/src/main.rs`, `src/App.tsx`
- **改动**:
  - 后端新增 `import_txt`、`import_csv` 解析器，`import_file` 统一调度（按扩展名分发）
  - 前端 `handleImport` 改用 `import_file` 命令，文件选择器支持 `.json/.txt/.md/.csv`
  - 导入后 toast 显示导入/跳过条数
- **TXT 格式**: 支持日期前缀 `YYYY-MM-DD`、Markdown checkbox `- [ ]`/`- [x]`、跳过空行和 `#` 注释
- **CSV 格式**: 自动识别 header (title/date/tags/status)，标签分号分隔，自动建缺失标签（默认色 `#86868b`）
- **去重**: 基于 title + created_at 时间戳

#### 2. 待办编辑功能
- **文件**: `src-tauri/src/db.rs`, `src-tauri/src/main.rs`, `src/App.tsx`, `src/style.css`
- **后端**: `update_todo` 新增可选 `elapsed_sec: Option<i64>` 参数，传入时同时更新耗时
- **前端**:
  - 进行中和已完成待办项均新增 ✏️ 编辑按钮（Pencil 图标）
  - 点击编辑弹出 modal，可编辑：标题、标签（多选切换）、耗时（时/分/秒独立输入）
  - Enter 提交，点遮罩或取消关闭
- **CSS**: `.edit-overlay` 半透明遮罩 + `.edit-modal` 居中弹窗，圆角 12px

#### 3. 未匹配标签自动打"其他"
- **文件**: `src/App.tsx` → `handleInlineAdd`
- **问题**: 药丸条上 `+` 按钮创建待办时，`detectTags` 未命中任何标签不会兜底
- **修复**: 补上与 `handleSubmit` 相同的逻辑 — 当 `tagIds.length === 0` 时查找"其他"标签并分配

---

### Bug 修复

#### 1. 球形模式外边框 + 椭圆形状
- **文件**: `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src/style.css`
- **问题**: 透明窗口在 macOS 上有系统阴影（看起来像外边框），窗口非正方形导致椭圆
- **修复**:
  - `Cargo.toml` 添加 `cocoa = "0.26.1"` 依赖
  - `main.rs` 的 `.setup()` 钩子调用 `NSWindow::setHasShadow_(NO)` 禁用 macOS 窗口阴影
  - `style.css` 的 `html, body, #root` 设 `background: transparent`
  - `.collapsed-container.collapsed-icon-only` 强制 `border-radius: 0 !important; background: transparent !important; box-shadow: none !important`
  - 窗口尺寸逻辑：球形模式统一设为正方形 `barH + 14`

#### 2. 球形模式图标偏下
- **文件**: `src/style.css`, `src/App.tsx`
- **问题**: 球形模式单独覆盖了 `.fab` 和 `.fab-wrap` 的尺寸（`0.62 * barH`），与药丸条（`0.67 * barH`）不一致；图标用了不同的 `ballIconSize`
- **修复**:
  - 删除 `.collapsed-icon-only .fab-wrap` 和 `.collapsed-icon-only .fab` 的尺寸覆盖，复用通用 `.fab` 样式
  - 删除 `.collapsed-icon-only .fab-badge` 的尺寸覆盖，复用通用 `.fab-badge` 样式
  - 删除 `ballIconSize` 变量，统一使用 `fabIconSize`
  - 球形模式仅保留 `pointer-events: none`、`box-shadow`、`animation` 的覆盖

#### 3. ⚠️ 球形模式拖拽松开后误触打开面板（反复出现）
- **文件**: `src/App.tsx`
- **根因**: `data-tauri-drag-region` + `onClick` 共存时，拖拽结束后浏览器仍触发 click 事件
- **错误修复历史**:
  1. ❌ 第一次：用 `handleBarMouseDown` + `appWindow.startDragging()`（从 mousemove 调用） → macOS 上不生效
  2. ❌ 第二次：改用 `data-tauri-drag-region` + `onClick={handleBallClick}` → 拖拽后 click 仍触发，打开面板
  3. ✅ 第三次（正确方案）：`data-tauri-drag-region` 负责拖拽 + `onMouseDown` 跟踪鼠标移动 + `onClick` 检查是否拖拽过
- **正确方案细节**:
  - `handleBallMouseDown`: 记录 `screenX/screenY`，监听 `mousemove`，移动 >4px 标记 `ballDragged.current = true`
  - `handleBallClick`: 检查 `ballDragged`，为 true 直接返回；否则走单击/双击延时逻辑
- **教训**: **任何可拖拽元素上不能直接用 onClick 处理点击**，必须配合 mousedown 移动检测来区分拖拽和点击

#### 4. 药丸条只有计时器区域可拖拽
- **文件**: `src/App.tsx`
- **问题**: `data-tauri-drag-region` 只放在容器 `.collapsed-container` 上，但 Tauri v1 可能只检查事件目标元素本身的属性，不向上遍历祖先
- **修复**: 给所有非交互子元素也加 `data-tauri-drag-region`：
  - `.collapsed-info` div
  - `.marquee-wrapper` div
  - `.static-text` / `.marquee-text` span
  - `.collapsed-timer` span
- **注意**: `<button>` 和 `<input>` 是交互元素，Tauri 自动跳过不拖拽，无需处理

---

### 注意事项 / 设计原则

1. **拖拽 + 点击共存**: 永远用 `onMouseDown` 跟踪移动距离，`onClick` 中检查 `dragged` 标志，不能裸用 `onClick`
2. **球形模式样式**: 不要单独覆盖 `.fab`/`.fab-badge` 尺寸，保持与药丸条一致
3. **Tauri macOS 拖拽**: `appWindow.startDragging()` 从 `mousemove` 回调调用在 macOS 上不可靠，优先使用 `data-tauri-drag-region`
4. **data-tauri-drag-region 必须加到所有可拖拽子元素上**: 不能只加在容器上，Tauri 可能只检查目标元素本身
5. **标签兜底**: 所有创建待办的路径（`handleSubmit`、`handleInlineAdd`）都需要检查标签为空时分配"其他"
6. **`update_todo` 调用**: `elapsedSec` 参数是可选的，不传时只更新标题和标签（`handleInlineRename` 场景）
