use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::{Tag, Todo, TagTimeStat};

#[derive(Serialize, Deserialize)]
struct ExportTodo {
    title: String,
    description: Option<String>,
    status: String,
    timer_status: String,
    timer_elapsed_sec: i64,
    created_at: i64,
    completed_at: Option<i64>,
    archived_at: Option<i64>,
    tag_names: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct ExportData {
    version: i32,
    exported_at: i64,
    tags: Vec<ExportTag>,
    todos: Vec<ExportTodo>,
}

#[derive(Serialize, Deserialize)]
struct ExportTag {
    name: String,
    color: String,
    icon: Option<String>,
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(&path)?;
        let db = Self { conn: Mutex::new(conn) };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT DEFAULT '#888888',
                icon TEXT,
                sort_order INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                timer_status TEXT NOT NULL DEFAULT 'stopped',
                timer_started_at INTEGER,
                timer_elapsed_sec INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                completed_at INTEGER,
                archived_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
            CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at);

            CREATE TABLE IF NOT EXISTS todo_tags (
                todo_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (todo_id, tag_id),
                FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );
        "#)?;

        // Insert default tags if empty
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))?;
        if count == 0 {
            conn.execute_batch(r#"
                INSERT INTO tags (name, color, icon, sort_order) VALUES
                    ('开发', '#4CAF50', '💻', 1),
                    ('测试', '#FF9800', '🧪', 2),
                    ('运维', '#2196F3', '🔧', 3),
                    ('会议', '#9C27B0', '🎥', 4),
                    ('文档', '#795548', '📝', 5),
                    ('沟通', '#00BCD4', '💬', 6),
                    ('学习', '#FF5722', '📚', 7),
                    ('其他', '#9E9E9E', '📌', 8);
            "#)?;
        }
        Ok(())
    }

    // ── Tags ──

    pub fn get_tags(&self) -> Result<Vec<Tag>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, color, icon, sort_order FROM tags ORDER BY sort_order")?;
        let tags = stmt.query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                icon: row.get(3)?,
                sort_order: row.get(4)?,
            })
        })?.collect::<Result<Vec<_>>>()?;
        Ok(tags)
    }

    pub fn create_tag(&self, name: &str, color: &str, icon: Option<&str>) -> Result<Tag> {
        let conn = self.conn.lock().unwrap();
        let max_order: i64 = conn.query_row("SELECT COALESCE(MAX(sort_order), 0) FROM tags", [], |r| r.get(0))?;
        conn.execute(
            "INSERT INTO tags (name, color, icon, sort_order) VALUES (?, ?, ?, ?)",
            params![name, color, icon, max_order + 1],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Tag { id, name: name.to_string(), color: color.to_string(), icon: icon.map(|s| s.to_string()), sort_order: max_order + 1 })
    }

    pub fn update_tag(&self, id: i64, name: &str, color: &str, icon: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE tags SET name = ?, color = ?, icon = ? WHERE id = ?", params![name, color, icon, id])?;
        Ok(())
    }

    pub fn delete_tag(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM tags WHERE id = ?", params![id])?;
        Ok(())
    }

    // ── Todos ──

    fn get_tags_for_todo(&self, conn: &Connection, todo_id: i64) -> Result<Vec<Tag>> {
        let mut stmt = conn.prepare(
            "SELECT t.id, t.name, t.color, t.icon, t.sort_order FROM tags t
             JOIN todo_tags tt ON t.id = tt.tag_id WHERE tt.todo_id = ? ORDER BY t.sort_order"
        )?;
        let tags = stmt.query_map(params![todo_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                icon: row.get(3)?,
                sort_order: row.get(4)?,
            })
        })?.collect::<Result<Vec<_>>>()?;
        Ok(tags)
    }

    fn row_to_todo(row: &rusqlite::Row) -> rusqlite::Result<Todo> {
        Ok(Todo {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            status: row.get(3)?,
            timer_status: row.get(4)?,
            timer_started_at: row.get(5)?,
            timer_elapsed_sec: row.get(6)?,
            created_at: row.get(7)?,
            completed_at: row.get(8)?,
            archived_at: row.get(9)?,
            tags: vec![],
        })
    }

    pub fn get_todos(&self, status_filter: Option<&str>, today_start: Option<i64>) -> Result<Vec<Todo>> {
        let conn = self.conn.lock().unwrap();
        let mut todos = if let Some(status) = status_filter {
            let mut stmt = conn.prepare(
                "SELECT id, title, description, status, timer_status, timer_started_at, timer_elapsed_sec, created_at, completed_at, archived_at
                 FROM todos WHERE status = ? ORDER BY created_at DESC"
            )?;
            let rows = stmt.query_map(params![status], Self::row_to_todo)?;
            let result: Result<Vec<_>> = rows.collect();
            result?
        } else if let Some(ts) = today_start {
            let mut stmt = conn.prepare(
                "SELECT id, title, description, status, timer_status, timer_started_at, timer_elapsed_sec, created_at, completed_at, archived_at
                 FROM todos WHERE status != 'archived' AND (created_at >= ? OR timer_status = 'running') ORDER BY
                 CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'completed' THEN 2 END,
                 created_at DESC"
            )?;
            let rows = stmt.query_map(params![ts], Self::row_to_todo)?;
            let result: Result<Vec<_>> = rows.collect();
            result?
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, title, description, status, timer_status, timer_started_at, timer_elapsed_sec, created_at, completed_at, archived_at
                 FROM todos WHERE status != 'archived' ORDER BY
                 CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'completed' THEN 2 END,
                 created_at DESC"
            )?;
            let rows = stmt.query_map([], Self::row_to_todo)?;
            let result: Result<Vec<_>> = rows.collect();
            result?
        };
        for todo in &mut todos {
            todo.tags = self.get_tags_for_todo(&conn, todo.id)?;
        }
        Ok(todos)
    }

    pub fn create_todo(&self, title: &str, tag_ids: &[i64]) -> Result<Todo> {
        let conn = self.conn.lock().unwrap();
        let ts = now();
        conn.execute(
            "INSERT INTO todos (title, status, timer_status, timer_started_at, timer_elapsed_sec, created_at) VALUES (?, 'in_progress', 'running', ?, 0, ?)",
            params![title, ts, ts],
        )?;
        let id = conn.last_insert_rowid();
        for tag_id in tag_ids {
            conn.execute("INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)", params![id, tag_id])?;
        }
        let tags = self.get_tags_for_todo(&conn, id)?;
        Ok(Todo {
            id, title: title.to_string(), description: None,
            status: "in_progress".to_string(), timer_status: "running".to_string(),
            timer_started_at: Some(ts), timer_elapsed_sec: 0,
            created_at: ts, completed_at: None, archived_at: None, tags,
        })
    }

    pub fn complete_todo(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let ts = now();
        // Calculate final elapsed time if timer was running
        let row: (String, Option<i64>, i64) = conn.query_row(
            "SELECT timer_status, timer_started_at, timer_elapsed_sec FROM todos WHERE id = ?",
            params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        )?;
        let extra = if row.0 == "running" { row.1.map(|s| ts - s).unwrap_or(0) } else { 0 };
        conn.execute(
            "UPDATE todos SET status = 'completed', timer_status = 'stopped', timer_started_at = NULL, timer_elapsed_sec = ?, completed_at = ? WHERE id = ?",
            params![row.2 + extra, ts, id],
        )?;
        Ok(())
    }

    pub fn archive_old_completed(&self, today_start: i64) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let ts = now();
        let count = conn.execute(
            "UPDATE todos SET status = 'archived', archived_at = ? WHERE status = 'completed' AND created_at < ?",
            params![ts, today_start],
        )?;
        Ok(count as i64)
    }

    pub fn archive_todo(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE todos SET status = 'archived', archived_at = ? WHERE id = ?", params![now(), id])?;
        Ok(())
    }

    pub fn reopen_todo(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE todos SET status = 'pending', timer_status = 'stopped', timer_started_at = NULL, completed_at = NULL, archived_at = NULL WHERE id = ?",
            params![id],
        )?;
        Ok(())
    }

    pub fn start_timer(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let ts = now();
        conn.execute(
            "UPDATE todos SET status = 'in_progress', timer_status = 'running', timer_started_at = ? WHERE id = ?",
            params![ts, id],
        )?;
        Ok(())
    }

    pub fn pause_timer(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let ts = now();
        let row: (Option<i64>, i64) = conn.query_row(
            "SELECT timer_started_at, timer_elapsed_sec FROM todos WHERE id = ?",
            params![id], |r| Ok((r.get(0)?, r.get(1)?))
        )?;
        let extra = row.0.map(|s| ts - s).unwrap_or(0);
        conn.execute(
            "UPDATE todos SET timer_status = 'paused', timer_started_at = NULL, timer_elapsed_sec = ? WHERE id = ?",
            params![row.1 + extra, id],
        )?;
        Ok(())
    }

    pub fn update_todo_time(&self, id: i64, elapsed_sec: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE todos SET timer_elapsed_sec = ? WHERE id = ?", params![elapsed_sec, id])?;
        Ok(())
    }

    pub fn update_todo(&self, id: i64, title: &str, tag_ids: &[i64], elapsed_sec: Option<i64>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        if let Some(sec) = elapsed_sec {
            conn.execute("UPDATE todos SET title = ?, timer_elapsed_sec = ? WHERE id = ?", params![title, sec, id])?;
        } else {
            conn.execute("UPDATE todos SET title = ? WHERE id = ?", params![title, id])?;
        }
        conn.execute("DELETE FROM todo_tags WHERE todo_id = ?", params![id])?;
        for tag_id in tag_ids {
            conn.execute("INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)", params![id, tag_id])?;
        }
        Ok(())
    }

    pub fn delete_todo(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM todos WHERE id = ?", params![id])?;
        Ok(())
    }

    // ── Stats ──

    pub fn get_tag_stats(&self, start_ts: i64, end_ts: i64) -> Result<Vec<TagTimeStat>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.name, t.color, t.icon, t.sort_order,
                    COALESCE(SUM(td.timer_elapsed_sec), 0) as total_sec,
                    COUNT(DISTINCT td.id) as todo_count
             FROM tags t
             LEFT JOIN todo_tags tt ON t.id = tt.tag_id
             LEFT JOIN todos td ON tt.todo_id = td.id AND td.created_at >= ? AND td.created_at < ? AND td.status != 'archived'
             GROUP BY t.id
             HAVING total_sec > 0
             ORDER BY total_sec DESC"
        )?;
        let stats: Vec<(Tag, i64, i64)> = stmt.query_map(params![start_ts, end_ts], |row| {
            Ok((
                Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, icon: row.get(3)?, sort_order: row.get(4)? },
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?.collect::<Result<Vec<_>>>()?;

        let grand_total: i64 = stats.iter().map(|s| s.1).sum();
        let result = stats.into_iter().map(|(tag, secs, count)| {
            TagTimeStat {
                tag,
                total_seconds: secs,
                percentage: if grand_total > 0 { (secs as f64 / grand_total as f64) * 100.0 } else { 0.0 },
                todo_count: count,
            }
        }).collect();
        Ok(result)
    }

    // ── Calendar / Search ──

    pub fn get_todos_by_date(&self, start_ts: i64, end_ts: i64) -> Result<Vec<Todo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, description, status, timer_status, timer_started_at, timer_elapsed_sec, created_at, completed_at, archived_at
             FROM todos WHERE created_at >= ? AND created_at < ?
             ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map(params![start_ts, end_ts], Self::row_to_todo)?;
        let mut todos: Vec<Todo> = rows.collect::<Result<Vec<_>>>()?;
        for todo in &mut todos {
            todo.tags = self.get_tags_for_todo(&conn, todo.id)?;
        }
        Ok(todos)
    }

    pub fn get_todo_dates(&self, start_ts: i64, end_ts: i64, tz_offset_sec: Option<i64>) -> Result<Vec<(i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let tz = tz_offset_sec.unwrap_or(8 * 3600); // default CST +8
        let mut stmt = conn.prepare(
            "SELECT ((created_at + ?1) / 86400) * 86400 - ?1 as day_ts, COUNT(*) as cnt
             FROM todos WHERE created_at >= ?2 AND created_at < ?3
             GROUP BY day_ts ORDER BY day_ts"
        )?;
        let rows = stmt.query_map(params![tz, start_ts, end_ts], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })?;
        rows.collect::<Result<Vec<_>>>()
    }

    pub fn search_todos(&self, query: &str) -> Result<Vec<Todo>> {
        let conn = self.conn.lock().unwrap();
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, title, description, status, timer_status, timer_started_at, timer_elapsed_sec, created_at, completed_at, archived_at
             FROM todos WHERE title LIKE ? ORDER BY created_at DESC LIMIT 100"
        )?;
        let rows = stmt.query_map(params![pattern], Self::row_to_todo)?;
        let mut todos: Vec<Todo> = rows.collect::<Result<Vec<_>>>()?;
        for todo in &mut todos {
            todo.tags = self.get_tags_for_todo(&conn, todo.id)?;
        }
        Ok(todos)
    }

    // ── Export / Import ──

    pub fn export_todos(&self, path: &Path) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tags = {
            let mut stmt = conn.prepare("SELECT id, name, color, icon, sort_order FROM tags ORDER BY sort_order")?;
            let rows = stmt.query_map([], |row| {
                Ok(Tag { id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, icon: row.get(3)?, sort_order: row.get(4)? })
            })?;
            rows.collect::<Result<Vec<_>>>()?
        };
        let todos = {
            let mut stmt = conn.prepare(
                "SELECT id, title, description, status, timer_status, timer_started_at, timer_elapsed_sec, created_at, completed_at, archived_at FROM todos ORDER BY created_at"
            )?;
            let rows = stmt.query_map([], Self::row_to_todo)?;
            rows.collect::<Result<Vec<_>>>()?
        };

        let export_tags: Vec<ExportTag> = tags.iter().map(|t| ExportTag {
            name: t.name.clone(), color: t.color.clone(), icon: t.icon.clone(),
        }).collect();

        let mut export_todos: Vec<ExportTodo> = Vec::new();
        for todo in &todos {
            let tag_names = self.get_tags_for_todo(&conn, todo.id)?
                .into_iter().map(|t| t.name).collect();
            export_todos.push(ExportTodo {
                title: todo.title.clone(),
                description: todo.description.clone(),
                status: todo.status.clone(),
                timer_status: todo.timer_status.clone(),
                timer_elapsed_sec: todo.timer_elapsed_sec,
                created_at: todo.created_at,
                completed_at: todo.completed_at,
                archived_at: todo.archived_at,
                tag_names,
            });
        }

        let data = ExportData {
            version: 1,
            exported_at: now(),
            tags: export_tags,
            todos: export_todos,
        };
        let json = serde_json::to_string_pretty(&data).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        std::fs::write(path, json).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        Ok(())
    }

    pub fn export_csv(&self, path: &Path) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, status, timer_elapsed_sec, timer_status, timer_started_at, created_at, completed_at FROM todos ORDER BY created_at DESC"
        )?;
        let rows: Vec<(i64, String, String, i64, String, Option<i64>, i64, Option<i64>)> = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?))
        })?.collect::<Result<Vec<_>>>()?;

        let mut out = String::from("title,status,tags,elapsed,created_at,completed_at\n");
        for (id, title, status, elapsed, timer_status, started_at, created_at, completed_at) in &rows {
            let tags = self.get_tags_for_todo(&conn, *id)?;
            let tag_names: Vec<String> = tags.iter().map(|t| t.name.clone()).collect();
            let total_sec = if timer_status == "running" {
                elapsed + started_at.map(|s| now() - s).unwrap_or(0)
            } else { *elapsed };
            let h = total_sec / 3600;
            let m = (total_sec % 3600) / 60;
            let s = total_sec % 60;
            let csv_title = if title.contains(',') || title.contains('"') {
                format!("\"{}\"", title.replace('"', "\"\""))
            } else { title.clone() };
            out.push_str(&format!("{},{},{},{}:{:02}:{:02},{},{}\n",
                csv_title, status, tag_names.join(";"),
                h, m, s,
                Self::ts_to_date(*created_at),
                completed_at.map(|t| Self::ts_to_date(t)).unwrap_or_default(),
            ));
        }
        std::fs::write(path, out).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        Ok(())
    }

    pub fn export_markdown(&self, path: &Path) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, status, timer_elapsed_sec, timer_status, timer_started_at, created_at FROM todos ORDER BY created_at DESC"
        )?;
        let rows: Vec<(i64, String, String, i64, String, Option<i64>, i64)> = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        })?.collect::<Result<Vec<_>>>()?;

        let mut out = String::from("# 待办导出\n\n");
        let mut current_date = String::new();
        for (id, title, status, elapsed, timer_status, started_at, created_at) in &rows {
            let date = Self::ts_to_date(*created_at);
            if date != current_date {
                if !current_date.is_empty() { out.push('\n'); }
                out.push_str(&format!("## {}\n\n", date));
                current_date = date;
            }
            let check = if status == "completed" || status == "archived" { "x" } else { " " };
            let tags = self.get_tags_for_todo(&conn, *id)?;
            let tag_str = if tags.is_empty() { String::new() } else {
                format!(" [{}]", tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join(", "))
            };
            let total_sec = if timer_status == "running" {
                elapsed + started_at.map(|s| now() - s).unwrap_or(0)
            } else { *elapsed };
            let time_str = if total_sec > 0 {
                format!(" ({}:{:02}:{:02})", total_sec / 3600, (total_sec % 3600) / 60, total_sec % 60)
            } else { String::new() };
            out.push_str(&format!("- [{}] {}{}{}\n", check, title, tag_str, time_str));
        }
        std::fs::write(path, out).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        Ok(())
    }

    fn ts_to_date(ts: i64) -> String {
        let secs_per_day = 86400i64;
        let tz = 8 * 3600i64; // CST
        let local_ts = ts + tz;
        let days = local_ts / secs_per_day;
        // Approximate date calculation
        let mut y = 1970i64;
        let mut rem = days;
        loop {
            let dy = if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 { 366 } else { 365 };
            if rem < dy { break; }
            rem -= dy;
            y += 1;
        }
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let mdays = [31, if leap {29} else {28}, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let mut m = 0usize;
        for md in &mdays {
            if rem < *md as i64 { break; }
            rem -= *md as i64;
            m += 1;
        }
        format!("{}-{:02}-{:02}", y, m + 1, rem + 1)
    }

    pub fn import_todos(&self, path: &Path) -> Result<ImportResult> {
        let json = std::fs::read_to_string(path).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let data: ExportData = serde_json::from_str(&json).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let conn = self.conn.lock().unwrap();
        let mut imported = 0i64;
        let mut skipped = 0i64;

        // Import tags (merge by name)
        for etag in &data.tags {
            let exists: bool = conn.query_row(
                "SELECT COUNT(*) > 0 FROM tags WHERE name = ?", params![etag.name], |r| r.get(0)
            )?;
            if !exists {
                let max_order: i64 = conn.query_row("SELECT COALESCE(MAX(sort_order), 0) FROM tags", [], |r| r.get(0))?;
                conn.execute(
                    "INSERT INTO tags (name, color, icon, sort_order) VALUES (?, ?, ?, ?)",
                    params![etag.name, etag.color, etag.icon, max_order + 1],
                )?;
            }
        }

        // Import todos (skip duplicates by title + created_at)
        for etodo in &data.todos {
            let dup: bool = conn.query_row(
                "SELECT COUNT(*) > 0 FROM todos WHERE title = ? AND created_at = ?",
                params![etodo.title, etodo.created_at], |r| r.get(0)
            )?;
            if dup { skipped += 1; continue; }
            conn.execute(
                "INSERT INTO todos (title, description, status, timer_status, timer_started_at, timer_elapsed_sec, created_at, completed_at, archived_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)",
                params![etodo.title, etodo.description, etodo.status, "stopped", etodo.timer_elapsed_sec, etodo.created_at, etodo.completed_at, etodo.archived_at],
            )?;
            let todo_id = conn.last_insert_rowid();
            for tag_name in &etodo.tag_names {
                let tag_id: std::result::Result<i64, _> = conn.query_row(
                    "SELECT id FROM tags WHERE name = ?", params![tag_name], |r| r.get(0)
                );
                if let Ok(tid) = tag_id {
                    conn.execute("INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)", params![todo_id, tid])?;
                }
            }
            imported += 1;
        }
        Ok(ImportResult { imported, skipped })
    }

    // ── TXT import ──
    // Supported line formats:
    //   "2024-01-15 some task title"  (date prefix YYYY-MM-DD)
    //   "2024/01/15 some task title"  (date prefix YYYY/MM/DD)
    //   "some task title"             (no date, uses current time)
    //   "- [ ] task"  / "- [x] task"  (markdown checkbox)
    //   Empty lines and lines starting with # are skipped
    pub fn import_txt(&self, path: &Path) -> Result<ImportResult> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let conn = self.conn.lock().unwrap();
        let current_ts = now();
        let mut imported = 0i64;
        let mut skipped = 0i64;

        for raw_line in content.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') { continue; }

            let (title, created_at, status) = Self::parse_txt_line(line, current_ts);
            if title.is_empty() { continue; }

            // Dedup
            let dup: bool = conn.query_row(
                "SELECT COUNT(*) > 0 FROM todos WHERE title = ? AND created_at = ?",
                params![title, created_at], |r| r.get(0)
            )?;
            if dup { skipped += 1; continue; }

            conn.execute(
                "INSERT INTO todos (title, description, status, timer_status, timer_started_at, timer_elapsed_sec, created_at, completed_at, archived_at) VALUES (?, NULL, ?, 'stopped', NULL, 0, ?, ?, NULL)",
                params![title, status, created_at, if status == "completed" { Some(created_at) } else { None::<i64> }],
            )?;
            imported += 1;
        }
        Ok(ImportResult { imported, skipped })
    }

    fn parse_txt_line(line: &str, default_ts: i64) -> (String, i64, String) {
        let line = line.trim();

        // Markdown checkbox: "- [ ] task" or "- [x] task"
        if line.starts_with("- [") {
            let status = if line.starts_with("- [x]") || line.starts_with("- [X]") {
                "completed"
            } else {
                "pending"
            };
            let title = line.get(5..).unwrap_or("").trim().to_string();
            return (title, default_ts, status.to_string());
        }

        // Strip leading "- " or "* "
        let line = if line.starts_with("- ") || line.starts_with("* ") {
            &line[2..]
        } else {
            line
        };

        // Try date prefix: YYYY-MM-DD or YYYY/MM/DD
        if line.len() >= 11 {
            let date_part = &line[..10];
            let sep = if line.as_bytes().get(10) == Some(&b' ') { true } else { false };
            if sep {
                if let Some(ts) = Self::parse_date_str(date_part) {
                    let title = line[11..].trim().to_string();
                    if !title.is_empty() {
                        return (title, ts, "pending".to_string());
                    }
                }
            }
        }

        (line.trim().to_string(), default_ts, "pending".to_string())
    }

    fn parse_date_str(s: &str) -> Option<i64> {
        // YYYY-MM-DD or YYYY/MM/DD
        let parts: Vec<&str> = if s.contains('-') {
            s.split('-').collect()
        } else if s.contains('/') {
            s.split('/').collect()
        } else {
            return None;
        };
        if parts.len() != 3 { return None; }
        let y: i32 = parts[0].parse().ok()?;
        let m: u32 = parts[1].parse().ok()?;
        let d: u32 = parts[2].parse().ok()?;
        if y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31 { return None; }
        // Approximate: days since epoch
        // Use a simple calculation: convert to days
        let days = (y as i64 - 1970) * 365 + ((y as i64 - 1969) / 4)
            + Self::month_day_offset(m, y % 4 == 0 && (y % 100 != 0 || y % 400 == 0))
            + d as i64 - 1;
        Some(days * 86400 + 8 * 3600) // +8h for approx CST morning
    }

    fn month_day_offset(month: u32, leap: bool) -> i64 {
        let offsets = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        let base = offsets.get(month as usize - 1).copied().unwrap_or(0) as i64;
        if leap && month > 2 { base + 1 } else { base }
    }

    // ── CSV import ──
    // Expected columns (header row required): title, date, tags, status
    // - title: required
    // - date: optional, YYYY-MM-DD format
    // - tags: optional, semicolon-separated tag names
    // - status: optional, "pending"/"completed"/"archived" (default: "pending")
    pub fn import_csv(&self, path: &Path) -> Result<ImportResult> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let conn = self.conn.lock().unwrap();
        let current_ts = now();
        let mut imported = 0i64;
        let mut skipped = 0i64;

        let mut lines = content.lines();
        // Parse header
        let header_line = match lines.next() {
            Some(h) => h,
            None => return Ok(ImportResult { imported: 0, skipped: 0 }),
        };
        let headers: Vec<String> = Self::csv_split(header_line).iter().map(|h| h.trim().to_lowercase()).collect();
        let col_title = headers.iter().position(|h| h == "title" || h == "标题");
        let col_date = headers.iter().position(|h| h == "date" || h == "日期" || h == "created_at");
        let col_tags = headers.iter().position(|h| h == "tags" || h == "标签" || h == "tag");
        let col_status = headers.iter().position(|h| h == "status" || h == "状态");

        let title_idx = match col_title {
            Some(i) => i,
            None => return Err(rusqlite::Error::ToSqlConversionFailure(
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, "CSV missing 'title' column"))
            )),
        };

        for line in lines {
            let cols = Self::csv_split(line);
            let title = cols.get(title_idx).map(|s| s.trim()).unwrap_or("").to_string();
            if title.is_empty() { continue; }

            let created_at = col_date
                .and_then(|i| cols.get(i))
                .and_then(|s| Self::parse_date_str(s.trim()))
                .unwrap_or(current_ts);

            let status = col_status
                .and_then(|i| cols.get(i))
                .map(|s| {
                    let s = s.trim().to_lowercase();
                    match s.as_str() {
                        "completed" | "done" | "已完成" => "completed",
                        "archived" | "已归档" => "archived",
                        _ => "pending",
                    }.to_string()
                })
                .unwrap_or_else(|| "pending".to_string());

            let tag_names: Vec<String> = col_tags
                .and_then(|i| cols.get(i))
                .map(|s| s.split(';').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect())
                .unwrap_or_default();

            // Dedup
            let dup: bool = conn.query_row(
                "SELECT COUNT(*) > 0 FROM todos WHERE title = ? AND created_at = ?",
                params![title, created_at], |r| r.get(0)
            )?;
            if dup { skipped += 1; continue; }

            let completed_at = if status == "completed" { Some(created_at) } else { None };
            conn.execute(
                "INSERT INTO todos (title, description, status, timer_status, timer_started_at, timer_elapsed_sec, created_at, completed_at, archived_at) VALUES (?, NULL, ?, 'stopped', NULL, 0, ?, ?, NULL)",
                params![title, status, created_at, completed_at],
            )?;
            let todo_id = conn.last_insert_rowid();

            // Link tags (create if not exist)
            for tag_name in &tag_names {
                let tag_id: std::result::Result<i64, _> = conn.query_row(
                    "SELECT id FROM tags WHERE name = ?", params![tag_name], |r| r.get(0)
                );
                let tid = match tag_id {
                    Ok(id) => id,
                    Err(_) => {
                        let max_order: i64 = conn.query_row("SELECT COALESCE(MAX(sort_order), 0) FROM tags", [], |r| r.get(0))?;
                        conn.execute(
                            "INSERT INTO tags (name, color, icon, sort_order) VALUES (?, '#86868b', NULL, ?)",
                            params![tag_name, max_order + 1],
                        )?;
                        conn.last_insert_rowid()
                    }
                };
                conn.execute("INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)", params![todo_id, tid])?;
            }

            imported += 1;
        }
        Ok(ImportResult { imported, skipped })
    }

    fn csv_split(line: &str) -> Vec<String> {
        let mut result = Vec::new();
        let mut current = String::new();
        let mut in_quotes = false;
        for ch in line.chars() {
            if ch == '"' {
                in_quotes = !in_quotes;
            } else if ch == ',' && !in_quotes {
                result.push(current.clone());
                current.clear();
            } else {
                current.push(ch);
            }
        }
        result.push(current);
        result
    }

    // Unified import dispatcher
    pub fn import_file(&self, path: &Path) -> Result<ImportResult> {
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        match ext.as_str() {
            "json" => self.import_todos(path),
            "txt" | "md" => self.import_txt(path),
            "csv" => self.import_csv(path),
            _ => Err(rusqlite::Error::ToSqlConversionFailure(
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData,
                    format!("Unsupported file format: .{}", ext)))
            )),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ImportResult {
    pub imported: i64,
    pub skipped: i64,
}
