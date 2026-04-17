use std::{
    env,
    fs::OpenOptions,
    io,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager};

const DEFAULT_AGENT_SERVICE_PORT: u16 = 8787;
const DEFAULT_AGENT_WS_PORT: u16 = 8788;
const AGENT_SERVICE_START_TIMEOUT: Duration = Duration::from_secs(8);
const AGENT_SERVICE_POLL_INTERVAL: Duration = Duration::from_millis(250);

pub struct ManagedAgentService {
    child: Option<Child>,
}

impl ManagedAgentService {
    pub fn new() -> Self {
        Self { child: None }
    }

    pub fn ensure_running(&mut self, app: &AppHandle) -> io::Result<()> {
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

#[cfg(target_os = "windows")]
fn apply_background_process_flags(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_background_process_flags(_command: &mut Command) {}
