use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufReader, Cursor},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use pkcs8::{der::SecretDocument, EncryptedPrivateKeyInfo};
use rumqttc::{
    tokio_rustls::rustls::{
        self,
        pki_types::{CertificateDer, PrivateKeyDer},
        ClientConfig, InconsistentKeys, RootCertStore,
    },
    AsyncClient, ClientError, ConnectReturnCode, ConnectionError, Event, MqttOptions, Packet,
    QoS, TlsConfiguration, Transport,
};
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, timeout, Instant};

use crate::{
    error::{AppError, AppResult},
    models::{
        ConnectionEventPayload, ConnectionProfileDto, ConnectionProfileInput, ConnectionSecretDto,
        ConnectionTestResultDto, MessageRecordDto,
    },
    parser::build_payload_fields as build_parser_payload_fields,
    storage::StorageService,
};

#[derive(Default)]
pub struct MqttManager {
    connections: HashMap<String, AsyncClient>,
    manual_disconnects: HashSet<String>,
}

impl MqttManager {
    pub fn is_connected(&self, connection_id: &str) -> bool {
        self.connections.contains_key(connection_id)
    }

    pub fn register(&mut self, connection_id: String, client: AsyncClient) {
        self.manual_disconnects.remove(&connection_id);
        self.connections.insert(connection_id, client);
    }

    pub fn client(&self, connection_id: &str) -> AppResult<AsyncClient> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| AppError::Message("当前连接未建立 MQTT 会话".into()))
    }

    pub fn remove(&mut self, connection_id: &str) -> Option<AsyncClient> {
        self.connections.remove(connection_id)
    }

    pub fn mark_manual_disconnect(&mut self, connection_id: String) {
        self.manual_disconnects.insert(connection_id);
    }

    pub fn clear_manual_disconnect(&mut self, connection_id: &str) {
        self.manual_disconnects.remove(connection_id);
    }

    pub fn take_manual_disconnect(&mut self, connection_id: &str) -> bool {
        self.manual_disconnects.remove(connection_id)
    }
}

pub fn connect_runtime(
    app: AppHandle,
    connection_id: String,
    profile: ConnectionProfileDto,
    secret: Option<ConnectionSecretDto>,
    storage: Arc<Mutex<StorageService>>,
    manager: Arc<Mutex<MqttManager>>,
) -> AppResult<()> {
    let options = build_options_from_profile(&profile, secret.as_ref())?;

    let (client, mut eventloop) = AsyncClient::new(options, 100);
    manager.lock().unwrap().register(connection_id.clone(), client.clone());

    app.emit(
        "connection://status",
        ConnectionEventPayload {
            connection_id: connection_id.clone(),
            status: "connecting".into(),
            message: None,
        },
    )?;

    tauri::async_runtime::spawn(async move {
        loop {
            match eventloop.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(_))) => {
                    if let Ok(storage) = storage.lock() {
                        let _ = storage.touch_connected(&connection_id);
                    }
                    let _ = app.emit(
                        "connection://status",
                        ConnectionEventPayload {
                            connection_id: connection_id.clone(),
                            status: "connected".into(),
                            message: None,
                        },
                    );
                }
                Ok(Event::Incoming(Packet::Publish(packet))) => {
                    let payload = build_parser_payload_fields(&packet.payload);
                    let message = MessageRecordDto {
                        id: uuid::Uuid::new_v4().to_string(),
                        connection_id: connection_id.clone(),
                        topic: packet.topic.clone(),
                        payload_text: payload.payload_text,
                        payload_base64: payload.payload_base64,
                        raw_payload_hex: payload.raw_payload_hex,
                        payload_type: payload.payload_type,
                        payload_size: payload.payload_size,
                        direction: "incoming".into(),
                        qos: qos_to_u8(packet.qos),
                        retain: packet.retain,
                        dup: packet.dup,
                        parser_id: None,
                        parsed_payload_json: None,
                        parse_error: None,
                        properties_json: None,
                        received_at: now_ms(),
                    };

                    if let Ok(storage) = storage.lock() {
                        let _ = storage.insert_message(&message);
                        let decorated = storage
                            .decorate_message(message.clone())
                            .unwrap_or(message);
                        let _ = app.emit("message://received", &decorated);
                    } else {
                        let _ = app.emit("message://received", &message);
                    }
                }
                Ok(_) => {}
                Err(error) => {
                    let was_manual_disconnect = {
                        let mut manager = manager.lock().unwrap();
                        manager.remove(&connection_id);
                        manager.take_manual_disconnect(&connection_id)
                    };

                    if was_manual_disconnect {
                        break;
                    }

                    let error_message = describe_connection_error(&error);
                    let _ = app.emit(
                        "connection://status",
                        ConnectionEventPayload {
                            connection_id: connection_id.clone(),
                            status: "error".into(),
                            message: Some(error_message.clone()),
                        },
                    );

                    if profile.auto_reconnect {
                        let _ = app.emit(
                            "connection://status",
                            ConnectionEventPayload {
                                connection_id: connection_id.clone(),
                                status: "reconnecting".into(),
                                message: Some("连接已断开，准备自动重连".into()),
                            },
                        );

                        sleep(Duration::from_secs(2)).await;

                        let _ = connect_runtime(
                            app.clone(),
                            connection_id.clone(),
                            profile.clone(),
                            secret.clone(),
                            Arc::clone(&storage),
                            Arc::clone(&manager),
                        );
                    }

                    break;
                }
            }
        }
    });

    Ok(())
}

