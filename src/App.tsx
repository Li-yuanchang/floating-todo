import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow, LogicalSize } from "@tauri-apps/api/window";
import { save, open } from "@tauri-apps/api/dialog";
import {
  ClipboardCheck, X, Pause, Play, Check, RotateCcw, Archive,
  Download, Upload, BarChart3, ListTodo, ChevronDown, ChevronRight,
  Settings, Monitor, Sun, Moon, Plus, Calendar, Search, ChevronLeft, Pencil, Trash2,
} from "lucide-react";

// ── Types ──
interface Tag {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
}
interface Todo {
  id: number;
  title: string;
  description: string | null;
  status: string;
  timer_status: string;
  timer_started_at: number | null;
  timer_elapsed_sec: number;
  created_at: number;
  completed_at: number | null;
  archived_at: number | null;
  tags: Tag[];
}
interface TagTimeStat {
  tag: Tag;
  total_seconds: number;
  percentage: number;
  todo_count: number;
}

// ── Tag auto-detection ──
const TAG_KEYWORDS: Record<string, string[]> = {
  "开发": ["开发", "编码", "编程", "code", "coding", "fix", "bug", "修复", "功能", "需求", "接口", "api", "重构", "优化", "feature"],
  "测试": ["测试", "test", "qa", "用例", "回归", "自测", "联调", "验证"],
  "运维": ["运维", "部署", "deploy", "发布", "上线", "服务器", "监控", "配置", "ci", "cd", "构建", "build"],
  "会议": ["会议", "讨论", "评审", "review", "站会", "周会", "汇报", "同步", "对齐", "meeting"],
  "文档": ["文档", "写文", "doc", "readme", "记录", "笔记", "周报", "日报", "方案", "设计"],
  "沟通": ["沟通", "协调", "对接", "反馈", "邮件", "消息", "答疑", "支持"],
  "学习": ["学习", "研究", "调研", "培训", "阅读", "看书", "课程"],
};

function detectTags(text: string, tags: Tag[]): Tag[] {
  const lower = text.toLowerCase();
  const matched: Tag[] = [];
  for (const tag of tags) {
    const keywords = TAG_KEYWORDS[tag.name];
    if (keywords && keywords.some((kw) => lower.includes(kw))) {
      matched.push(tag);
    }
  }
  return matched;
}

// ── Time formatting ──
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Window sizes ──
const DEFAULT_BAR_W = 300;
const MIN_BAR_W_FIXED = 42;
const MAX_BAR_W = 500;
const DEFAULT_BAR_H = 42;
const MIN_BAR_H = 34;
const MAX_BAR_H = 56;
const EXPANDED_W = 400;
const EXPANDED_H = 520;

type ThemeMode = "system" | "light" | "dark";
type ViewMode = "collapsed" | "input" | "list" | "stats" | "settings";

