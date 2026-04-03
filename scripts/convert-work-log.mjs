#!/usr/bin/env node
// 将"工作记录.txt"(UTF-16)转换为 floating-todo 的导入 JSON 格式
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const inputPath = join(homedir(), "Desktop", "工作记录.txt");
const outputPath = join(homedir(), "Desktop", "工作记录-导入.json");

// 读取 UTF-16 文件
const buf = readFileSync(inputPath);
const text = buf.toString("utf16le").replace(/^\uFEFF/, ""); // strip BOM

// 标签关键词映射
const tagRules = [
  { name: "开发", keywords: ["开发", "功能", "代码", "迁移", "适配", "优化", "调整功能", "需求"] },
  { name: "测试", keywords: ["测试", "自测", "bug", "BUG"] },
  { name: "运维", keywords: ["运维", "服务器", "排查", "重启", "升级", "回收", "新增服务器", "新建", "堡垒机", "机房", "vpn", "docker", "cpu", "内存", "磁盘", "打包"] },
  { name: "会议", keywords: ["会议", "早会", "汇报", "培训", "沟通", "讨论"] },
  { name: "文档", keywords: ["资料", "文档", "梳理", "整理", "导出", "清单"] },
  { name: "沟通", keywords: ["反馈", "咨询", "答疑", "协助", "电话", "沟通", "解答"] },
  { name: "学习", keywords: ["学习", "培训会", "研究"] },
];

function detectTagNames(title) {
  const matched = [];
  for (const rule of tagRules) {
    if (rule.keywords.some((kw) => title.includes(kw))) {
      matched.push(rule.name);
    }
  }
  if (matched.length === 0) matched.push("其他");
  // 去重，最多2个标签
  return [...new Set(matched)].slice(0, 2);
}

// 解析时间 => 秒
function parseTime(text) {
  let totalSec = 0;
  // "6+1H" => 7H
  const plusH = text.match(/(\d+)\+(\d+)H/i);
  if (plusH) return (parseInt(plusH[1]) + parseInt(plusH[2])) * 3600;

  // "1.5H" / "8H" / "6小时" / "4小时"
  const hMatch = text.match(/([\d.]+)\s*[Hh小时]/);
  if (hMatch) totalSec += parseFloat(hMatch[1]) * 3600;

  // "60分钟" / "30分" / "15分钟"
  const mMatch = text.match(/([\d.]+)\s*分/);
  if (mMatch) totalSec += parseFloat(mMatch[1]) * 60;

  return Math.round(totalSec);
}

// 解析日期 => unix timestamp (当天0点)
function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 9, 0, 0); // 假设9点开始工作
  return Math.floor(dt.getTime() / 1000);
}

// 解析文件
const lines = text.split(/\r?\n/);
const todos = [];
let currentDate = null;
let currentDateTs = 0;
let taskIndex = 0;
let buffer = ""; // 多行合并

function flushBuffer() {
  if (!buffer.trim() || !currentDate) return;
  const title = buffer
    .replace(/^\d+\.\s*/, "") // 去掉序号
    .replace(/\s+/g, " ")     // 合并空白
    .trim();
  if (!title || title.length < 2) { buffer = ""; return; }
  
  const elapsed = parseTime(buffer);
  const tagNames = detectTagNames(title);
  const createdAt = currentDateTs + taskIndex * 60; // 每个任务间隔1分钟
  
  todos.push({
    title,
    description: null,
    status: "completed",
    timer_status: "stopped",
    timer_elapsed_sec: elapsed || 0,
    created_at: createdAt,
    completed_at: createdAt + (elapsed || 3600),
    archived_at: createdAt + (elapsed || 3600),
    tag_names: tagNames,
  });
  taskIndex++;
  buffer = "";
}

for (const line of lines) {
  const trimmed = line.trim();
  
  // 日期行
  const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateMatch) {
    flushBuffer();
    currentDate = dateMatch[1];
    currentDateTs = parseDate(currentDate);
    taskIndex = 0;
    continue;
  }
  
  // 任务行 (以数字.开头)
  const taskMatch = trimmed.match(/^(\d+)\./);
  if (taskMatch && currentDate) {
    flushBuffer();
    buffer = trimmed;
    continue;
  }
  
  // 跳过空行和非任务内容（如"上周"、"待办"、服务器表格等）
  if (!trimmed || /^(上周|本周|待办|IP |总计|192\.|一、|二、|\d+）)/.test(trimmed)) {
    flushBuffer();
    continue;
  }
  
  // 续行
  if (buffer) {
    buffer += trimmed;
  }
}
flushBuffer();

// 构建导出格式
const exportData = {
  version: 1,
  exported_at: Math.floor(Date.now() / 1000),
  tags: [
    { name: "开发", color: "#4CAF50", icon: null },
    { name: "测试", color: "#FF9800", icon: null },
    { name: "运维", color: "#2196F3", icon: null },
    { name: "会议", color: "#9C27B0", icon: null },
    { name: "文档", color: "#795548", icon: null },
    { name: "沟通", color: "#00BCD4", icon: null },
    { name: "学习", color: "#FF5722", icon: null },
    { name: "其他", color: "#9E9E9E", icon: null },
  ],
  todos,
};

writeFileSync(outputPath, JSON.stringify(exportData, null, 2), "utf-8");
console.log(`✅ 转换完成: ${todos.length} 条待办`);
console.log(`📄 输出: ${outputPath}`);

// 统计标签分布
const tagCount = {};
for (const t of todos) {
  for (const tn of t.tag_names) {
    tagCount[tn] = (tagCount[tn] || 0) + 1;
  }
}
console.log("📊 标签分布:", tagCount);