pub async fn test_connection(
    profile: &ConnectionProfileInput,
) -> AppResult<ConnectionTestResultDto> {
    let options = build_options_from_input(profile)?;
    let (client, mut eventloop) = AsyncClient::new(options, 10);
    let started_at = Instant::now();

    let conn_ack = timeout(
        Duration::from_millis(profile.connect_timeout_ms as u64),
        async {
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Packet::ConnAck(_))) => return Ok(()),
                    Ok(_) => continue,
                    Err(error) => {
                        return Err(AppError::Message(describe_connection_error(&error)))
                    }
                }
            }
        },
    )
    .await
    .map_err(|_| AppError::Message("连接测试超时，请检查 broker 地址或网络".into()))?;

    conn_ack?;
    let latency_ms = started_at.elapsed().as_millis() as i64;
    let _ = client.disconnect().await;

    Ok(ConnectionTestResultDto {
        ok: true,
        message: "连接测试成功".into(),
        latency_ms,
    })
}

pub async fn disconnect_client(client: AsyncClient) -> AppResult<()> {
    client
        .disconnect()
        .await
        .map_err(|error| AppError::Message(describe_client_error(&error)))?;
    Ok(())
}

pub async fn subscribe_many(client: AsyncClient, topics: Vec<(String, u8)>) -> AppResult<()> {
    for (topic, qos) in topics {
        client
            .subscribe(topic, to_qos(qos)?)
            .await
            .map_err(|error| AppError::Message(describe_client_error(&error)))?;
    }
    Ok(())
}

pub async fn unsubscribe_many(client: AsyncClient, topics: Vec<String>) -> AppResult<()> {
    for topic in topics {
        client
            .unsubscribe(topic)
            .await
            .map_err(|error| AppError::Message(describe_client_error(&error)))?;
    }
    Ok(())
}

pub async fn publish(
    client: AsyncClient,
    topic: String,
    payload: Vec<u8>,
    qos: u8,
    retain: bool,
) -> AppResult<()> {
    client
        .publish(topic, to_qos(qos)?, retain, payload)
        .await
        .map_err(|error| AppError::Message(describe_client_error(&error)))?;
    Ok(())
}

fn to_qos(value: u8) -> AppResult<QoS> {
    match value {
        0 => Ok(QoS::AtMostOnce),
        1 => Ok(QoS::AtLeastOnce),
        2 => Ok(QoS::ExactlyOnce),
        _ => Err(AppError::Message("QoS 仅支持 0/1/2".into())),
    }
}