export default function App() {
  const [mode, setMode] = useState<ViewMode>("collapsed");
  const [tags, setTags] = useState<Tag[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [stats, setStats] = useState<TagTimeStat[]>([]);
  const [statsPeriod, setStatsPeriod] = useState<"day" | "week" | "month" | "custom">("day");
  const [statsDate, setStatsDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statsView, setStatsView] = useState<"tag" | "calendar">("tag");
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return [d.getFullYear(), d.getMonth()] as [number, number]; });
  const [calDates, setCalDates] = useState<Map<string, number>>(new Map());
  const [calDayTodos, setCalDayTodos] = useState<Todo[] | null>(null);
  const [calSelectedDay, setCalSelectedDay] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Todo[] | null>(null);
  const [needsMarquee, setNeedsMarquee] = useState(false);
  const [inlineMode, setInlineMode] = useState<null | "rename" | "add">(null);
  const [inlineText, setInlineText] = useState("");
  const [completeIds, setCompleteIds] = useState<Set<number>>(new Set());
  const [showRunningList, setShowRunningList] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTagIds, setEditTagIds] = useState<number[]>([]);
  const [editH, setEditH] = useState(0);
  const [editM, setEditM] = useState(0);
  const [editS, setEditS] = useState(0);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#4CAF50");
  const [autostart, setAutostart] = useState(false);
  const [midnightComplete, setMidnightComplete] = useState(() => {
    return localStorage.getItem("midnight-complete") === "true";
  });
  const inlineRef = useRef<HTMLInputElement>(null);
  const [barH, setBarH] = useState(() => {
    const saved = localStorage.getItem("bar-height");
    return saved ? Math.max(MIN_BAR_H, Math.min(MAX_BAR_H, Number(saved))) : DEFAULT_BAR_H;
  });
  const updateBarH = (v: number) => {
    setBarH(v);
    localStorage.setItem("bar-height", String(v));
    if (mode === "collapsed") {
      appWindow.setSize(new LogicalSize(collapsedBarW, v)).catch(() => {});
    }
  };
  const [collapsedBarW, setCollapsedBarW] = useState(() => {
    const saved = localStorage.getItem("collapsed-bar-w");
    return saved ? Math.max(MIN_BAR_W_FIXED, Math.min(MAX_BAR_W, Number(saved))) : DEFAULT_BAR_W;
  });
  const [barOpacity, setBarOpacity] = useState(() => {
    const saved = localStorage.getItem("bar-opacity");
    return saved ? Number(saved) : 0.88;
  });
  const updateBarOpacity = (v: number) => {
    setBarOpacity(v);
    localStorage.setItem("bar-opacity", String(v));
  };

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem("theme") as ThemeMode) || "system";
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const textMeasureRef = useRef<HTMLDivElement>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resizingRef = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickCountRef = useRef(0);
  const expandToListRef = useRef<() => void>(() => {});
  const [, setTick] = useState(0);

  // Get today's start timestamp (local midnight in seconds)
  const getTodayStart = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };

  // Load data (only today's todos + running)
  const loadData = useCallback(async () => {
    try {
      const todayStart = getTodayStart();
      const [t, td] = await Promise.all([
        invoke<Tag[]>("get_tags"),
        invoke<Todo[]>("get_todos", { status: null, todayStart }),
      ]);
      setTags(t);
      setTodos(td);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    // Archive old completed todos on startup, then load data
    const todayStart = getTodayStart();
    invoke("archive_old_completed", { todayStart }).catch(() => {});
    loadData();
    invoke<boolean>("get_autostart").then(setAutostart).catch(() => {});
  }, [loadData]);

  // Midnight auto-complete check
  useEffect(() => {
    if (!midnightComplete) return;
    let lastDate = new Date().getDate();
    const id = setInterval(async () => {
      const now = new Date();
      if (now.getDate() !== lastDate) {
        lastDate = now.getDate();
        try {
          await invoke("complete_all_running");
          await loadData();
        } catch (e) {
          console.error(e);
        }
      }
    }, 30000);
    return () => clearInterval(id);
  }, [midnightComplete, loadData]);

  // Theme management
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const applyTheme = () => {
      let dark = false;
      if (themeMode === "dark") {
        dark = true;
      } else if (themeMode === "system") {
        dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }
      setIsDark(dark);
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    };
    applyTheme();
    localStorage.setItem("theme", themeMode);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => { if (themeMode === "system") applyTheme(); };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeMode]);

  const barStyle: React.CSSProperties & Record<string, string> = {
    background: isDark
      ? `rgba(30, 30, 30, ${barOpacity})`
      : `rgba(246, 246, 246, ${barOpacity})`,
    backdropFilter: barOpacity > 0.01 ? `blur(${Math.round(barOpacity * 24)}px)` : "none",
    WebkitBackdropFilter: barOpacity > 0.01 ? `blur(${Math.round(barOpacity * 24)}px)` : "none",
    "--bar-h": `${barH}px`,
  };

  const runningTodos = todos.filter((t) => t.timer_status === "running");
  const [cycleIndex, setCycleIndex] = useState(0);
  const displayTodo = runningTodos.length > 0 ? runningTodos[cycleIndex % runningTodos.length] : null;

  // Timer tick - always tick when there's a running todo (including collapsed)
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (runningTodos.length > 0) {
      tickRef.current = setInterval(() => setTick((v) => v + 1), 1000);
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [runningTodos.length]);

  // Cycle through running todos every 4 seconds when multiple are running
  useEffect(() => {
    if (runningTodos.length <= 1) { setCycleIndex(0); return; }
    const id = setInterval(() => setCycleIndex((i) => i + 1), 4000);
    return () => clearInterval(id);
  }, [runningTodos.length]);

  // Auto-resize collapsed window when running task changes
  useEffect(() => {
    if (mode === "collapsed") {
      const isBall = collapsedBarW < 80;
      if (isBall) {
        const s = barH + 14;
        appWindow.setSize(new LogicalSize(s, s)).catch(() => {});
      } else if (runningTodos.length > 0) {
        appWindow.setSize(new LogicalSize(collapsedBarW, barH)).catch(() => {});
      } else {
        appWindow.setSize(new LogicalSize(barH + 14, barH + 14)).catch(() => {});
      }
    }
  }, [mode, runningTodos.length, collapsedBarW, barH]);

  // Check if text needs marquee scrolling
  useEffect(() => {
    const check = () => {
      if (textMeasureRef.current && displayTodo) {
        const el = textMeasureRef.current;
        setNeedsMarquee(el.scrollWidth > el.clientWidth);
      } else {
        setNeedsMarquee(false);
      }
    };
    check();
    const t = setTimeout(check, 100);
    return () => clearTimeout(t);
  }, [displayTodo?.title, collapsedBarW]);

  // Ball mode: mousedown tracks movement to distinguish drag vs click.
  // data-tauri-drag-region handles native drag; click logic only fires if mouse didn't move.
  const ballDragged = useRef(false);
  const handleBallMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    ballDragged.current = false;
    const sx = e.screenX, sy = e.screenY;
    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.screenX - sx) + Math.abs(ev.screenY - sy) > 4) {
        ballDragged.current = true;
        document.removeEventListener("mousemove", onMove);
      }
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const handleBallClick = useCallback(() => {
    if (ballDragged.current) { ballDragged.current = false; return; }
    clickCountRef.current += 1;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      const count = clickCountRef.current;
      clickCountRef.current = 0;
      clickTimerRef.current = null;
      if (count >= 2) {
        const w = DEFAULT_BAR_W;
        setCollapsedBarW(w);
        localStorage.setItem("collapsed-bar-w", String(w));
        appWindow.setSize(new LogicalSize(w, barH)).catch(() => {});
      } else {
        expandToListRef.current();
      }
    }, 300);
  }, [barH]);

  // Drag-to-resize collapsed bar
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;
    const startX = e.clientX;
    const startW = collapsedBarW;

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - startX;
      const newW = Math.max(barH, Math.min(MAX_BAR_W, startW + delta));
      setCollapsedBarW(newW);
      appWindow.setSize(new LogicalSize(newW, barH)).catch(() => {});
    };

    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setCollapsedBarW((w) => {
        localStorage.setItem("collapsed-bar-w", String(w));
        if (w < 80) {
          appWindow.setSize(new LogicalSize(barH + 14, barH + 14)).catch(() => {});
        }
        return w;
      });
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [collapsedBarW]);

  // Window resize
  const resizeWindow = async (w: number, h: number) => {
    try {
      await appWindow.setSize(new LogicalSize(w, h));
    } catch (e) {
      console.error(e);
    }
  };

  // Expand to show input
  const expand = async () => {
    await resizeWindow(EXPANDED_W, EXPANDED_H);
    setMode("input");
    await loadData();
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // Expand to show list (used by ball mode click)
  const expandToList = async () => {
    setMode("list");
    await loadData();
    await resizeWindow(EXPANDED_W, EXPANDED_H);
  };
  expandToListRef.current = expandToList;

  // Collapse back to icon
  const collapse = async () => {
    setMode("collapsed");
    setInput("");
    setSelectedTagIds([]);
    if (runningTodos.length > 0) {
      await resizeWindow(collapsedBarW, barH);
    } else {
      await resizeWindow(barH + 14, barH + 14);
    }
  };

  // Submit todo
  const handleSubmit = async () => {
    const title = input.trim();
    if (!title) return;
    let tagIds = selectedTagIds;
    if (tagIds.length === 0) {
      const detected = detectTags(title, tags);
      tagIds = detected.map((t) => t.id);
    }
    if (tagIds.length === 0) {
      const otherTag = tags.find((t) => t.name === "其他");
      if (otherTag) tagIds = [otherTag.id];
    }
    try {
      await invoke("create_todo", { title, tagIds });
      setInput("");
      setSelectedTagIds([]);
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  // Inline rename: save new title for current displayed task
  const handleInlineRename = async () => {
    const title = inlineText.trim();
    if (!title || !displayTodo) { setInlineMode(null); return; }
    try {
      const todoTags = displayTodo.tags?.map((t: Tag) => t.id) || [];
      await invoke("update_todo", { id: displayTodo.id, title, tagIds: todoTags });
      setInlineMode(null);
      setInlineText("");
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  // Inline add: complete checked todos, then create new task
  const handleInlineAdd = async () => {
    const title = inlineText.trim();
    if (!title) { cancelInline(); return; }
    try {
      // Complete all checked running todos
      for (const id of completeIds) {
        await invoke("complete_todo", { id });
      }
      const detected = detectTags(title, tags);
      let tagIds = detected.map((t) => t.id);
      if (tagIds.length === 0) {
        const otherTag = tags.find((t) => t.name === "其他");
        if (otherTag) tagIds = [otherTag.id];
      }
      await invoke("create_todo", { title, tagIds });
      cancelInline();
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleInlineSubmit = () => {
    if (inlineMode === "rename") return handleInlineRename();
    if (inlineMode === "add") return handleInlineAdd();
  };

  const startRename = () => {
    if (!displayTodo) return;
    setInlineMode("rename");
    setInlineText(displayTodo.title);
    setTimeout(() => { inlineRef.current?.focus(); inlineRef.current?.select(); }, 50);
  };

  const startAdd = () => {
    // Default: check all running todos for completion
    setCompleteIds(new Set(runningTodos.map((t) => t.id)));
    setInlineMode("add");
    setInlineText("");
    // Expand window to show checklist panel
    const panelH = barH + 8 + runningTodos.length * 28 + 8;
    appWindow.setSize(new LogicalSize(collapsedBarW, panelH)).catch(() => {});
    setTimeout(() => inlineRef.current?.focus(), 50);
  };

  const cancelInline = () => {
    setInlineMode(null);
    setInlineText("");
    setCompleteIds(new Set());
    setShowRunningList(false);
    // Shrink window back
    if (mode === "collapsed") {
      const h = runningTodos.length > 0 ? barH : barH + 14;
      const w = runningTodos.length > 0 ? collapsedBarW : barH + 14;
      appWindow.setSize(new LogicalSize(w, h)).catch(() => {});
    }
  };

  const editWasRunning = useRef(false);

  const openEdit = async (todo: Todo) => {
    editWasRunning.current = todo.timer_status === "running";
    if (editWasRunning.current) {
      try { await invoke("pause_timer", { id: todo.id }); await loadData(); } catch (_) {}
      todo = { ...todo, timer_status: "paused", timer_started_at: null,
        timer_elapsed_sec: todo.timer_started_at
          ? todo.timer_elapsed_sec + Math.floor(Date.now() / 1000) - todo.timer_started_at
          : todo.timer_elapsed_sec };
    }
    setEditingTodo(todo);
    setEditTitle(todo.title);
    setEditTagIds(todo.tags.map((t) => t.id));
    const sec = todo.timer_elapsed_sec;
    setEditH(Math.floor(sec / 3600));
    setEditM(Math.floor((sec % 3600) / 60));
    setEditS(sec % 60);
  };

  const saveEdit = async () => {
    if (!editingTodo) return;
    const title = editTitle.trim();
    if (!title) return;
    const elapsedSec = editH * 3600 + editM * 60 + editS;
    const todoId = editingTodo.id;
    const shouldResume = editWasRunning.current;
    try {
      await invoke("update_todo", { id: todoId, title, tagIds: editTagIds, elapsedSec });
      if (shouldResume) {
        await invoke("start_timer", { id: todoId });
      }
      setEditingTodo(null);
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteFromEdit = async () => {
    if (!editingTodo) return;
    try {
      await invoke("delete_todo", { id: editingTodo.id });
      setEditingTodo(null);
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    try {
      await invoke("create_tag", { name, color: newTagColor, icon: null });
      setNewTagName("");
      setNewTagColor("#4CAF50");
      await loadData();
    } catch (e) { console.error(e); }
  };

  const handleSaveTag = async () => {
    if (!editingTag) return;
    try {
      await invoke("update_tag", { id: editingTag.id, name: editingTag.name, color: editingTag.color, icon: editingTag.icon });
      setEditingTag(null);
      await loadData();
    } catch (e) { console.error(e); }
  };

  const handleDeleteTag = async (id: number) => {
    try {
      await invoke("delete_tag", { id });
      await loadData();
    } catch (e) { console.error(e); }
  };

  const toggleCompleteId = (id: number) => {
    setCompleteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Toggle tag selection
  const toggleTag = (id: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  // Timer actions
  const handleComplete = async (id: number) => {
    await invoke("complete_todo", { id });
    await loadData();
  };
  const handleStart = async (id: number) => {
    await invoke("start_timer", { id });
    await loadData();
  };
  const handlePause = async (id: number) => {
    await invoke("pause_timer", { id });
    await loadData();
  };
  const handleReopen = async (id: number) => {
    await invoke("reopen_todo", { id });
    await loadData();
  };
  const handleArchive = async (id: number) => {
    await invoke("archive_todo", { id });
    await loadData();
  };

  // Import / Export
  const handleExport = async () => {
    try {
      const path = await save({
        defaultPath: "todos.csv",
        filters: [
          { name: "CSV (Excel可打开)", extensions: ["csv"] },
          { name: "Markdown (清单)", extensions: ["md"] },
          { name: "JSON (完整备份)", extensions: ["json"] },
        ],
      });
      if (path) {
        const ext = path.split(".").pop()?.toLowerCase();
        if (ext === "csv") {
          await invoke("export_csv", { path });
        } else if (ext === "md" || ext === "txt") {
          await invoke("export_markdown", { path });
        } else {
          await invoke("export_todos", { path });
        }
        showToast("✓ 导出成功");
      }
    } catch (e) {
      console.error(e);
      showToast("✗ 导出失败: " + String(e));
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleImport = async () => {
    try {
      const path = await open({
        filters: [
          { name: "所有支持格式", extensions: ["json", "txt", "md", "csv"] },
          { name: "JSON", extensions: ["json"] },
          { name: "TXT / Markdown", extensions: ["txt", "md"] },
          { name: "CSV", extensions: ["csv"] },
        ],
        multiple: false,
      });
      if (path && typeof path === "string") {
        showToast("正在导入...");
        const result = await invoke<{ imported: number; skipped: number }>("import_file", { path });
        await loadData();
        showToast(`✓ 导入 ${result.imported} 条，跳过 ${result.skipped} 条重复`);
      }
    } catch (e) {
      console.error(e);
      showToast("✗ 导入失败: " + String(e));
    }
  };

  // Stats
  const loadStats = async (period: "day" | "week" | "month" | "custom", dateStr?: string) => {
    setStatsPeriod(period);
    const now = Math.floor(Date.now() / 1000);
    let startTs: number;
    let endTs: number = now;
    if (period === "custom") {
      const ds = dateStr || statsDate;
      const d = new Date(ds + "T00:00:00");
      startTs = Math.floor(d.getTime() / 1000);
      const dEnd = new Date(ds + "T23:59:59");
      endTs = Math.floor(dEnd.getTime() / 1000);
    } else if (period === "day") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      startTs = Math.floor(d.getTime() / 1000);
    } else if (period === "week") {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      startTs = Math.floor(d.getTime() / 1000);
    } else {
      const d = new Date();
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      startTs = Math.floor(d.getTime() / 1000);
    }
    try {
      const s = await invoke<TagTimeStat[]>("get_tag_stats", { startTs, endTs });
      setStats(s);
      setMode("stats");
      await resizeWindow(EXPANDED_W, EXPANDED_H);
    } catch (e) {
      console.error(e);
    }
  };

  // Load calendar data for a month
  const loadCalMonth = async (year: number, month: number) => {
    setCalMonth([year, month]);
    setCalDayTodos(null);
    setCalSelectedDay(null);
    const startD = new Date(year, month, 1);
    const endD = new Date(year, month + 1, 1);
    const startTs = Math.floor(startD.getTime() / 1000);
    const endTs = Math.floor(endD.getTime() / 1000);
    try {
      const tzOffsetSec = -new Date().getTimezoneOffset() * 60;
      const dates = await invoke<[number, number][]>("get_todo_dates", { startTs, endTs, tzOffsetSec });
      const map = new Map<string, number>();
      for (const [ts, count] of dates) {
        const d = new Date(ts * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        map.set(key, (map.get(key) || 0) + count);
      }
      setCalDates(map);
    } catch (e) { console.error(e); }
  };

  // Load todos for a specific day
  const loadCalDay = async (dateStr: string) => {
    setCalSelectedDay(dateStr);
    const d = new Date(dateStr + "T00:00:00");
    const startTs = Math.floor(d.getTime() / 1000);
    const endTs = startTs + 86400;
    try {
      const todos = await invoke<Todo[]>("get_todos_by_date", { startTs, endTs });
      setCalDayTodos(todos);
    } catch (e) { console.error(e); }
  };

  // Search todos
  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults(null); return; }
    try {
      const results = await invoke<Todo[]>("search_todos", { query: q.trim() });
      setSearchResults(results);
    } catch (e) { console.error(e); }
  };

  // Format date for display
  const fmtDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  // Calculate current elapsed time for display
  const getElapsed = (todo: Todo): number => {
    if (todo.timer_status === "running" && todo.timer_started_at) {
      const now = Math.floor(Date.now() / 1000);
      return todo.timer_elapsed_sec + (now - todo.timer_started_at);
    }
    return todo.timer_elapsed_sec;
  };

  const activeTodos = todos.filter(
    (t) => t.status === "in_progress" || t.status === "pending"
  );
  const completedTodos = todos.filter((t) => t.status === "completed");

  // ── Collapsed state ──
  if (mode === "collapsed") {
    // No running task: just a small icon
    const fabIconSize = Math.round(barH * 0.4);
    const ballWinSize = barH + 14;
    const ballStyle: React.CSSProperties & Record<string, string> = {
      background: "transparent",
      backdropFilter: "none",
      WebkitBackdropFilter: "none",
      "--bar-h": `${barH}px`,
    };
    if (!displayTodo) {
      return (
        <div
          className="collapsed-container collapsed-icon-only"
          data-tauri-drag-region
          onMouseDown={handleBallMouseDown}
          onClick={handleBallClick}
          style={ballStyle}
        >
          <button className="fab" title="单击打开面板 · 双击恢复药丸条">
            <ClipboardCheck size={fabIconSize} />
          </button>
        </div>
      );
    }
    // Running task(s): icon + badge + marquee text + timer
    const sortedRunning = [...runningTodos].sort((a, b) => getElapsed(b) - getElapsed(a));
    const isMinimal = collapsedBarW < 80;
    return (
      <>
      <div
        className={`collapsed-container${isMinimal ? " collapsed-icon-only" : ""}`}
        data-tauri-drag-region
        onMouseDown={isMinimal ? handleBallMouseDown : undefined}
        onClick={isMinimal ? handleBallClick : undefined}
        style={isMinimal ? ballStyle : barStyle}
      >
        <div className="fab-wrap">
          <button className="fab" onClick={isMinimal ? undefined : expand} title={isMinimal ? "单击打开面板 · 双击恢复药丸条" : "展开管理面板"}>
            <ClipboardCheck size={fabIconSize} />
          </button>
          {runningTodos.length > 0 && (
            <span
              className="fab-badge"
              onClick={(e) => {
                e.stopPropagation();
                if (isMinimal) return;
                const show = !showRunningList;
                setShowRunningList(show);
                if (show) {
                  const panelH = barH + 4 + runningTodos.length * 28 + 4;
                  appWindow.setSize(new LogicalSize(collapsedBarW, panelH)).catch(() => {});
                } else {
                  appWindow.setSize(new LogicalSize(collapsedBarW, barH)).catch(() => {});
                }
              }}
              title={isMinimal ? `${runningTodos.length}条运行中` : `${runningTodos.length}条运行中，点击查看列表`}
            >
              {runningTodos.length}
            </span>
          )}
        </div>
        {!isMinimal && (
          <>
            <div className="collapsed-info" data-tauri-drag-region>
              {inlineMode ? (
                <input
                  ref={inlineRef}
                  className={`inline-input ${inlineMode === "add" ? "inline-add" : "inline-rename"}`}
                  value={inlineText}
                  placeholder={inlineMode === "add" ? "新任务名称…" : "修改任务名…"}
                  onChange={(e) => setInlineText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleInlineSubmit();
                    if (e.key === "Escape") cancelInline();
                  }}
                  onBlur={() => {
                    if (inlineMode === "add") {
                      setTimeout(() => cancelInline(), 150);
                    } else if (inlineMode === "rename") {
                      handleInlineRename();
                    }
                  }}
                />
              ) : (
                <div className="marquee-wrapper" data-tauri-drag-region ref={textMeasureRef} onClick={startRename} title="点击编辑任务名（Enter保存）">
                  {needsMarquee ? (
                    <span className="marquee-text" data-tauri-drag-region key={displayTodo.id}>{displayTodo.title}</span>
                  ) : (
                    <span className="static-text" data-tauri-drag-region key={displayTodo.id}>{displayTodo.title}</span>
                  )}
                </div>
              )}
            </div>
            {!inlineMode && (
              <div className="collapsed-actions">
                <button className="bar-btn bar-complete" onClick={() => handleComplete(displayTodo.id)} title="✓ 完成当前任务并停止计时">
                  <Check size={12} />
                </button>
                <button className="bar-btn bar-add" onClick={startAdd} title="+ 新增待办（可选完成旧任务）">
                  <Plus size={12} />
                </button>
              </div>
            )}
            <span className="collapsed-timer" data-tauri-drag-region>{formatTime(getElapsed(displayTodo))}</span>
          </>
        )}
        <div className="resize-handle" onMouseDown={handleResizeStart} onDoubleClick={(e) => {
          e.stopPropagation();
          const w = barH;
          setCollapsedBarW(w);
          localStorage.setItem("collapsed-bar-w", String(w));
          appWindow.setSize(new LogicalSize(barH + 14, barH + 14)).catch(() => {});
        }} title="拖拽调整宽度 · 双击变圆球" />
      </div>
      {inlineMode === "add" && runningTodos.length > 0 && (
        <div className="add-panel" style={barStyle}>
          {runningTodos.map((t) => (
            <label key={t.id} className="add-panel-row" onMouseDown={(e) => e.preventDefault()}>
              <input
                type="checkbox"
                checked={completeIds.has(t.id)}
                onChange={() => toggleCompleteId(t.id)}
                className="add-panel-check"
              />
              <span className="add-panel-title">{t.title}</span>
              <span className="add-panel-time">{formatTime(getElapsed(t))}</span>
            </label>
          ))}
        </div>
      )}
      {showRunningList && !inlineMode && (
        <div className="add-panel" style={barStyle}>
          {sortedRunning.map((t) => (
            <div
              key={t.id}
              className={`add-panel-row running-list-row ${t.id === displayTodo.id ? "active" : ""}`}
              onClick={() => {
                setCycleIndex(runningTodos.indexOf(t));
                setShowRunningList(false);
                appWindow.setSize(new LogicalSize(collapsedBarW, barH)).catch(() => {});
              }}
            >
              <span className="add-panel-title">{t.title}</span>
              <span className="add-panel-time">{formatTime(getElapsed(t))}</span>
              <button
                className="bar-btn bar-complete"
                onClick={(e) => { e.stopPropagation(); handleComplete(t.id); }}
                title="完成"
              >
                <Check size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
    );
  }

  // ── Expanded views ──
  return (
    <div className="expanded-container">
      {/* Header bar */}
      <div className="header" data-tauri-drag-region>
        <button className="fab-small" onClick={collapse} title="收起">
          <ClipboardCheck size={12} />
        </button>
        <div className="header-tabs" data-tauri-drag-region>
          <button
            className={`tab ${mode === "input" || mode === "list" ? "active" : ""}`}
            onClick={() => setMode("input")}
          >
            <ListTodo size={13} style={{marginRight: 3}} /> 待办
          </button>
          <button
            className={`tab ${mode === "stats" ? "active" : ""}`}
            onClick={() => loadStats(statsPeriod)}
          >
            <BarChart3 size={13} style={{marginRight: 3}} /> 统计
          </button>
          <button
            className={`tab ${mode === "settings" ? "active" : ""}`}
            onClick={() => setMode("settings")}
          >
            <Settings size={13} style={{marginRight: 3}} /> 设置
          </button>
        </div>
        <div className="header-actions">
          <button className="hdr-btn" onClick={handleImport} title="导入">
            <Upload size={13} />
          </button>
          <button className="hdr-btn" onClick={handleExport} title="导出">
            <Download size={13} />
          </button>
        </div>
        <button className="close-btn" onClick={collapse} title="收起">
          <X size={13} />
        </button>
      </div>

      {mode === "settings" ? (
        /* ── Settings view ── */
        <div className="settings-view">
          <div className="settings-section">
            <div className="settings-label">外观</div>
            <div className="settings-group">
              <div className={`settings-row ${themeMode === "system" ? "active" : ""}`} onClick={() => setThemeMode("system")}>
                <div className="settings-row-label">
                  <Monitor size={15} className="settings-row-icon" />
                  <span>跟随系统</span>
                </div>
                {themeMode === "system" && <Check size={15} className="check-mark" />}
              </div>
              <div className={`settings-row ${themeMode === "light" ? "active" : ""}`} onClick={() => setThemeMode("light")}>
                <div className="settings-row-label">
                  <Sun size={15} className="settings-row-icon" />
                  <span>浅色</span>
                </div>
                {themeMode === "light" && <Check size={15} className="check-mark" />}
              </div>
              <div className={`settings-row ${themeMode === "dark" ? "active" : ""}`} onClick={() => setThemeMode("dark")}>
                <div className="settings-row-label">
                  <Moon size={15} className="settings-row-icon" />
                  <span>深色</span>
                </div>
                {themeMode === "dark" && <Check size={15} className="check-mark" />}
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-label">待办栏透明度</div>
            <div className="settings-group">
              <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span>透明</span>
                  <span style={{ fontFamily: "'SF Mono', Menlo, monospace", color: "var(--accent)" }}>{Math.round(barOpacity * 100)}%</span>
                  <span>不透明</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={barOpacity}
                  onChange={(e) => updateBarOpacity(Number(e.target.value))}
                  className="opacity-slider"
                />
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-label">药丸栏高度</div>
            <div className="settings-group">
              <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span>紧凑</span>
                  <span style={{ fontFamily: "'SF Mono', Menlo, monospace", color: "var(--accent)" }}>{barH}px</span>
                  <span>宽松</span>
                </div>
                <input
                  type="range"
                  min={MIN_BAR_H}
                  max={MAX_BAR_H}
                  step="1"
                  value={barH}
                  onChange={(e) => updateBarH(Number(e.target.value))}
                  className="opacity-slider"
                />
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-label">通用</div>
            <div className="settings-group">
              <div className="settings-row" onClick={async () => {
                const next = !autostart;
                try {
                  await invoke("set_autostart", { enabled: next });
                  setAutostart(next);
                } catch (e) { console.error(e); }
              }}>
                <div className="settings-row-label">
                  <span>开机自动启动</span>
                </div>
                <div className={`toggle ${autostart ? "on" : ""}`}>
                  <div className="toggle-knob" />
                </div>
              </div>
              <div className="settings-row" onClick={() => {
                const next = !midnightComplete;
                setMidnightComplete(next);
                localStorage.setItem("midnight-complete", String(next));
              }}>
                <div className="settings-row-label">
                  <span>凌晨自动完成所有任务</span>
                </div>
                <div className={`toggle ${midnightComplete ? "on" : ""}`}>
                  <div className="toggle-knob" />
                </div>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-label">标签管理</div>
            <div className="settings-group">
              {tags.map((tag) => (
                <div key={tag.id} className="settings-row tag-manage-row">
                  {editingTag?.id === tag.id ? (
                    <>
                      <input type="color" className="tag-color-picker" value={editingTag.color}
                        onChange={(e) => setEditingTag({ ...editingTag, color: e.target.value })} />
                      <input className="tag-name-input" value={editingTag.name}
                        onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveTag(); if (e.key === "Escape") setEditingTag(null); }} autoFocus />
                      <button className="tag-action-btn save" onClick={handleSaveTag} title="保存"><Check size={12} /></button>
                      <button className="tag-action-btn cancel" onClick={() => setEditingTag(null)} title="取消"><X size={12} /></button>
                    </>
                  ) : (
                    <>
                      <span className="tag-dot" style={{ background: tag.color }} />
                      <span className="tag-manage-name">{tag.name}</span>
                      <button className="tag-action-btn" onClick={() => setEditingTag({ ...tag })} title="编辑"><Pencil size={11} /></button>
                      <button className="tag-action-btn danger" onClick={() => handleDeleteTag(tag.id)} title="删除"><Trash2 size={11} /></button>
                    </>
                  )}
                </div>
              ))}
              <div className="settings-row tag-manage-row">
                <input type="color" className="tag-color-picker" value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)} />
                <input className="tag-name-input" placeholder="新标签名..." value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddTag(); }} />
                <button className="tag-action-btn save" onClick={handleAddTag} title="添加"><Plus size={12} /></button>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-label">快捷操作</div>
            <div className="settings-group">
              <div className="settings-row" style={{ cursor: "default" }}>
                <span>拖拽药丸条空白区域</span>
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>移动窗口</span>
              </div>
              <div className="settings-row" style={{ cursor: "default" }}>
                <span>拖拽右侧边缘</span>
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>调整宽度</span>
              </div>
              <div className="settings-row" style={{ cursor: "default" }}>
                <span>双击右侧边缘</span>
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>缩成圆球</span>
              </div>
              <div className="settings-row" style={{ cursor: "default" }}>
                <span>单击圆球</span>
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>打开面板</span>
              </div>
              <div className="settings-row" style={{ cursor: "default" }}>
                <span>双击圆球</span>
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>恢复药丸条</span>
              </div>
              <div className="settings-row" style={{ cursor: "default" }}>
                <span>点击待办图标</span>
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>展开管理面板</span>
              </div>
              <div className="settings-row" style={{ cursor: "default" }}>
                <span>点击任务名</span>
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>编辑任务名</span>
              </div>
              <div className="settings-row" style={{ cursor: "default" }}>
                <span>点击红色角标</span>
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>查看运行中任务</span>
              </div>
            </div>
          </div>
        </div>
      ) : mode === "stats" ? (
        /* ── Stats view ── */
        <div className="stats-view">
          {/* View toggle + search */}
          <div className="stats-toolbar">
            <div className="stats-toggle">
              <button className={`toggle-btn ${statsView === "tag" ? "active" : ""}`} onClick={() => setStatsView("tag")}>
                <BarChart3 size={12} /> 标签
              </button>
              <button className={`toggle-btn ${statsView === "calendar" ? "active" : ""}`} onClick={() => { setStatsView("calendar"); loadCalMonth(calMonth[0], calMonth[1]); }}>
                <Calendar size={12} /> 日历
              </button>
            </div>
            <div className="stats-search">
              <Search size={12} className="search-icon" />
              <input
                type="text"
                className="search-input"
                placeholder="搜索待办..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
              />
              {searchQuery && <button className="search-clear" onClick={() => { setSearchQuery(""); setSearchResults(null); }}>
                <X size={10} />
              </button>}
            </div>
          </div>

          {/* Search results overlay */}
          {searchResults !== null ? (
            <div className="search-results">
              {searchResults.length === 0 ? (
                <div className="empty">未找到匹配待办</div>
              ) : (
                searchResults.map((t) => (
                  <div key={t.id} className="cal-todo-row">
                    <div className="cal-todo-info">
                      <span className="cal-todo-title">{t.title}</span>
                      <span className="cal-todo-meta">
                        {fmtDate(t.created_at)}
                        {t.timer_elapsed_sec > 0 && ` · ${formatTime(t.timer_elapsed_sec)}`}
                      </span>
                    </div>
                    <div className="cal-todo-tags">
                      {t.tags?.map((tg: Tag) => (
                        <span key={tg.id} className="mini-tag" style={{ background: tg.color + "22", color: tg.color }}>{tg.name}</span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : statsView === "tag" ? (
            <>
              {/* Tag stats periods */}
              <div className="stats-periods">
                {(["day", "week", "month"] as const).map((p) => (
                  <button
                    key={p}
                    className={`period-btn ${statsPeriod === p ? "active" : ""}`}
                    onClick={() => loadStats(p)}
                  >
                    {p === "day" ? "今天" : p === "week" ? "本周" : "本月"}
                  </button>
                ))}
                <button
                  className={`period-btn ${statsPeriod === "custom" ? "active" : ""}`}
                  onClick={() => loadStats("custom")}
                >
                  指定日期
                </button>
              </div>
              {statsPeriod === "custom" && (
                <div className="stats-date-row">
                  <label>日期</label>
                  <input
                    type="date"
                    className="stats-date-input"
                    value={statsDate}
                    onChange={(e) => {
                      setStatsDate(e.target.value);
                      loadStats("custom", e.target.value);
                    }}
                  />
                </div>
              )}
              {stats.length === 0 ? (
                <div className="empty">暂无数据</div>
              ) : (
                <div className="stats-list">
                  {stats.map((s) => (
                    <div key={s.tag.id} className="stat-row">
                      <div className="stat-tag">
                        <span className="tag-dot" style={{ background: s.tag.color }} />
                        <span>{s.tag.name}</span>
                        <span className="stat-count">{s.todo_count}条</span>
                      </div>
                      <div className="stat-bar-container">
                        <div className="stat-bar" style={{ width: `${s.percentage}%`, background: s.tag.color }} />
                      </div>
                      <div className="stat-info">
                        <span className="stat-time">{formatTime(s.total_seconds)}</span>
                        <span className="stat-pct">{s.percentage.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Calendar view */}
              <div className="cal-header">
                <button className="cal-nav" onClick={() => {
                  const [y, m] = calMonth;
                  const prev = m === 0 ? [y - 1, 11] : [y, m - 1];
                  loadCalMonth(prev[0], prev[1]);
                }}><ChevronLeft size={14} /></button>
                <span className="cal-title">{calMonth[0]}年{calMonth[1] + 1}月</span>
                <button className="cal-nav" onClick={() => {
                  const [y, m] = calMonth;
                  const next = m === 11 ? [y + 1, 0] : [y, m + 1];
                  loadCalMonth(next[0], next[1]);
                }}><ChevronRight size={14} /></button>
              </div>
              <div className="cal-grid">
                {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
                  <div key={d} className="cal-weekday">{d}</div>
                ))}
                {(() => {
                  const [year, month] = calMonth;
                  const firstDay = new Date(year, month, 1).getDay();
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const cells = [];
                  for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} className="cal-cell empty" />);
                  for (let d = 1; d <= daysInMonth; d++) {
                    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                    const count = calDates.get(key) || 0;
                    const isSelected = calSelectedDay === key;
                    const isToday = key === new Date().toISOString().slice(0, 10);
                    cells.push(
                      <div
                        key={key}
                        className={`cal-cell${count > 0 ? " has-todos" : ""}${isSelected ? " selected" : ""}${isToday ? " today" : ""}`}
                        onClick={() => count > 0 && loadCalDay(key)}
                      >
                        <span className="cal-day">{d}</span>
                        {count > 0 && <span className="cal-dot">{count}</span>}
                      </div>
                    );
                  }
                  return cells;
                })()}
              </div>
              {/* Day detail */}
              {calDayTodos && (
                <div className="cal-day-detail">
                  <div className="cal-day-header">{calSelectedDay} · {calDayTodos.length}条待办</div>
                  {calDayTodos.map((t) => (
                    <div key={t.id} className="cal-todo-row">
                      <div className="cal-todo-info">
                        <span className="cal-todo-title">{t.title}</span>
                        <span className="cal-todo-meta">
                          {t.timer_elapsed_sec > 0 && formatTime(t.timer_elapsed_sec)}
                          {t.status === "archived" && " · 已归档"}
                          {t.status === "completed" && " · 已完成"}
                        </span>
                      </div>
                      <div className="cal-todo-tags">
                        {t.tags?.map((tg: Tag) => (
                          <span key={tg.id} className="mini-tag" style={{ background: tg.color + "22", color: tg.color }}>{tg.name}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* ── Input + List view ── */
        <div className="main-view">
          <div className="input-row">
            <input
              ref={inputRef}
              type="text"
              className="todo-input"
              placeholder="输入待办，回车创建..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
                if (e.key === "Escape") collapse();
              }}
            />
          </div>

          <div className="tag-row">
            {tags.map((tag) => (
              <button
                key={tag.id}
                className={`tag-pill ${selectedTagIds.includes(tag.id) ? "selected" : ""}`}
                style={{
                  borderColor: tag.color,
                  background: selectedTagIds.includes(tag.id) ? tag.color : "transparent",
                  color: selectedTagIds.includes(tag.id) ? "#fff" : tag.color,
                }}
                onClick={() => toggleTag(tag.id)}
              >
                <span className="tag-dot" style={{ background: tag.color }} />{tag.name}
              </button>
            ))}
          </div>

          <div className="todo-list">
            {activeTodos.length === 0 && completedTodos.length === 0 && (
              <div className="empty">还没有待办，输入一个吧 ↑</div>
            )}
            {activeTodos.map((todo) => (
              <div key={todo.id} className={`todo-item ${todo.timer_status === "running" ? "running" : ""}`}>
                <div className="todo-main">
                  <span className="todo-title">{todo.title}</span>
                  <div className="todo-tags">
                    {todo.tags.map((t) => (
                      <span key={t.id} className="mini-tag" style={{ background: t.color }}>{t.name}</span>
                    ))}
                  </div>
                </div>
                <div className="todo-actions">
                  <span className="timer">{formatTime(getElapsed(todo))}</span>
                  <button className="act-btn edit" onClick={() => openEdit(todo)} title="编辑">
                    <Pencil size={12} />
                  </button>
                  {todo.timer_status === "running" ? (
                    <button className="act-btn pause" onClick={() => handlePause(todo.id)} title="暂停">
                      <Pause size={13} />
                    </button>
                  ) : (
                    <button className="act-btn play" onClick={() => handleStart(todo.id)} title="开始">
                      <Play size={13} />
                    </button>
                  )}
                  <button className="act-btn done" onClick={() => handleComplete(todo.id)} title="完成">
                    <Check size={13} />
                  </button>
                </div>
              </div>
            ))}

            {completedTodos.length > 0 && (
              <>
                <button className="section-toggle" onClick={() => setShowCompleted(!showCompleted)}>
                  {showCompleted ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  已完成 ({completedTodos.length})
                </button>
                {showCompleted &&
                  completedTodos.map((todo) => (
                    <div key={todo.id} className="todo-item completed">
                      <div className="todo-main">
                        <span className="todo-title line-through">{todo.title}</span>
                        <div className="todo-tags">
                          {todo.tags.map((t) => (
                            <span key={t.id} className="mini-tag" style={{ background: t.color, opacity: 0.6 }}>{t.name}</span>
                          ))}
                        </div>
                      </div>
                      <div className="todo-actions">
                        <span className="timer dim">{formatTime(todo.timer_elapsed_sec)}</span>
                        <button className="act-btn edit" onClick={() => openEdit(todo)} title="编辑">
                          <Pencil size={12} />
                        </button>
                        <button className="act-btn reopen" onClick={() => handleReopen(todo.id)} title="重新开始">
                          <RotateCcw size={13} />
                        </button>
                        <button className="act-btn archive" onClick={() => handleArchive(todo.id)} title="归档">
                          <Archive size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>
      )}
      {editingTodo && (
        <div className="edit-overlay" onClick={() => setEditingTodo(null)}>
          <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="edit-header">
              <span className="edit-header-title">编辑待办</span>
              <button className="edit-close" onClick={() => setEditingTodo(null)}><X size={14} /></button>
            </div>
            <div className="edit-body">
              <label className="edit-label">标题</label>
              <input
                className="edit-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); }}
                autoFocus
              />
              <label className="edit-label">标签</label>
              <div className="edit-tags">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    className={`tag-pill ${editTagIds.includes(tag.id) ? "selected" : ""}`}
                    style={{
                      borderColor: tag.color,
                      background: editTagIds.includes(tag.id) ? tag.color : "transparent",
                      color: editTagIds.includes(tag.id) ? "#fff" : tag.color,
                    }}
                    onClick={() => setEditTagIds((prev) =>
                      prev.includes(tag.id) ? prev.filter((i) => i !== tag.id) : [...prev, tag.id]
                    )}
                  >
                    <span className="tag-dot" style={{ background: tag.color }} />{tag.name}
                  </button>
                ))}
              </div>
              <label className="edit-label">耗时</label>
              <div className="edit-time-row">
                <input type="number" className="edit-time-input" min={0} value={editH} onChange={(e) => setEditH(Math.max(0, Number(e.target.value)))} /><span className="edit-time-sep">时</span>
                <input type="number" className="edit-time-input" min={0} max={59} value={editM} onChange={(e) => setEditM(Math.max(0, Math.min(59, Number(e.target.value))))} /><span className="edit-time-sep">分</span>
                <input type="number" className="edit-time-input" min={0} max={59} value={editS} onChange={(e) => setEditS(Math.max(0, Math.min(59, Number(e.target.value))))} /><span className="edit-time-sep">秒</span>
              </div>
            </div>
            <div className="edit-footer">
              <button className="edit-btn danger" onClick={deleteFromEdit} title="彻底删除此待办">
                <Trash2 size={12} /> 删除
              </button>
              <div style={{ flex: 1 }} />
              <button className="edit-btn cancel" onClick={() => setEditingTodo(null)}>取消</button>
              <button className="edit-btn save" onClick={saveEdit}>保存</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
