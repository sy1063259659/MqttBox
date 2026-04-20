use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::{
    error::AppResult,
    models::{
        AgentSettingsDto, AppSettingsDto, ConnectionFolderDto, ConnectionProfileDto,
        ConnectionProfileInput, ConnectionReorderItem, ConnectionSecretDto, ExportRequest,
        MessageFilter, MessageHistoryPageDto, MessageParserDto, MessageParserInput,
        MessageRecordDto, SubscriptionDto, SubscriptionInput,
    },
    parser::{
        build_payload_fields, execute_message_parser, pretty_json, MessageParserRuntimeInput,
    },
};

const AGENT_ENABLED_EXPLICITLY_SET_KEY: &str = "agentEnabledExplicitlySet";

pub struct StorageService {
    conn: Connection,
}

impl StorageService {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        let app_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&app_dir)?;
        let conn = Connection::open(app_dir.join("mqttbox.db"))?;
        conn.execute("PRAGMA foreign_keys = ON", [])?;

        let service = Self { conn };
        service.init()?;
        Ok(service)
    }

    fn init(&self) -> AppResult<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS connection_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                client_id TEXT NOT NULL,
                protocol TEXT NOT NULL,
                clean_session INTEGER NOT NULL,
                keep_alive_secs INTEGER NOT NULL,
                auto_reconnect INTEGER NOT NULL,
                connect_timeout_ms INTEGER NOT NULL,
                use_tls INTEGER NOT NULL,
                tls_mode TEXT NOT NULL,
                folder_id TEXT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                ca_cert_path TEXT,
                client_cert_path TEXT,
                client_key_path TEXT,
                last_connected_at INTEGER,
                last_used_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(folder_id) REFERENCES connection_folders(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS connection_folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS connection_secrets (
                connection_id TEXT PRIMARY KEY,
                username TEXT,
                password TEXT,
                passphrase TEXT,
                secret_storage_mode TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS message_parsers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                script TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS subscriptions (
                id TEXT PRIMARY KEY,
                connection_id TEXT NOT NULL,
                topic_filter TEXT NOT NULL,
                qos INTEGER NOT NULL,
                parser_id TEXT,
                enabled INTEGER NOT NULL,
                is_preset INTEGER NOT NULL,
                note TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE,
                FOREIGN KEY(parser_id) REFERENCES message_parsers(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS message_history (
                id TEXT PRIMARY KEY,
                connection_id TEXT NOT NULL,
                topic TEXT NOT NULL,
                payload_text TEXT NOT NULL,
                payload_base64 TEXT NOT NULL DEFAULT '',
                payload_type TEXT NOT NULL,
                payload_size INTEGER NOT NULL DEFAULT 0,
                direction TEXT NOT NULL,
                qos INTEGER NOT NULL,
                retain INTEGER NOT NULL,
                dup INTEGER NOT NULL,
                properties_json TEXT,
                received_at INTEGER NOT NULL,
                FOREIGN KEY(connection_id) REFERENCES connection_profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS publish_templates (
                id TEXT PRIMARY KEY,
                connection_id TEXT,
                name TEXT NOT NULL,
                topic TEXT NOT NULL,
                payload_text TEXT NOT NULL,
                payload_type TEXT NOT NULL,
                qos INTEGER NOT NULL,
                retain INTEGER NOT NULL,
                is_favorite INTEGER NOT NULL,
                last_used_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS agent_context_cache (
                id TEXT PRIMARY KEY,
                connection_id TEXT,
                context_type TEXT NOT NULL,
                content_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            ",
        )?;

        self.conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
            [now_ms()],
        )?;

        self.run_migrations()?;

        Ok(())
    }

    fn run_migrations(&self) -> AppResult<()> {
        let current_version = self.conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get::<_, i64>(0),
        )?;

        if current_version < 2 {
            self.migrate_v2()?;
        }

        if current_version < 3 {
            self.migrate_v3()?;
        }

        if current_version < 4 {
            self.migrate_v4()?;
        }

        if current_version < 5 {
            self.migrate_v5()?;
        }

        Ok(())
    }

    fn migrate_v2(&self) -> AppResult<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS connection_folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            ",
        )?;

        let columns = self.table_columns("connection_profiles")?;
        if !columns.iter().any(|column| column == "folder_id") {
            self.conn.execute(
                "ALTER TABLE connection_profiles ADD COLUMN folder_id TEXT NULL",
                [],
            )?;
        }

        if !columns.iter().any(|column| column == "sort_order") {
            self.conn.execute(
                "ALTER TABLE connection_profiles ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }

        let mut stmt = self.conn.prepare(
            "SELECT id FROM connection_profiles ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC",
        )?;
        let ids = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .flatten()
            .collect::<Vec<_>>();

        for (index, connection_id) in ids.into_iter().enumerate() {
            self.conn.execute(
                "UPDATE connection_profiles SET sort_order = ?2 WHERE id = ?1",
                params![connection_id, index as i64],
            )?;
        }

        self.conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
            [now_ms()],
        )?;

        Ok(())
    }

    fn migrate_v3(&self) -> AppResult<()> {
        self.conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_message_history_connection_time
            ON message_history(connection_id, received_at DESC);

            CREATE INDEX IF NOT EXISTS idx_publish_templates_connection_time
            ON publish_templates(connection_id, COALESCE(last_used_at, updated_at) DESC);
            ",
        )?;

        self.conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (3, ?1)",
            [now_ms()],
        )?;

        Ok(())
    }

    fn migrate_v4(&self) -> AppResult<()> {
        let columns = self.table_columns("message_history")?;

        if !columns.iter().any(|column| column == "payload_base64") {
            self.conn.execute(
                "ALTER TABLE message_history ADD COLUMN payload_base64 TEXT NOT NULL DEFAULT ''",
                [],
            )?;
        }

        if !columns.iter().any(|column| column == "payload_size") {
            self.conn.execute(
                "ALTER TABLE message_history ADD COLUMN payload_size INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }

        let mut stmt = self
            .conn
            .prepare("SELECT id, payload_text FROM message_history WHERE payload_base64 = '' OR payload_size = 0")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        for row in rows.flatten() {
            let payload_text = row.1;
            self.conn.execute(
                "UPDATE message_history SET payload_base64 = ?2, payload_size = ?3 WHERE id = ?1",
                params![
                    row.0,
                    BASE64.encode(payload_text.as_bytes()),
                    payload_text.as_bytes().len() as i64
                ],
            )?;
        }

        self.conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (4, ?1)",
            [now_ms()],
        )?;

        Ok(())
    }

    fn migrate_v5(&self) -> AppResult<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS message_parsers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                script TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_message_parsers_updated_at
            ON message_parsers(updated_at DESC);
            ",
        )?;

        let columns = self.table_columns("subscriptions")?;
        if !columns.iter().any(|column| column == "parser_id") {
            self.conn
                .execute("ALTER TABLE subscriptions ADD COLUMN parser_id TEXT", [])?;
        }

        self.conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (5, ?1)",
            [now_ms()],
        )?;

        Ok(())
    }

    fn table_columns(&self, table_name: &str) -> AppResult<Vec<String>> {
        let sql = format!("PRAGMA table_info({table_name})");
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        Ok(rows.flatten().collect())
    }

    pub fn list_connections(&self) -> AppResult<Vec<ConnectionProfileDto>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, host, port, client_id, protocol, clean_session, keep_alive_secs,
             auto_reconnect, connect_timeout_ms, use_tls, tls_mode, folder_id, sort_order,
             ca_cert_path, client_cert_path, client_key_path, last_connected_at, last_used_at,
             created_at, updated_at
             FROM connection_profiles ORDER BY sort_order ASC, COALESCE(last_used_at, created_at) DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(ConnectionProfileDto {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                client_id: row.get(4)?,
                protocol: row.get(5)?,
                clean_session: row.get::<_, i64>(6)? == 1,
                keep_alive_secs: row.get(7)?,
                auto_reconnect: row.get::<_, i64>(8)? == 1,
                connect_timeout_ms: row.get(9)?,
                use_tls: row.get::<_, i64>(10)? == 1,
                tls_mode: row.get(11)?,
                folder_id: row.get(12)?,
                sort_order: row.get(13)?,
                ca_cert_path: row.get(14)?,
                client_cert_path: row.get(15)?,
                client_key_path: row.get(16)?,
                last_connected_at: row.get(17)?,
                last_used_at: row.get(18)?,
                created_at: row.get(19)?,
                updated_at: row.get(20)?,
            })
        })?;

        Ok(rows.flatten().collect())
    }

    pub fn list_connection_folders(&self) -> AppResult<Vec<ConnectionFolderDto>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, sort_order, created_at, updated_at
             FROM connection_folders ORDER BY sort_order ASC, created_at ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(ConnectionFolderDto {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;

        Ok(rows.flatten().collect())
    }

    pub fn get_connection(&self, connection_id: &str) -> AppResult<ConnectionProfileDto> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, host, port, client_id, protocol, clean_session, keep_alive_secs,
             auto_reconnect, connect_timeout_ms, use_tls, tls_mode, folder_id, sort_order,
             ca_cert_path, client_cert_path, client_key_path, last_connected_at, last_used_at, created_at, updated_at
             FROM connection_profiles WHERE id = ?1",
        )?;

        Ok(stmt.query_row([connection_id], |row| {
            Ok(ConnectionProfileDto {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                client_id: row.get(4)?,
                protocol: row.get(5)?,
                clean_session: row.get::<_, i64>(6)? == 1,
                keep_alive_secs: row.get(7)?,
                auto_reconnect: row.get::<_, i64>(8)? == 1,
                connect_timeout_ms: row.get(9)?,
                use_tls: row.get::<_, i64>(10)? == 1,
                tls_mode: row.get(11)?,
                folder_id: row.get(12)?,
                sort_order: row.get(13)?,
                ca_cert_path: row.get(14)?,
                client_cert_path: row.get(15)?,
                client_key_path: row.get(16)?,
                last_connected_at: row.get(17)?,
                last_used_at: row.get(18)?,
                created_at: row.get(19)?,
                updated_at: row.get(20)?,
            })
        })?)
    }

    pub fn get_connection_secret(
        &self,
        connection_id: &str,
    ) -> AppResult<Option<ConnectionSecretDto>> {
        let mut stmt = self.conn.prepare(
            "SELECT connection_id, username, password, passphrase
             FROM connection_secrets WHERE connection_id = ?1",
        )?;

        let mut rows = stmt.query([connection_id])?;
        if let Some(row) = rows.next()? {
            return Ok(Some(ConnectionSecretDto {
                connection_id: row.get(0)?,
                username: row.get(1)?,
                password: row.get(2)?,
                passphrase: row.get(3)?,
            }));
        }

        Ok(None)
    }

    pub fn save_connection(
        &self,
        profile: ConnectionProfileInput,
    ) -> AppResult<ConnectionProfileDto> {
        let id = profile
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = now_ms();

        let exists = self
            .conn
            .query_row(
                "SELECT COUNT(1) FROM connection_profiles WHERE id = ?1",
                [id.clone()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;

        let folder_id = profile.folder_id.clone();
        let sort_order = if exists {
            profile.sort_order.unwrap_or_else(|| {
                self.conn
                    .query_row(
                        "SELECT sort_order FROM connection_profiles WHERE id = ?1",
                        [id.clone()],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap_or(0)
            })
        } else {
            profile
                .sort_order
                .unwrap_or_else(|| self.next_connection_sort_order(folder_id.as_deref()))
        };

        if exists {
            self.conn.execute(
                "UPDATE connection_profiles
                 SET name = ?2, host = ?3, port = ?4, client_id = ?5, protocol = 'mqtt',
                     clean_session = ?6, keep_alive_secs = ?7, auto_reconnect = ?8,
                     connect_timeout_ms = ?9, use_tls = ?10, tls_mode = ?11, folder_id = ?12,
                     sort_order = ?13, ca_cert_path = ?14, client_cert_path = ?15,
                     client_key_path = ?16, updated_at = ?17
                 WHERE id = ?1",
                params![
                    id,
                    profile.name,
                    profile.host,
                    profile.port,
                    profile.client_id,
                    profile.clean_session as i64,
                    profile.keep_alive_secs,
                    profile.auto_reconnect as i64,
                    profile.connect_timeout_ms,
                    profile.use_tls as i64,
                    profile.tls_mode,
                    folder_id,
                    sort_order,
                    profile.ca_cert_path,
                    profile.client_cert_path,
                    profile.client_key_path,
                    now,
                ],
            )?;
        } else {
            self.conn.execute(
                "INSERT INTO connection_profiles (
                     id, name, host, port, client_id, protocol, clean_session, keep_alive_secs,
                     auto_reconnect, connect_timeout_ms, use_tls, tls_mode, folder_id,
                     sort_order, ca_cert_path, client_cert_path, client_key_path, created_at, updated_at
                 ) VALUES (
                     ?1, ?2, ?3, ?4, ?5, 'mqtt', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17
                 )",
                params![
                    id,
                    profile.name,
                    profile.host,
                    profile.port,
                    profile.client_id,
                    profile.clean_session as i64,
                    profile.keep_alive_secs,
                    profile.auto_reconnect as i64,
                    profile.connect_timeout_ms,
                    profile.use_tls as i64,
                    profile.tls_mode,
                    folder_id,
                    sort_order,
                    profile.ca_cert_path,
                    profile.client_cert_path,
                    profile.client_key_path,
                    now,
                ],
            )?;
        }

        self.conn.execute(
            "INSERT INTO connection_secrets (
                 connection_id, username, password, passphrase, secret_storage_mode, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 'local_db', ?5, ?5)
             ON CONFLICT(connection_id) DO UPDATE SET
                 username = excluded.username,
                 password = excluded.password,
                 passphrase = excluded.passphrase,
                 updated_at = excluded.updated_at",
            params![id, profile.username, profile.password, profile.passphrase, now],
        )?;

        self.get_connection(&id)
    }

    pub fn create_connection_folder(&self, name: String) -> AppResult<ConnectionFolderDto> {
        let id = Uuid::new_v4().to_string();
        let now = now_ms();
        let sort_order = self.next_folder_sort_order();

        self.conn.execute(
            "INSERT INTO connection_folders (id, name, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![id, name, sort_order, now],
        )?;

        Ok(ConnectionFolderDto {
            id,
            name,
            sort_order,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn update_connection_folder(
        &self,
        folder_id: &str,
        name: String,
    ) -> AppResult<ConnectionFolderDto> {
        let now = now_ms();
        self.conn.execute(
            "UPDATE connection_folders SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![folder_id, name, now],
        )?;

        let mut stmt = self.conn.prepare(
            "SELECT id, name, sort_order, created_at, updated_at
             FROM connection_folders WHERE id = ?1",
        )?;

        Ok(stmt.query_row([folder_id], |row| {
            Ok(ConnectionFolderDto {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?)
    }

    pub fn delete_connection_folder(&self, folder_id: &str) -> AppResult<()> {
        self.conn.execute(
            "UPDATE connection_profiles SET folder_id = NULL, updated_at = ?2 WHERE folder_id = ?1",
            params![folder_id, now_ms()],
        )?;
        self.conn
            .execute("DELETE FROM connection_folders WHERE id = ?1", [folder_id])?;
        Ok(())
    }

    pub fn reorder_connection_folders(&self, folder_ids: Vec<String>) -> AppResult<()> {
        for (index, folder_id) in folder_ids.into_iter().enumerate() {
            self.conn.execute(
                "UPDATE connection_folders SET sort_order = ?2, updated_at = ?3 WHERE id = ?1",
                params![folder_id, index as i64, now_ms()],
            )?;
        }
        Ok(())
    }

    pub fn reorder_connections(&self, items: Vec<ConnectionReorderItem>) -> AppResult<()> {
        let now = now_ms();
        for item in items {
            self.conn.execute(
                "UPDATE connection_profiles
                 SET folder_id = ?2, sort_order = ?3, updated_at = ?4
                 WHERE id = ?1",
                params![item.connection_id, item.folder_id, item.sort_order, now],
            )?;
        }
        Ok(())
    }

    pub fn delete_connection(&self, connection_id: &str) -> AppResult<()> {
        self.conn.execute(
            "DELETE FROM connection_profiles WHERE id = ?1",
            [connection_id],
        )?;
        Ok(())
    }

    pub fn touch_last_used(&self, connection_id: &str) -> AppResult<()> {
        let now = now_ms();
        self.conn.execute(
            "UPDATE connection_profiles SET last_used_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![connection_id, now],
        )?;
        Ok(())
    }

    pub fn touch_connected(&self, connection_id: &str) -> AppResult<()> {
        let now = now_ms();
        self.conn.execute(
            "UPDATE connection_profiles
             SET last_connected_at = ?2, last_used_at = ?2, updated_at = ?2
             WHERE id = ?1",
            params![connection_id, now],
        )?;
        Ok(())
    }

    pub fn list_subscriptions(
        &self,
        connection_id: Option<String>,
    ) -> AppResult<Vec<SubscriptionDto>> {
        let sql = if connection_id.is_some() {
            "SELECT id, connection_id, topic_filter, qos, parser_id, enabled, is_preset, note, created_at, updated_at
             FROM subscriptions WHERE connection_id = ?1 ORDER BY updated_at DESC"
        } else {
            "SELECT id, connection_id, topic_filter, qos, parser_id, enabled, is_preset, note, created_at, updated_at
             FROM subscriptions ORDER BY updated_at DESC"
        };

        let mut stmt = self.conn.prepare(sql)?;
        let mapper = |row: &rusqlite::Row<'_>| {
            Ok(SubscriptionDto {
                id: row.get(0)?,
                connection_id: row.get(1)?,
                topic_filter: row.get(2)?,
                qos: row.get(3)?,
                parser_id: row.get(4)?,
                enabled: row.get::<_, i64>(5)? == 1,
                is_preset: row.get::<_, i64>(6)? == 1,
                note: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        };

        let rows = if let Some(connection_id) = connection_id {
            stmt.query_map([connection_id], mapper)?
        } else {
            stmt.query_map([], mapper)?
        };

        Ok(rows.flatten().collect())
    }

    pub fn save_subscriptions(
        &self,
        subscriptions: Vec<SubscriptionInput>,
    ) -> AppResult<Vec<SubscriptionDto>> {
        let now = now_ms();
        let mut saved = Vec::new();

        for subscription in subscriptions {
            let id = subscription
                .id
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            self.conn.execute(
                "INSERT INTO subscriptions (
                     id, connection_id, topic_filter, qos, parser_id, enabled, is_preset, note, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                     topic_filter = excluded.topic_filter,
                     qos = excluded.qos,
                     parser_id = excluded.parser_id,
                     enabled = excluded.enabled,
                     is_preset = excluded.is_preset,
                     note = excluded.note,
                     updated_at = excluded.updated_at",
                params![
                    id,
                    subscription.connection_id,
                    subscription.topic_filter,
                    subscription.qos,
                    subscription.parser_id,
                    subscription.enabled as i64,
                    subscription.is_preset as i64,
                    subscription.note,
                    now,
                ],
            )?;

            saved.push(SubscriptionDto {
                id,
                connection_id: subscription.connection_id,
                topic_filter: subscription.topic_filter,
                qos: subscription.qos,
                parser_id: subscription.parser_id,
                enabled: subscription.enabled,
                is_preset: subscription.is_preset,
                note: subscription.note,
                created_at: now,
                updated_at: now,
            });
        }

        Ok(saved)
    }

    pub fn list_message_parsers(&self) -> AppResult<Vec<MessageParserDto>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, script, created_at, updated_at
             FROM message_parsers
             ORDER BY updated_at DESC, created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(MessageParserDto {
                id: row.get(0)?,
                name: row.get(1)?,
                script: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;

        Ok(rows.flatten().collect())
    }

    pub fn save_message_parser(&self, input: MessageParserInput) -> AppResult<MessageParserDto> {
        let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = now_ms();

        let existing_created_at = self
            .conn
            .query_row(
                "SELECT created_at FROM message_parsers WHERE id = ?1",
                [id.clone()],
                |row| row.get::<_, i64>(0),
            )
            .ok();

        self.conn.execute(
            "INSERT INTO message_parsers (id, name, script, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                script = excluded.script,
                updated_at = excluded.updated_at",
            params![
                id,
                input.name,
                input.script,
                existing_created_at.unwrap_or(now),
                now
            ],
        )?;

        self.conn
            .query_row(
                "SELECT id, name, script, created_at, updated_at
             FROM message_parsers WHERE id = ?1",
                [id],
                |row| {
                    Ok(MessageParserDto {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        script: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .map_err(Into::into)
    }

    pub fn remove_message_parser(&self, parser_id: &str) -> AppResult<()> {
        self.conn.execute(
            "UPDATE subscriptions SET parser_id = NULL, updated_at = ?2 WHERE parser_id = ?1",
            params![parser_id, now_ms()],
        )?;
        self.conn
            .execute("DELETE FROM message_parsers WHERE id = ?1", [parser_id])?;
        Ok(())
    }

    pub fn get_subscriptions_by_ids(
        &self,
        subscription_ids: &[String],
    ) -> AppResult<Vec<SubscriptionDto>> {
        let all = self.list_subscriptions(None)?;
        Ok(all
            .into_iter()
            .filter(|subscription| subscription_ids.contains(&subscription.id))
            .collect())
    }

    pub fn remove_subscriptions(&self, subscription_ids: &[String]) -> AppResult<()> {
        for subscription_id in subscription_ids {
            self.conn
                .execute("DELETE FROM subscriptions WHERE id = ?1", [subscription_id])?;
        }
        Ok(())
    }

    pub fn insert_message(&self, message: &MessageRecordDto) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO message_history (
                 id, connection_id, topic, payload_text, payload_base64, payload_type, payload_size, direction, qos, retain, dup, properties_json, received_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                message.id,
                message.connection_id,
                message.topic,
                message.payload_text,
                message.payload_base64,
                message.payload_type,
                message.payload_size,
                message.direction,
                message.qos,
                message.retain as i64,
                message.dup as i64,
                message.properties_json,
                message.received_at,
            ],
        )?;

        let settings = self.get_app_settings()?;
        self.trim_message_history(
            &message.connection_id,
            settings.message_history_limit_per_connection,
        )?;
        Ok(())
    }

    pub fn decorate_message(&self, message: MessageRecordDto) -> AppResult<MessageRecordDto> {
        if message.direction != "incoming" {
            return Ok(message);
        }

        let maybe_parser = self.resolve_message_parser(&message.connection_id, &message.topic)?;

        if let Some(parser) = maybe_parser {
            let runtime_input = MessageParserRuntimeInput {
                topic: message.topic.clone(),
                connection_id: message.connection_id.clone(),
                payload_type: message.payload_type.clone(),
                payload_text: message.payload_text.clone(),
                payload_base64: message.payload_base64.clone(),
                payload_hex: message.raw_payload_hex.clone(),
                payload_size: message.payload_size,
                qos: message.qos,
                retain: message.retain,
                dup: message.dup,
                bytes: decode_payload_bytes(&message.payload_base64, &message.payload_text),
            };

            match execute_message_parser(&parser.script, &runtime_input) {
                Ok(parsed_payload_json) => Ok(MessageRecordDto {
                    parser_id: Some(parser.id),
                    parsed_payload_json: Some(pretty_json(&parsed_payload_json)),
                    parse_error: None,
                    ..message
                }),
                Err(error) => Ok(MessageRecordDto {
                    parser_id: Some(parser.id),
                    parsed_payload_json: None,
                    parse_error: Some(error.to_string()),
                    ..message
                }),
            }
        } else {
            Ok(message)
        }
    }

    pub fn load_message_history(
        &self,
        connection_id: &str,
        filter: &MessageFilter,
    ) -> AppResult<MessageHistoryPageDto> {
        let limit = filter.limit.unwrap_or(200).clamp(1, 500);
        let offset = filter.offset.unwrap_or(0).max(0);
        let mut items = self.query_message_history(connection_id, filter, limit + 1, offset)?;
        let has_more = items.len() as i64 > limit;
        if has_more {
            items.truncate(limit as usize);
        }

        Ok(MessageHistoryPageDto {
            next_offset: if has_more { Some(offset + limit) } else { None },
            has_more,
            items: self.decorate_messages(items)?,
        })
    }

    fn query_message_history(
        &self,
        connection_id: &str,
        filter: &MessageFilter,
        limit: i64,
        offset: i64,
    ) -> AppResult<Vec<MessageRecordDto>> {
        let keyword = filter.keyword.trim().to_lowercase();
        let keyword_like = format!("%{keyword}%");
        let topic = filter.topic.trim().to_lowercase();
        let topic_like = format!("%{topic}%");
        let direction = if filter.direction.trim().is_empty() {
            "all".to_string()
        } else {
            filter.direction.trim().to_lowercase()
        };

        let mut stmt = self.conn.prepare(
            "SELECT id, connection_id, topic, payload_text, payload_base64, payload_type, payload_size, direction, qos, retain, dup, properties_json, received_at
             FROM message_history
             WHERE connection_id = ?1
               AND (?2 = '' OR lower(topic) LIKE ?3 OR lower(payload_text) LIKE ?3)
               AND (?4 = '' OR lower(topic) LIKE ?5)
               AND (?6 = 'all' OR direction = ?6)
             ORDER BY received_at DESC
             LIMIT ?7 OFFSET ?8",
        )?;

        let rows = stmt.query_map(
            params![
                connection_id,
                keyword,
                keyword_like,
                topic,
                topic_like,
                direction,
                limit,
                offset,
            ],
            |row| {
                let payload_text = row.get::<_, String>(3)?;
                let payload_base64 = row.get::<_, String>(4)?;
                let raw_payload_hex =
                    decode_payload_fields(&payload_base64, &payload_text).raw_payload_hex;

                Ok(MessageRecordDto {
                    id: row.get(0)?,
                    connection_id: row.get(1)?,
                    topic: row.get(2)?,
                    payload_text,
                    payload_base64,
                    raw_payload_hex,
                    payload_type: row.get(5)?,
                    payload_size: row.get(6)?,
                    direction: row.get(7)?,
                    qos: row.get(8)?,
                    retain: row.get::<_, i64>(9)? == 1,
                    dup: row.get::<_, i64>(10)? == 1,
                    parser_id: None,
                    parsed_payload_json: None,
                    parse_error: None,
                    properties_json: row.get(11)?,
                    received_at: row.get(12)?,
                })
            },
        )?;

        Ok(rows.flatten().collect())
    }

    pub fn clear_message_history(&self, connection_id: &str) -> AppResult<()> {
        self.conn.execute(
            "DELETE FROM message_history WHERE connection_id = ?1",
            [connection_id],
        )?;
        Ok(())
    }

    pub fn export_messages(&self, request: &ExportRequest) -> AppResult<()> {
        let messages = self.query_message_history(
            &request.connection_id,
            &MessageFilter {
                keyword: String::new(),
                topic: String::new(),
                direction: "all".into(),
                limit: None,
                offset: None,
            },
            1_000_000,
            0,
        )?;

        if request.format == "csv" {
            let mut content = String::from("topic,payload,direction,qos,retain,receivedAt\n");
            for message in messages {
                content.push_str(&format!(
                    "\"{}\",\"{}\",\"{}\",{},{},{}\n",
                    escape_csv(&message.topic),
                    escape_csv(&message.payload_text),
                    message.direction,
                    message.qos,
                    message.retain,
                    message.received_at
                ));
            }
            fs::write(&request.path, content)?;
        } else {
            fs::write(&request.path, serde_json::to_string_pretty(&messages)?)?;
        }

        Ok(())
    }

    pub fn recent_message_count(&self, connection_id: &str) -> AppResult<usize> {
        let count = self.conn.query_row(
            "SELECT COUNT(1) FROM message_history WHERE connection_id = ?1",
            [connection_id],
            |row| row.get::<_, i64>(0),
        )?;

        Ok(count as usize)
    }

    pub fn get_app_settings(&self) -> AppResult<AppSettingsDto> {
        let mut settings = AppSettingsDto::default();
        let mut stmt = self
            .conn
            .prepare("SELECT key, value_json FROM app_settings ORDER BY key ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        for row in rows.flatten() {
            match row.0.as_str() {
                "activeConnectionId" => {
                    settings.active_connection_id = serde_json::from_str(&row.1)?
                }
                "messageHistoryLimitPerConnection" => {
                    settings.message_history_limit_per_connection = serde_json::from_str(&row.1)?
                }
                "autoScrollMessages" => {
                    settings.auto_scroll_messages = serde_json::from_str(&row.1)?
                }
                "timestampFormat" => settings.timestamp_format = serde_json::from_str(&row.1)?,
                "theme" => settings.theme = serde_json::from_str(&row.1)?,
                "locale" => settings.locale = serde_json::from_str(&row.1)?,
                _ => {}
            }
        }

        Ok(settings)
    }

    pub fn save_app_settings(&self, settings: &AppSettingsDto) -> AppResult<()> {
        let now = now_ms();
        let items = vec![
            (
                "activeConnectionId",
                serde_json::to_string(&settings.active_connection_id)?,
            ),
            (
                "messageHistoryLimitPerConnection",
                serde_json::to_string(&settings.message_history_limit_per_connection)?,
            ),
            (
                "autoScrollMessages",
                serde_json::to_string(&settings.auto_scroll_messages)?,
            ),
            (
                "timestampFormat",
                serde_json::to_string(&settings.timestamp_format)?,
            ),
            ("theme", serde_json::to_string(&settings.theme)?),
            ("locale", serde_json::to_string(&settings.locale)?),
        ];

        for (key, value) in items {
            self.conn.execute(
                "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                params![key, value, now],
            )?;
        }

        Ok(())
    }

    pub fn get_agent_settings(&self) -> AppResult<AgentSettingsDto> {
        let mut settings = AgentSettingsDto::default();
        let mut enabled_explicitly_set = false;
        let mut stmt = self.conn.prepare(
            "SELECT key, value_json FROM app_settings WHERE key LIKE 'agent%' ORDER BY key ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        for row in rows.flatten() {
            match row.0.as_str() {
                "agentEnabled" => settings.enabled = serde_json::from_str(&row.1)?,
                "agentProvider" => settings.provider = serde_json::from_str(&row.1)?,
                "agentBaseUrl" => settings.base_url = serde_json::from_str(&row.1)?,
                "agentApiKey" => settings.api_key = serde_json::from_str(&row.1)?,
                "agentModel" => settings.model = serde_json::from_str(&row.1)?,
                "agentProtocol" => settings.protocol = serde_json::from_str(&row.1)?,
                AGENT_ENABLED_EXPLICITLY_SET_KEY => {
                    enabled_explicitly_set = serde_json::from_str(&row.1)?
                }
                _ => {}
            }
        }

        if should_auto_enable_legacy_agent_settings(&settings, enabled_explicitly_set) {
            settings.enabled = true;
            self.save_agent_settings_internal(&settings, true)?;
        }

        Ok(settings)
    }

    pub fn save_agent_settings(&self, settings: &AgentSettingsDto) -> AppResult<()> {
        self.save_agent_settings_internal(settings, true)
    }

    fn save_agent_settings_internal(
        &self,
        settings: &AgentSettingsDto,
        enabled_explicitly_set: bool,
    ) -> AppResult<()> {
        let now = now_ms();
        let items = vec![
            ("agentEnabled", serde_json::to_string(&settings.enabled)?),
            ("agentProvider", serde_json::to_string(&settings.provider)?),
            ("agentBaseUrl", serde_json::to_string(&settings.base_url)?),
            ("agentApiKey", serde_json::to_string(&settings.api_key)?),
            ("agentModel", serde_json::to_string(&settings.model)?),
            ("agentProtocol", serde_json::to_string(&settings.protocol)?),
            (
                AGENT_ENABLED_EXPLICITLY_SET_KEY,
                serde_json::to_string(&enabled_explicitly_set)?,
            ),
        ];

        for (key, value) in items {
            self.conn.execute(
                "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                params![key, value, now],
            )?;
        }

        Ok(())
    }

    fn next_folder_sort_order(&self) -> i64 {
        self.conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connection_folders",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
    }

    fn next_connection_sort_order(&self, folder_id: Option<&str>) -> i64 {
        if let Some(folder_id) = folder_id {
            self.conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connection_profiles WHERE folder_id = ?1",
                    [folder_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
        } else {
            self.conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connection_profiles WHERE folder_id IS NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
        }
    }

    fn trim_message_history(&self, connection_id: &str, keep_limit: i64) -> AppResult<()> {
        if keep_limit <= 0 {
            return Ok(());
        }

        self.conn.execute(
            "DELETE FROM message_history
             WHERE connection_id = ?1
               AND id NOT IN (
                 SELECT id FROM message_history
                 WHERE connection_id = ?1
                 ORDER BY received_at DESC
                 LIMIT ?2
               )",
            params![connection_id, keep_limit],
        )?;
        Ok(())
    }

    fn decorate_messages(&self, items: Vec<MessageRecordDto>) -> AppResult<Vec<MessageRecordDto>> {
        items
            .into_iter()
            .map(|message| self.decorate_message(message))
            .collect()
    }

    fn resolve_message_parser(
        &self,
        connection_id: &str,
        topic: &str,
    ) -> AppResult<Option<MessageParserDto>> {
        let subscriptions = self.list_subscriptions(Some(connection_id.to_string()))?;
        let parsers = self.list_message_parsers()?;

        let best_subscription = subscriptions
            .into_iter()
            .filter(|subscription| subscription.parser_id.is_some())
            .filter(|subscription| mqtt_topic_matches(&subscription.topic_filter, topic))
            .max_by(|left, right| compare_subscription_priority(left, right));

        if let Some(subscription) = best_subscription {
            if let Some(parser_id) = subscription.parser_id {
                return Ok(parsers.into_iter().find(|parser| parser.id == parser_id));
            }
        }

        Ok(None)
    }
}

fn has_valid_agent_model_config(settings: &AgentSettingsDto) -> bool {
    settings.provider.trim() == "openai"
        && !settings.base_url.trim().is_empty()
        && !settings.api_key.trim().is_empty()
        && !settings.model.trim().is_empty()
        && (settings.protocol.trim() == "responses" || settings.protocol.trim() == "chat_completions")
}

fn should_auto_enable_legacy_agent_settings(
    settings: &AgentSettingsDto,
    enabled_explicitly_set: bool,
) -> bool {
    !enabled_explicitly_set && !settings.enabled && has_valid_agent_model_config(settings)
}

fn compare_subscription_priority(
    left: &SubscriptionDto,
    right: &SubscriptionDto,
) -> std::cmp::Ordering {
    let left_segments = topic_filter_segment_count(&left.topic_filter);
    let right_segments = topic_filter_segment_count(&right.topic_filter);

    left_segments
        .cmp(&right_segments)
        .then_with(|| {
            right_wildcard_count(&right.topic_filter).cmp(&right_wildcard_count(&left.topic_filter))
        })
        .then_with(|| {
            topic_filter_literal_length(&left.topic_filter)
                .cmp(&topic_filter_literal_length(&right.topic_filter))
        })
        .then_with(|| left.updated_at.cmp(&right.updated_at))
}

fn topic_filter_segment_count(topic_filter: &str) -> usize {
    topic_filter.split('/').count()
}

fn right_wildcard_count(topic_filter: &str) -> usize {
    topic_filter
        .chars()
        .filter(|char| *char == '+' || *char == '#')
        .count()
}

fn topic_filter_literal_length(topic_filter: &str) -> usize {
    topic_filter
        .chars()
        .filter(|char| *char != '+' && *char != '#')
        .count()
}

fn mqtt_topic_matches(topic_filter: &str, topic: &str) -> bool {
    let filter_parts = topic_filter.split('/').collect::<Vec<_>>();
    let topic_parts = topic.split('/').collect::<Vec<_>>();

    let mut filter_index = 0usize;
    let mut topic_index = 0usize;

    while filter_index < filter_parts.len() {
        match filter_parts[filter_index] {
            "#" => return true,
            "+" => {
                if topic_index >= topic_parts.len() {
                    return false;
                }
                filter_index += 1;
                topic_index += 1;
            }
            literal => {
                if topic_parts.get(topic_index).copied() != Some(literal) {
                    return false;
                }
                filter_index += 1;
                topic_index += 1;
            }
        }
    }

    topic_index == topic_parts.len()
}

fn decode_payload_bytes(payload_base64: &str, payload_text: &str) -> Vec<u8> {
    BASE64
        .decode(payload_base64)
        .unwrap_or_else(|_| payload_text.as_bytes().to_vec())
}

fn decode_payload_fields(payload_base64: &str, payload_text: &str) -> crate::parser::PayloadFields {
    let bytes = decode_payload_bytes(payload_base64, payload_text);
    build_payload_fields(&bytes)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn escape_csv(value: &str) -> String {
    value.replace('"', "\"\"")
}

#[cfg(test)]
mod tests {
    use super::{should_auto_enable_legacy_agent_settings, AgentSettingsDto};

    fn configured_agent_settings(enabled: bool) -> AgentSettingsDto {
        AgentSettingsDto {
            enabled,
            provider: "openai".into(),
            base_url: "https://api.example.com/v1".into(),
            api_key: "test-key".into(),
            model: "gpt-5.4".into(),
            protocol: "responses".into(),
        }
    }

    #[test]
    fn auto_enables_legacy_disabled_settings_once_when_model_config_is_complete() {
        let settings = configured_agent_settings(false);

        assert!(should_auto_enable_legacy_agent_settings(&settings, false));
    }

    #[test]
    fn does_not_auto_enable_after_enabled_preference_has_been_explicitly_saved() {
        let settings = configured_agent_settings(false);

        assert!(!should_auto_enable_legacy_agent_settings(&settings, true));
    }

    #[test]
    fn does_not_auto_enable_incomplete_model_settings() {
        let mut settings = configured_agent_settings(false);
        settings.api_key.clear();

        assert!(!should_auto_enable_legacy_agent_settings(&settings, false));
    }
}
