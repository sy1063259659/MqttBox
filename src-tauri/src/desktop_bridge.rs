use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{Shutdown, SocketAddr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{MessageFilter, MessageParserInput, MessageParserTestRequest},
    parser::test_message_parser,
    storage::StorageService,
};

const HEADER_TERMINATOR: &[u8] = b"\r\n\r\n";
const DEFAULT_READ_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug)]
pub struct DesktopBridgeConfig {
    pub base_url: String,
    pub token: String,
}

pub struct ManagedDesktopBridge {
    running: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    address: Option<SocketAddr>,
    token: Option<String>,
}

impl ManagedDesktopBridge {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            handle: None,
            address: None,
            token: None,
        }
    }

    pub fn ensure_running(
        &mut self,
        storage: Arc<Mutex<StorageService>>,
    ) -> AppResult<DesktopBridgeConfig> {
        if self.running.load(Ordering::SeqCst) {
            if let (Some(address), Some(token)) = (self.address, self.token.clone()) {
                return Ok(DesktopBridgeConfig {
                    base_url: format!("http://127.0.0.1:{}", address.port()),
                    token,
                });
            }
        }

        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        listener.set_nonblocking(true)?;
        let address = listener.local_addr()?;
        let token = Uuid::new_v4().to_string();
        let running = Arc::clone(&self.running);
        let token_for_thread = token.clone();
        running.store(true, Ordering::SeqCst);

        let handle = thread::spawn(move || {
            while running.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let _ = handle_stream(stream, &storage, &token_for_thread);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => break,
                }
            }
        });

        self.address = Some(address);
        self.token = Some(token.clone());
        self.handle = Some(handle);

        Ok(DesktopBridgeConfig {
            base_url: format!("http://127.0.0.1:{}", address.port()),
            token,
        })
    }

    pub fn shutdown(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(address) = self.address.take() {
            let _ = TcpStream::connect(address).and_then(|stream| stream.shutdown(Shutdown::Both));
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        self.token = None;
    }
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageSamplesQuery {
    topic: Option<String>,
    connection_id: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParsersQuery {
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopBridgeParserListResponse {
    items: Vec<crate::models::MessageParserDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopBridgeMessageSampleDto {
    id: String,
    topic: String,
    raw_payload_hex: String,
    parsed_payload_json: Option<String>,
    parse_error: Option<String>,
    received_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopBridgeMessageSamplesResponse {
    connection_id: String,
    items: Vec<DesktopBridgeMessageSampleDto>,
}

fn handle_stream(
    mut stream: TcpStream,
    storage: &Arc<Mutex<StorageService>>,
    token: &str,
) -> AppResult<()> {
    stream.set_read_timeout(Some(DEFAULT_READ_TIMEOUT))?;
    let request = match read_request(&mut stream)? {
        Some(request) => request,
        None => return Ok(()),
    };

    if !is_authorized(&request, token) {
        write_json_response(
            &mut stream,
            401,
            serde_json::json!({
                "error": "unauthorized",
                "message": "Desktop bridge token is missing or invalid."
            }),
        )?;
        return Ok(());
    }

    let (path, query_string) = split_path_and_query(&request.path);

    let response = match (request.method.as_str(), path) {
        ("GET", "/health") => Ok(serde_json::json!({ "status": "ok" })),
        ("GET", "/parsers") => {
            let query = parse_query::<ParsersQuery>(query_string)?;
            let mut items = storage.lock().unwrap().list_message_parsers()?;
            if let Some(limit) = query.limit {
                items.truncate(limit.min(20));
            }
            Ok(serde_json::to_value(DesktopBridgeParserListResponse {
                items,
            })?)
        }
        ("POST", "/parsers/test") => {
            let payload = parse_json_body::<MessageParserTestRequest>(&request.body)?;
            Ok(serde_json::to_value(test_message_parser(&payload))?)
        }
        ("POST", "/parsers/save") => {
            let payload = parse_json_body::<MessageParserInput>(&request.body)?;
            Ok(serde_json::to_value(
                storage.lock().unwrap().save_message_parser(payload)?,
            )?)
        }
        ("GET", "/messages/samples") => {
            let query = parse_query::<MessageSamplesQuery>(query_string)?;
            let guard = storage.lock().unwrap();
            let active_connection_id = guard.get_app_settings()?.active_connection_id;
            let connection_id = query
                .connection_id
                .or(active_connection_id)
                .ok_or_else(|| {
                    AppError::Message(
                        "No connectionId was provided and there is no active desktop connection."
                            .into(),
                    )
                })?;
            let history = guard.load_message_history(
                &connection_id,
                &MessageFilter {
                    keyword: String::new(),
                    topic: query.topic.unwrap_or_default(),
                    direction: "incoming".into(),
                    limit: Some(query.limit.unwrap_or(5).clamp(1, 20)),
                    offset: Some(0),
                },
            )?;
            let items = history
                .items
                .into_iter()
                .map(|item| DesktopBridgeMessageSampleDto {
                    id: item.id,
                    topic: item.topic,
                    raw_payload_hex: item.raw_payload_hex,
                    parsed_payload_json: item.parsed_payload_json,
                    parse_error: item.parse_error,
                    received_at: item.received_at,
                })
                .collect::<Vec<_>>();
            Ok(serde_json::to_value(DesktopBridgeMessageSamplesResponse {
                connection_id,
                items,
            })?)
        }
        _ => Err(AppError::Message("not_found".into())),
    };

    match response {
        Ok(payload) => {
            write_json_response(&mut stream, 200, payload)?;
        }
        Err(AppError::Message(message)) if message == "not_found" => {
            write_json_response(
                &mut stream,
                404,
                serde_json::json!({ "error": "not_found", "message": "Desktop bridge endpoint not found." }),
            )?;
        }
        Err(error) => {
            write_json_response(
                &mut stream,
                400,
                serde_json::json!({
                    "error": "desktop_bridge_error",
                    "message": error.to_string(),
                }),
            )?;
        }
    }

    Ok(())
}

fn read_request(stream: &mut TcpStream) -> AppResult<Option<HttpRequest>> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];

    loop {
        match stream.read(&mut chunk) {
            Ok(0) if buffer.is_empty() => return Ok(None),
            Ok(0) => break,
            Ok(read) => {
                buffer.extend_from_slice(&chunk[..read]);
                if buffer
                    .windows(HEADER_TERMINATOR.len())
                    .any(|window| window == HEADER_TERMINATOR)
                {
                    break;
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                return Ok(None)
            }
            Err(error) => return Err(AppError::Io(error)),
        }
    }

    let header_end = buffer
        .windows(HEADER_TERMINATOR.len())
        .position(|window| window == HEADER_TERMINATOR)
        .ok_or_else(|| AppError::Message("Malformed HTTP request.".into()))?;
    let body_start = header_end + HEADER_TERMINATOR.len();
    let header_bytes = &buffer[..header_end];
    let mut body = buffer[body_start..].to_vec();
    let header_text = String::from_utf8(header_bytes.to_vec())
        .map_err(|_| AppError::Message("HTTP headers must be valid UTF-8.".into()))?;
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| AppError::Message("Missing HTTP request line.".into()))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| AppError::Message("Missing HTTP method.".into()))?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| AppError::Message("Missing HTTP path.".into()))?
        .to_string();

    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.trim().to_ascii_lowercase(), value.trim().to_string()))
        .collect::<HashMap<_, _>>();

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);

    while body.len() < content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(Some(HttpRequest {
        method,
        path,
        headers,
        body,
    }))
}

