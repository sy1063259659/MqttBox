use std::{
    env,
    fs::OpenOptions,
    io::{self, Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::desktop_bridge::DesktopBridgeConfig;
use crate::models::AgentToolDescriptor;

const DEFAULT_AGENT_SERVICE_HOST: &str = "127.0.0.1";
const DEFAULT_AGENT_SERVICE_PORT: u16 = 8787;
const DEFAULT_AGENT_WS_PORT: u16 = 8788;
const AGENT_SERVICE_START_TIMEOUT: Duration = Duration::from_secs(8);
const AGENT_SERVICE_POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Deserialize)]
struct AgentServiceHealthResponse {
    tools: Vec<AgentToolDescriptor>,
}

pub struct ManagedAgentService {
    child: Option<Child>,
}

impl ManagedAgentService {
    pub fn new() -> Self {
        Self { child: None }
    }

    pub fn ensure_running(
        &mut self,
        app: &AppHandle,
        desktop_bridge: &DesktopBridgeConfig,
    ) -> io::Result<()> {
        if is_agent_service_listening(DEFAULT_AGENT_SERVICE_PORT) {
            return Ok(());
        }

        if self.child_is_running()? {
            return self.wait_until_ready();
        }

        let launch = resolve_launch_spec()?;
        let (stdout, stderr) = open_agent_service_logs(app)?;
        let mut command = Command::new(&launch.program);
        command
            .args(&launch.args)
            .current_dir(&launch.working_dir)
            .env("AGENT_SERVICE_PORT", DEFAULT_AGENT_SERVICE_PORT.to_string())
            .env("AGENT_WS_PORT", DEFAULT_AGENT_WS_PORT.to_string())
            .env("AGENT_DESKTOP_BRIDGE_URL", &desktop_bridge.base_url)
            .env("AGENT_DESKTOP_BRIDGE_TOKEN", &desktop_bridge.token)
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr);
        apply_background_process_flags(&mut command);

        let child = command.spawn()?;
        self.child = Some(child);
        self.wait_until_ready()
    }

    pub fn shutdown(&mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };

        match child.try_wait() {
            Ok(Some(_)) => {}
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            Err(_) => {
                let _ = child.kill();
            }
        }
    }

    fn child_is_running(&mut self) -> io::Result<bool> {
        let Some(child) = self.child.as_mut() else {
            return Ok(false);
        };

        match child.try_wait()? {
            Some(_) => {
                self.child = None;
                Ok(false)
            }
            None => Ok(true),
        }
    }

    fn wait_until_ready(&mut self) -> io::Result<()> {
        let started_at = Instant::now();
        while started_at.elapsed() < AGENT_SERVICE_START_TIMEOUT {
            if is_agent_service_listening(DEFAULT_AGENT_SERVICE_PORT) {
                return Ok(());
            }

            if !self.child_is_running()? {
                return Err(io::Error::new(
                    io::ErrorKind::ConnectionAborted,
                    "Local agent service exited before it started listening.",
                ));
            }

            thread::sleep(AGENT_SERVICE_POLL_INTERVAL);
        }

        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "Timed out waiting for the local agent service to start.",
        ))
    }
}

pub fn list_live_agent_tools() -> io::Result<Vec<AgentToolDescriptor>> {
    let mut stream = TcpStream::connect((DEFAULT_AGENT_SERVICE_HOST, DEFAULT_AGENT_SERVICE_PORT))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(
        b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
    )?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    parse_live_agent_tools_response(&response)
}

struct LaunchSpec {
    program: String,
    args: Vec<String>,
    working_dir: PathBuf,
}

fn resolve_launch_spec() -> io::Result<LaunchSpec> {
    let workspace_root = resolve_workspace_root().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "Could not locate the workspace root for the local agent service.",
        )
    })?;
    let agent_service_dir = workspace_root.join("agent-service");
    let dist_entry = agent_service_dir
        .join("dist")
        .join("agent-service")
        .join("src")
        .join("index.js");
    let tsx_cli = agent_service_dir
        .join("node_modules")
        .join("tsx")
        .join("dist")
        .join("cli.mjs");
    let src_entry = agent_service_dir.join("src").join("index.ts");

    let can_run_source = tsx_cli.exists() && src_entry.exists();
    let can_run_dist = dist_entry.exists();

    if cfg!(debug_assertions) && can_run_source {
        return Ok(LaunchSpec {
            program: "node".into(),
            args: vec![
                tsx_cli.to_string_lossy().into_owned(),
                src_entry.to_string_lossy().into_owned(),
            ],
            working_dir: agent_service_dir,
        });
    }

    if can_run_dist {
        return Ok(LaunchSpec {
            program: "node".into(),
            args: vec![dist_entry.to_string_lossy().into_owned()],
            working_dir: agent_service_dir,
        });
    }

    if can_run_source {
        return Ok(LaunchSpec {
            program: "node".into(),
            args: vec![
                tsx_cli.to_string_lossy().into_owned(),
                src_entry.to_string_lossy().into_owned(),
            ],
            working_dir: agent_service_dir,
        });
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "No runnable local agent service entrypoint was found. Build or install agent-service dependencies first.",
    ))
}

fn resolve_workspace_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir);
    }

    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));

    for candidate in candidates {
        for ancestor in candidate.ancestors() {
            if looks_like_workspace_root(ancestor) {
                return Some(ancestor.to_path_buf());
            }
        }
    }

    None
}

fn looks_like_workspace_root(path: &Path) -> bool {
    path.join("agent-service").join("package.json").exists()
        && path.join("src-tauri").join("Cargo.toml").exists()
}

fn open_agent_service_logs(app: &AppHandle) -> io::Result<(Stdio, Stdio)> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;
    std::fs::create_dir_all(&app_dir)?;
    let log_path = app_dir.join("agent-service.log");
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let stderr = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;

    Ok((Stdio::from(stdout), Stdio::from(stderr)))
}

fn is_agent_service_listening(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

fn parse_live_agent_tools_response(response: &[u8]) -> io::Result<Vec<AgentToolDescriptor>> {
    let Some(header_end) = response.windows(4).position(|window| window == b"\r\n\r\n") else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Agent service returned an invalid HTTP response.",
        ));
    };

    let header_bytes = &response[..header_end];
    let body_bytes = &response[header_end + 4..];
    let header_text = String::from_utf8_lossy(header_bytes);
    let status_line = header_text.lines().next().unwrap_or_default();

    if !status_line.contains(" 200 ") {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("Agent service /health request failed: {status_line}"),
        ));
    }

    let health: AgentServiceHealthResponse =
        serde_json::from_slice(body_bytes).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Failed to parse agent service /health response: {error}"),
            )
        })?;

    Ok(health.tools)
}

#[cfg(test)]
mod tests {
    use super::parse_live_agent_tools_response;
    use std::io;

    #[test]
    fn parses_live_tool_list_from_health_response() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"tools\":[{\"id\":\"list_saved_parsers\",\"name\":\"list_saved_parsers\",\"description\":\"List saved parsers\"}]}".to_vec();

        let tools = parse_live_agent_tools_response(&response).expect("should parse health tools");

        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].id, "list_saved_parsers");
    }

    #[test]
    fn rejects_non_success_health_response() {
        let response =
            b"HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n\r\n{}"
                .to_vec();

        let error = parse_live_agent_tools_response(&response).expect_err("should reject non-200");

        assert_eq!(error.kind(), io::ErrorKind::Other);
    }
}

#[cfg(target_os = "windows")]
fn apply_background_process_flags(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_background_process_flags(_command: &mut Command) {}