fn qos_to_u8(value: QoS) -> u8 {
    match value {
        QoS::AtMostOnce => 0,
        QoS::AtLeastOnce => 1,
        QoS::ExactlyOnce => 2,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn build_options_from_profile(
    profile: &ConnectionProfileDto,
    secret: Option<&ConnectionSecretDto>,
) -> AppResult<MqttOptions> {
    let mut options =
        MqttOptions::new(profile.client_id.clone(), profile.host.clone(), profile.port as u16);
    options.set_keep_alive(Duration::from_secs(profile.keep_alive_secs as u64));
    options.set_clean_session(profile.clean_session);

    if let Some(secret) = secret {
        if let Some(username) = secret.username.as_ref() {
            options.set_credentials(username.clone(), secret.password.clone().unwrap_or_default());
        }
    }

    if profile.use_tls {
        options.set_transport(build_transport(
            &profile.tls_mode,
            profile.ca_cert_path.as_deref(),
            profile.client_cert_path.as_deref(),
            profile.client_key_path.as_deref(),
            secret.and_then(|item| item.passphrase.as_deref()),
        )?);
    }

    Ok(options)
}

fn build_options_from_input(profile: &ConnectionProfileInput) -> AppResult<MqttOptions> {
    let mut options =
        MqttOptions::new(profile.client_id.clone(), profile.host.clone(), profile.port as u16);
    options.set_keep_alive(Duration::from_secs(profile.keep_alive_secs as u64));
    options.set_clean_session(profile.clean_session);

    if let Some(username) = profile.username.as_ref() {
        options.set_credentials(username.clone(), profile.password.clone().unwrap_or_default());
    }

    if profile.use_tls {
        options.set_transport(build_transport(
            &profile.tls_mode,
            profile.ca_cert_path.as_deref(),
            profile.client_cert_path.as_deref(),
            profile.client_key_path.as_deref(),
            profile.passphrase.as_deref(),
        )?);
    }

    Ok(options)
}

fn build_transport(
    tls_mode: &str,
    ca_cert_path: Option<&str>,
    client_cert_path: Option<&str>,
    client_key_path: Option<&str>,
    passphrase: Option<&str>,
) -> AppResult<Transport> {
    match tls_mode {
        "disabled" => Ok(Transport::tls_with_default_config()),
        "server_ca" => {
            let ca = read_tls_file(ca_cert_path, "CA 证书")?;
            let config = ClientConfig::builder()
                .with_root_certificates(build_root_cert_store(&ca)?)
                .with_no_client_auth();

            Ok(Transport::tls_with_config(TlsConfiguration::Rustls(Arc::new(
                config,
            ))))
        }
        "mutual" => {
            let ca = read_tls_file(ca_cert_path, "CA 证书")?;
            let cert = read_tls_file(client_cert_path, "客户端证书")?;
            let key = read_tls_file(client_key_path, "客户端私钥")?;
            let certificates = parse_certificate_chain(&cert, "客户端证书")?;
            let private_key = parse_private_key(&key, passphrase, "客户端私钥")?;
            let private_key = parse_rustls_private_key(
                &private_key,
                "客户端私钥",
            )?;

            let config = ClientConfig::builder()
                .with_root_certificates(build_root_cert_store(&ca)?)
                .with_client_auth_cert(certificates, private_key)
                .map_err(map_client_auth_error)?;

            Ok(Transport::tls_with_config(TlsConfiguration::Rustls(Arc::new(
                config,
            ))))
        }
        _ => Err(AppError::Message("TLS 模式无效，请检查连接配置".into())),
    }
}

fn read_tls_file(path: Option<&str>, label: &str) -> AppResult<Vec<u8>> {
    let path = path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Message(format!("{label} 路径不能为空")))?;

    let bytes = fs::read(path).map_err(|error| {
        AppError::Message(format!("{label} 读取失败：{path} ({error})"))
    })?;

    if bytes.is_empty() {
        return Err(AppError::Message(format!("{label} 文件为空：{path}")));
    }

    Ok(bytes)
}

fn build_root_cert_store(bytes: &[u8]) -> AppResult<RootCertStore> {
    let certificates = parse_certificate_chain(bytes, "CA 证书")?;
    let mut store = RootCertStore::empty();
    let (added, _) = store.add_parsable_certificates(certificates);

    if added == 0 {
        return Err(AppError::Message(
            "CA 证书无效，请使用 PEM 或 DER 证书文件".into(),
        ));
    }

    Ok(store)
}

fn parse_certificate_chain(bytes: &[u8], label: &str) -> AppResult<Vec<CertificateDer<'static>>> {
    if looks_like_pem(bytes) {
        let certs = rustls_pemfile::certs(&mut BufReader::new(Cursor::new(bytes)))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AppError::Message(format!("{label} 解析失败：{error}")))?;

        if !certs.is_empty() {
            return Ok(certs);
        }
    }

    Ok(vec![CertificateDer::from(bytes.to_vec())])
}