fn is_authorized(request: &HttpRequest, token: &str) -> bool {
    request
        .headers
        .get("x-agent-bridge-token")
        .map(|value| value == token)
        .unwrap_or(false)
}

fn split_path_and_query(path: &str) -> (&str, &str) {
    if let Some((path, query)) = path.split_once('?') {
        (path, query)
    } else {
        (path, "")
    }
}

fn parse_query<T>(query: &str) -> AppResult<T>
where
    T: for<'de> Deserialize<'de> + Default,
{
    if query.trim().is_empty() {
        return Ok(T::default());
    }

    let mut map = serde_json::Map::new();
    for pair in query.split('&').filter(|item| !item.is_empty()) {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = decode_query_component(raw_key)?;
        let value = decode_query_component(raw_value)?;
        let json_value = match value.parse::<i64>() {
            Ok(number) => serde_json::Value::Number(number.into()),
            Err(_) => serde_json::Value::String(value),
        };
        map.insert(key, json_value);
    }

    Ok(serde_json::from_value(serde_json::Value::Object(map))?)
}

fn decode_query_component(value: &str) -> AppResult<String> {
    let mut output = String::new();
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                output.push(' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
                    .map_err(|_| AppError::Message("Invalid query string.".into()))?;
                let decoded = u8::from_str_radix(hex, 16)
                    .map_err(|_| AppError::Message("Invalid query string.".into()))?;
                output.push(decoded as char);
                index += 3;
            }
            byte => {
                output.push(byte as char);
                index += 1;
            }
        }
    }
    Ok(output)
}

fn parse_json_body<T>(body: &[u8]) -> AppResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    if body.is_empty() {
        return Err(AppError::Message("Request body is required.".into()));
    }
    Ok(serde_json::from_slice(body)?)
}

fn write_json_response(
    stream: &mut TcpStream,
    status_code: u16,
    payload: serde_json::Value,
) -> AppResult<()> {
    let body = serde_json::to_vec(&payload)?;
    let reason = match status_code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status_code,
        reason,
        body.len()
    )?;
    stream.write_all(&body)?;
    stream.flush()?;
    Ok(())
}
