use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Todo {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    /// pending | in_progress | completed | archived
    pub status: String,
    /// running | paused | stopped
    pub timer_status: String,
    pub timer_started_at: Option<i64>,
    pub timer_elapsed_sec: i64,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub archived_at: Option<i64>,
    #[serde(default)]
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagTimeStat {
    pub tag: Tag,
    pub total_seconds: i64,
    pub percentage: f64,
    pub todo_count: i64,
}