fn parse_private_key(
    bytes: &[u8],
    passphrase: Option<&str>,
    label: &str,
) -> AppResult<PrivateKeyDer<'static>> {
    let trimmed_passphrase = passphrase
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if is_encrypted_private_key(bytes) {
        let passphrase = trimmed_passphrase.ok_or_else(|| {
            AppError::Message(format!("{label} 需要 passphrase 才能解密"))
        })?;

        return decrypt_private_key(bytes, passphrase, label);
    }

    parse_plain_private_key(bytes, label)
}

fn is_encrypted_private_key(bytes: &[u8]) -> bool {
    if String::from_utf8_lossy(bytes).contains("BEGIN ENCRYPTED PRIVATE KEY") {
        return true;
    }

    EncryptedPrivateKeyInfo::try_from(bytes).is_ok()
}

fn parse_plain_private_key(bytes: &[u8], label: &str) -> AppResult<PrivateKeyDer<'static>> {
    if looks_like_pem(bytes) {
        let mut buffer = BufReader::new(Cursor::new(bytes));
        loop {
            match rustls_pemfile::read_one(&mut buffer)
                .map_err(|error| AppError::Message(format!("{label} 解析失败：{error}")))?
            {
                Some(rustls_pemfile::Item::Pkcs8Key(key)) => return Ok(key.into()),
                Some(rustls_pemfile::Item::Pkcs1Key(key)) => return Ok(key.into()),
                Some(rustls_pemfile::Item::Sec1Key(key)) => return Ok(key.into()),
                Some(_) => continue,
                None => break,
            }
        }
    }

    PrivateKeyDer::try_from(bytes)
        .map(|key| key.clone_key())
        .map_err(|_| {
            AppError::Message(format!(
                "{label} 格式无效，请使用 PEM/DER 私钥文件"
            ))
        })
}

fn decrypt_private_key(
    bytes: &[u8],
    passphrase: &str,
    label: &str,
) -> AppResult<PrivateKeyDer<'static>> {
    let decrypted = if String::from_utf8_lossy(bytes).contains("BEGIN ENCRYPTED PRIVATE KEY") {
        let pem = std::str::from_utf8(bytes).map_err(|_| {
            AppError::Message(format!("{label} 格式无效，请使用 PEM 或 DER 私钥文件"))
        })?;

        let (pem_label, doc) = SecretDocument::from_pem(pem).map_err(|error| {
            AppError::Message(format!("{label} 解析失败：{error}"))
        })?;

        if pem_label != "ENCRYPTED PRIVATE KEY" {
            return Err(AppError::Message(format!(
                "{label} 格式无效，请使用 ENCRYPTED PRIVATE KEY PEM 文件"
            )));
        }

        EncryptedPrivateKeyInfo::try_from(doc.as_bytes())
            .map_err(|error| AppError::Message(format!("{label} 解析失败：{error}")))?
            .decrypt(passphrase)
            .map_err(|error| {
                AppError::Message(format!(
                    "{label} 解密失败，请检查 passphrase 或私钥格式：{error}"
                ))
            })?
    } else {
        EncryptedPrivateKeyInfo::try_from(bytes)
            .map_err(|_| {
                AppError::Message(format!(
                    "{label} 格式无效，请使用 ENCRYPTED PRIVATE KEY PEM 或 PKCS#8 DER 文件"
                ))
            })?
            .decrypt(passphrase)
            .map_err(|error| {
                AppError::Message(format!(
                    "{label} 解密失败，请检查 passphrase 或私钥格式：{error}"
                ))
            })?
    };

    PrivateKeyDer::try_from(decrypted.as_bytes())
        .map(|key| key.clone_key())
        .map_err(|_| {
            AppError::Message(format!(
                "{label} 解密成功，但私钥内容无效或格式不受支持"
            ))
        })
}

fn looks_like_pem(bytes: &[u8]) -> bool {
    String::from_utf8_lossy(bytes).contains("-----BEGIN")
}

fn parse_rustls_private_key(
    key: &PrivateKeyDer<'static>,
    _label: &str,
) -> AppResult<rumqttc::tokio_rustls::rustls::pki_types::PrivateKeyDer<'static>> {
    Ok(key.clone_key())
}

fn map_client_auth_error(error: rustls::Error) -> AppError {
    match error {
        rustls::Error::InconsistentKeys(InconsistentKeys::KeyMismatch) => {
            AppError::Message("客户端证书与私钥不匹配，请检查文件配置".into())
        }
        rustls::Error::InconsistentKeys(_) => {
            AppError::Message("客户端证书或私钥无效，请检查文件内容".into())
        }
        rustls::Error::General(message) => {
            let normalized = message.to_lowercase();
            if normalized.contains("failed to parse")
                || normalized.contains("invalidencoding")
                || normalized.contains("invalid private key")
            {
                AppError::Message("客户端私钥格式无效，请检查文件内容".into())
            } else {
                AppError::Message(format!("客户端证书或私钥无效：{message}"))
            }
        }
        other => {
            let normalized = other.to_string().to_lowercase();
            if normalized.contains("keymismatch")
                || normalized.contains("keys may not be consistent")
            {
                AppError::Message("客户端证书与私钥不匹配，请检查文件配置".into())
            } else {
                AppError::Message(format!("客户端证书或私钥无效：{other}"))
            }
        }
    }
}

fn describe_connection_error(error: &ConnectionError) -> String {
    match error {
        ConnectionError::NetworkTimeout => "连接超时，请检查 broker 地址或网络状态".into(),
        ConnectionError::FlushTimeout => "连接建立后握手超时，请稍后重试".into(),
        ConnectionError::Io(io_error) => describe_io_error(io_error),
        ConnectionError::Tls(tls_error) => describe_tls_error(tls_error),
        ConnectionError::ConnectionRefused(code) => match code {
            ConnectReturnCode::Success => "Broker 已接受连接".into(),
            ConnectReturnCode::RefusedProtocolVersion => {
                "Broker 拒绝连接：MQTT 协议版本不被支持".into()
            }
            ConnectReturnCode::BadClientId => "Broker 拒绝连接：Client ID 无效".into(),
            ConnectReturnCode::ServiceUnavailable => "Broker 不可用，请稍后重试".into(),
            ConnectReturnCode::BadUserNamePassword => {
                "Broker 拒绝连接：用户名或密码错误".into()
            }
            ConnectReturnCode::NotAuthorized => "Broker 拒绝连接：当前账号没有权限".into(),
        },
        ConnectionError::MqttState(state_error) => {
            let state_message = state_error.to_string();
            let normalized = state_message.to_lowercase();
            if normalized.contains("closed by peer abruptly")
                || normalized.contains("connection aborted")
                || normalized.contains("requestsdone")
            {
                "连接已被远端关闭，请检查 broker 状态或网络连接".into()
            } else {
                format!("MQTT 会话状态异常：{state_message}")
            }
        }
        ConnectionError::NotConnAck(_) => "Broker 返回了异常响应，未收到正确的 ConnAck".into(),
        ConnectionError::RequestsDone => "MQTT 会话已经结束，无法继续发送请求".into(),
    }
}

fn describe_client_error(error: &ClientError) -> String {
    match error {
        ClientError::Request(_) | ClientError::TryRequest(_) => {
            "MQTT 会话未就绪，请先确认连接状态".into()
        }
    }
}

fn describe_io_error(error: &std::io::Error) -> String {
    use std::io::ErrorKind;

    match error.kind() {
        ErrorKind::ConnectionRefused => "Broker 地址可达，但端口拒绝连接".into(),
        ErrorKind::TimedOut => "连接超时，请检查 broker 地址、端口或网络状态".into(),
        ErrorKind::AddrNotAvailable | ErrorKind::NotFound => {
            "Broker 地址无效或当前网络无法解析该地址".into()
        }
        ErrorKind::ConnectionAborted | ErrorKind::ConnectionReset => {
            "连接被远端中断，请检查 broker 状态或 TLS 配置".into()
        }
        _ => format!("网络连接失败：{error}"),
    }
}

fn describe_tls_error(error: &rumqttc::TlsError) -> String {
    let message = error.to_string();
    let normalized = message.to_lowercase();

    if normalized.contains("dns name") {
        return "TLS 握手失败：证书域名与当前 Host 不匹配".into();
    }
    if normalized.contains("unknownissuer")
        || normalized.contains("unknown issuer")
        || normalized.contains("certificate unknown")
        || normalized.contains("invalid peer certificate: unknownissuer")
    {
        return "TLS 握手失败：服务器证书不受信任，请检查 CA 证书".into();
    }
    if normalized.contains("certificate not valid for name") {
        return "TLS 握手失败：服务器证书域名与当前 Host 不匹配".into();
    }
    if normalized.contains("no valid ca certificate") {
        return "TLS 配置错误：CA 证书格式无效".into();
    }
    if normalized.contains("no valid certificate for client authentication") {
        return "TLS 配置错误：客户端证书格式无效".into();
    }
    if normalized.contains("no valid key") {
        return "TLS 配置错误：客户端私钥格式无效".into();
    }
    if normalized.contains("decrypt")
        || normalized.contains("encrypted private key")
        || normalized.contains("passphrase")
    {
        return "TLS 配置错误：客户端私钥解密失败，请检查 passphrase".into();
    }
    if normalized.contains("keys may not be consistent") || normalized.contains("keymismatch") {
        return "TLS 配置错误：客户端证书与私钥不匹配".into();
    }

    format!("TLS 握手失败：{message}")
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    use super::to_qos;
    use crate::parser::build_payload_fields;

    #[test]
    fn detects_json_payloads() {
        assert_eq!(build_payload_fields(br#"{"ok":true}"#).payload_type, "json");
        assert_eq!(build_payload_fields(b"plain text").payload_type, "text");
        assert_eq!(build_payload_fields(&[0xff, 0xfe, 0xfd]).payload_type, "binary");
    }

    #[test]
    fn builds_binary_payload_fields() {
        let fields = build_payload_fields(&[0xff, 0xfe, 0xfd]);

        assert_eq!(fields.payload_type, "binary");
        assert_eq!(fields.payload_text, "");
        assert_eq!(fields.payload_base64, BASE64.encode([0xff, 0xfe, 0xfd]));
        assert_eq!(fields.payload_size, 3);
    }

    #[test]
    fn validates_qos_range() {
        assert!(to_qos(0).is_ok());
        assert!(to_qos(1).is_ok());
        assert!(to_qos(2).is_ok());
        assert!(to_qos(3).is_err());
    }
}
