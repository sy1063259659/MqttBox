use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use boa_engine::{js_string, property::Attribute, Context, JsString, JsValue, Source};
use serde::Serialize;

use crate::{
    error::{AppError, AppResult},
    models::{MessageParserTestRequest, MessageParserTestResultDto},
};

const PARSER_HELPERS_SOURCE: &str = r#"
const __parser_helpers = (() => {
  const normalizeBytes = (bytes) => Array.isArray(bytes) ? bytes : [];
  const BIGINT_64 = 1n << 64n;
  const BIGINT_63 = 1n << 63n;

  const ensureInteger = (value, name) => {
    if (!Number.isInteger(value)) {
      throw new Error(`${name} must be an integer`);
    }
  };

  const ensureRange = (bytes, offset, length) => {
    ensureInteger(offset, "offset");
    ensureInteger(length, "length");

    if (offset < 0) {
      throw new Error("offset must be a non-negative integer");
    }

    if (length < 1) {
      throw new Error("length must be at least 1");
    }

    const source = normalizeBytes(bytes);
    if (offset + length > source.length) {
      throw new Error(`read out of range at offset ${offset} length ${length}`);
    }

    return source;
  };

  const ensureOffset = (offset) => {
    ensureInteger(offset, "offset");

    if (offset < 0) {
      throw new Error("offset must be a non-negative integer");
    }
  };

  const toSigned = (value, bits) => {
    const shift = 32 - bits;
    return (value << shift) >> shift;
  };

  const normalizeHex = (hex) => String(hex ?? "").replace(/\s+/g, "");

  const formatHex = (bytes) =>
    normalizeBytes(bytes)
      .map((byte, index) =>
        `${index > 0 && index % 2 === 0 ? " " : ""}${Number(byte).toString(16).padStart(2, "0")}`,
      )
      .join("");

  const readUint64ValueBE = (bytes, offset) => {
    const source = ensureRange(bytes, offset, 8);
    let value = 0n;

    for (let index = 0; index < 8; index += 1) {
      value = (value << 8n) | BigInt(source[offset + index]);
    }

    return value;
  };

  const readUint64ValueLE = (bytes, offset) => {
    const source = ensureRange(bytes, offset, 8);
    let value = 0n;

    for (let index = 7; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(source[offset + index]);
    }

    return value;
  };

  const toSigned64 = (value) => (value >= BIGINT_63 ? value - BIGINT_64 : value);

  const readFloat = (bytes, offset, littleEndian, size) => {
    const source = ensureRange(bytes, offset, size);
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);

    for (let index = 0; index < size; index += 1) {
      view.setUint8(index, source[offset + index]);
    }

    return size === 4 ? view.getFloat32(0, littleEndian) : view.getFloat64(0, littleEndian);
  };

  const readUint8 = (bytes, offset) => ensureRange(bytes, offset, 1)[offset];
  const readInt8 = (bytes, offset) => toSigned(readUint8(bytes, offset), 8);

  const readUint16BE = (bytes, offset) => {
    const source = ensureRange(bytes, offset, 2);
    return (source[offset] << 8) | source[offset + 1];
  };

  const readUint16LE = (bytes, offset) => {
    const source = ensureRange(bytes, offset, 2);
    return source[offset] | (source[offset + 1] << 8);
  };

  const readInt16BE = (bytes, offset) => toSigned(readUint16BE(bytes, offset), 16);
  const readInt16LE = (bytes, offset) => toSigned(readUint16LE(bytes, offset), 16);

  const readUint32BE = (bytes, offset) => {
    const source = ensureRange(bytes, offset, 4);
    return (
      source[offset] * 0x1000000 +
      (source[offset + 1] << 16) +
      (source[offset + 2] << 8) +
      source[offset + 3]
    ) >>> 0;
  };

  const readUint32LE = (bytes, offset) => {
    const source = ensureRange(bytes, offset, 4);
    return (
      source[offset] +
      (source[offset + 1] << 8) +
      (source[offset + 2] << 16) +
      source[offset + 3] * 0x1000000
    ) >>> 0;
  };

  const readInt32BE = (bytes, offset) => readUint32BE(bytes, offset) | 0;
  const readInt32LE = (bytes, offset) => readUint32LE(bytes, offset) | 0;
  const readUint64BE = (bytes, offset) => readUint64ValueBE(bytes, offset).toString();
  const readUint64LE = (bytes, offset) => readUint64ValueLE(bytes, offset).toString();
  const readInt64BE = (bytes, offset) => toSigned64(readUint64ValueBE(bytes, offset)).toString();
  const readInt64LE = (bytes, offset) => toSigned64(readUint64ValueLE(bytes, offset)).toString();
  const readFloat32BE = (bytes, offset) => readFloat(bytes, offset, false, 4);
  const readFloat32LE = (bytes, offset) => readFloat(bytes, offset, true, 4);
  const readFloat64BE = (bytes, offset) => readFloat(bytes, offset, false, 8);
  const readFloat64LE = (bytes, offset) => readFloat(bytes, offset, true, 8);

  const bit = (value, index) => {
    ensureInteger(value, "value");
    ensureInteger(index, "index");

    if (index < 0 || index > 31) {
      throw new Error("bit index must be between 0 and 31");
    }

    return ((value >>> index) & 1) === 1;
  };

  const bits = (value, start, length) => {
    ensureInteger(value, "value");
    ensureInteger(start, "start");
    ensureInteger(length, "length");

    if (start < 0 || start > 31) {
      throw new Error("bit start must be between 0 and 31");
    }

    if (length < 1 || length > 31 || start + length > 32) {
      throw new Error("bit length is out of range");
    }

    return (value >>> start) & (Math.pow(2, length) - 1);
  };

  const sliceBytes = (bytes, start, length) =>
    Array.from(ensureRange(bytes, start, length).slice(start, start + length));

  const sliceHex = (bytes, start, length) => formatHex(sliceBytes(bytes, start, length));

  const hexToBytes = (hex) => {
    const compact = normalizeHex(hex);
    if (!compact) {
      return [];
    }

    if (compact.length % 2 !== 0) {
      throw new Error("hex length must be even");
    }

    if (!/^[0-9a-fA-F]+$/.test(compact)) {
      throw new Error("hex contains invalid characters");
    }

    const result = [];
    for (let index = 0; index < compact.length; index += 2) {
      result.push(parseInt(compact.slice(index, index + 2), 16));
    }

    return result;
  };

  const bytesToHex = (bytes) => formatHex(bytes);

  const readAscii = (bytes, start, length) =>
    sliceBytes(bytes, start, length)
      .map((byte) => (byte === 0 ? "" : String.fromCharCode(byte)))
      .join("")
      .replace(/\u0000+$/g, "");

  const readUtf8 = (bytes, start, length) => {
    const encoded = sliceBytes(bytes, start, length)
      .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
      .join("");

    try {
      return decodeURIComponent(encoded);
    } catch (error) {
      throw new Error("invalid UTF-8 payload");
    }
  };

  const readBcd = (bytes, start, length) =>
    sliceBytes(bytes, start, length)
      .map((byte) => `${(byte >> 4) & 0x0f}${byte & 0x0f}`)
      .join("");

  const startsWithBytes = (bytes, prefix, offset = 0) => {
    ensureOffset(offset);
    const source = normalizeBytes(bytes);
    const prefixBytes = typeof prefix === "string" ? hexToBytes(prefix) : normalizeBytes(prefix);

    if (offset + prefixBytes.length > source.length) {
      return false;
    }

    for (let index = 0; index < prefixBytes.length; index += 1) {
      if (source[offset + index] !== prefixBytes[index]) {
        return false;
      }
    }

    return true;
  };

  const unixSeconds = (value) => {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) {
      throw new Error("timestamp must be a number");
    }

    return new Date(timestamp * 1000).toISOString();
  };

  const unixMillis = (value) => {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) {
      throw new Error("timestamp must be a number");
    }

    return new Date(timestamp).toISOString();
  };

  return {
    readUint8,
    readInt8,
    readUint16BE,
    readUint16LE,
    readInt16BE,
    readInt16LE,
    readUint32BE,
    readUint32LE,
    readInt32BE,
    readInt32LE,
    readUint64BE,
    readUint64LE,
    readInt64BE,
    readInt64LE,
    readFloat32BE,
    readFloat32LE,
    readFloat64BE,
    readFloat64LE,
    bit,
    bits,
    sliceBytes,
    sliceHex,
    hexToBytes,
    bytesToHex,
    readAscii,
    readUtf8,
    readBcd,
    startsWithBytes,
    unixSeconds,
    unixMillis,
  };
})();
"#;

#[derive(Debug, Clone)]
pub struct PayloadFields {
    pub payload_text: String,
    pub payload_base64: String,
    pub raw_payload_hex: String,
    pub payload_type: String,
    pub payload_size: i64,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageParserRuntimeInput {
    pub topic: String,
    pub connection_id: String,
    pub payload_type: String,
    pub payload_text: String,
    pub payload_base64: String,
    pub payload_hex: String,
    pub payload_size: i64,
    pub qos: u8,
    pub retain: bool,
    pub dup: bool,
    pub bytes: Vec<u8>,
}

pub fn build_payload_fields(payload: &[u8]) -> PayloadFields {
    let payload_type = detect_payload_type(payload);
    let payload_text = if payload_type == "binary" {
        String::new()
    } else {
        std::str::from_utf8(payload)
            .map(str::to_owned)
            .unwrap_or_default()
    };

    PayloadFields {
        payload_text,
        payload_base64: BASE64.encode(payload),
        raw_payload_hex: format_payload_as_hex(payload),
        payload_type,
        payload_size: payload.len() as i64,
        bytes: payload.to_vec(),
    }
}

pub fn execute_message_parser(
    script: &str,
    input: &MessageParserRuntimeInput,
) -> AppResult<String> {
    let input_json = serde_json::to_string(input)?;
    let mut context = Context::default();

    context
        .register_global_property(
            js_string!("__parser_input_json"),
            JsValue::new(JsString::from(input_json.as_str())),
            Attribute::all(),
        )
        .map_err(|error| AppError::Message(error.to_string()))?;

    context
        .eval(Source::from_bytes(PARSER_HELPERS_SOURCE))
        .map_err(|error| AppError::Message(error.to_string()))?;

    context
        .eval(Source::from_bytes(script))
        .map_err(|error| AppError::Message(error.to_string()))?;

    let result = context
        .eval(Source::from_bytes(
            r#"
            (() => {
              if (typeof parse !== "function") {
                throw new Error("parse function is required");
              }

              const result = parse(JSON.parse(__parser_input_json), __parser_helpers);
              const json = JSON.stringify(result);

              if (typeof json !== "string") {
                throw new Error("parse must return a JSON-serializable value");
              }

              return json;
            })()
            "#,
        ))
        .map_err(|error| AppError::Message(error.to_string()))?;

    result
        .as_string()
        .map(|value| value.to_std_string_escaped())
        .ok_or_else(|| AppError::Message("parse must return a JSON-serializable value".into()))
}

pub fn build_test_runtime_input(
    request: &MessageParserTestRequest,
) -> AppResult<MessageParserRuntimeInput> {
    let payload = normalize_test_payload(request)?;
    Ok(MessageParserRuntimeInput {
        topic: request.topic.clone().unwrap_or_default(),
        connection_id: String::new(),
        payload_type: payload.payload_type.clone(),
        payload_text: payload.payload_text.clone(),
        payload_base64: payload.payload_base64.clone(),
        payload_hex: payload.raw_payload_hex.clone(),
        payload_size: payload.payload_size,
        qos: 0,
        retain: false,
        dup: false,
        bytes: payload.bytes,
    })
}

pub fn test_message_parser(request: &MessageParserTestRequest) -> MessageParserTestResultDto {
    match build_test_runtime_input(request)
        .and_then(|input| execute_message_parser(&request.script, &input))
    {
        Ok(parsed_payload_json) => MessageParserTestResultDto {
            ok: true,
            parsed_payload_json: Some(pretty_json(&parsed_payload_json)),
            parse_error: None,
        },
        Err(error) => MessageParserTestResultDto {
            ok: false,
            parsed_payload_json: None,
            parse_error: Some(error.to_string()),
        },
    }
}

pub fn pretty_json(value: &str) -> String {
    serde_json::from_str::<serde_json::Value>(value)
        .and_then(|json| serde_json::to_string_pretty(&json))
        .unwrap_or_else(|_| value.to_string())
}

fn detect_payload_type(payload: &[u8]) -> String {
    match std::str::from_utf8(payload) {
        Ok(text) => {
            if serde_json::from_str::<serde_json::Value>(text).is_ok() {
                "json".into()
            } else {
                "text".into()
            }
        }
        Err(_) => "binary".into(),
    }
}

fn normalize_test_payload(request: &MessageParserTestRequest) -> AppResult<PayloadFields> {
    decode_hex_payload(&request.payload_hex).map(|bytes| build_payload_fields(&bytes))
}

fn decode_hex_payload(value: &str) -> AppResult<Vec<u8>> {
    let compact: String = value.chars().filter(|char| !char.is_whitespace()).collect();
    if compact.is_empty() {
        return Ok(Vec::new());
    }

    if compact.len() % 2 != 0 {
        return Err(AppError::Message("Hex payload 长度必须为偶数".into()));
    }

    compact
        .as_bytes()
        .chunks(2)
        .map(|pair| {
            let hex = std::str::from_utf8(pair)
                .map_err(|_| AppError::Message("Hex payload 含有无效字符".into()))?;
            u8::from_str_radix(hex, 16)
                .map_err(|_| AppError::Message("Hex payload 含有无效字符".into()))
        })
        .collect()
}

fn format_payload_as_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .enumerate()
        .map(|(index, byte)| {
            let prefix = if index % 2 == 0 && index > 0 { " " } else { "" };
            format!("{prefix}{:02x}", byte)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        build_test_runtime_input, execute_message_parser, test_message_parser,
        MessageParserRuntimeInput,
    };
    use crate::models::MessageParserTestRequest;
    use serde_json::Value;

    fn sample_input() -> MessageParserRuntimeInput {
        MessageParserRuntimeInput {
            topic: "device/demo".into(),
            connection_id: "conn-1".into(),
            payload_type: "binary".into(),
            payload_text: String::new(),
            payload_base64: "AQIDBA==".into(),
            payload_hex: "0102 0304".into(),
            payload_size: 4,
            qos: 0,
            retain: false,
            dup: false,
            bytes: vec![1, 2, 3, 4],
        }
    }

    #[test]
    fn execute_message_parser_supports_helpers_argument() {
        let output = execute_message_parser(
            r#"
            function parse(input, helpers) {
              return {
                word: helpers.readUint16BE(input.bytes, 0),
                online: helpers.bit(input.bytes[2], 0),
              };
            }
            "#,
            &sample_input(),
        )
        .expect("parser should succeed");

        assert_eq!(output, r#"{"word":258,"online":true}"#);
    }

    #[test]
    fn build_test_runtime_input_uses_payload_hex() {
        let input = build_test_runtime_input(&MessageParserTestRequest {
            script: String::new(),
            payload_hex: "0A 0B 0C".into(),
            topic: None,
        })
        .expect("hex payload should decode");

        assert_eq!(input.payload_hex, "0a0b 0c");
        assert_eq!(input.bytes, vec![10, 11, 12]);
    }

    #[test]
    fn test_message_parser_returns_hex_decode_error() {
        let result = test_message_parser(&MessageParserTestRequest {
            script: "function parse() { return {}; }".into(),
            payload_hex: "ABC".into(),
            topic: None,
        });

        assert!(!result.ok);
        assert_eq!(
            result.parse_error.as_deref(),
            Some("Hex payload 长度必须为偶数")
        );
    }

    #[test]
    fn execute_message_parser_supports_extended_helpers() {
        let input = MessageParserRuntimeInput {
            topic: "device/demo".into(),
            connection_id: "conn-1".into(),
            payload_type: "binary".into(),
            payload_text: String::new(),
            payload_base64: String::new(),
            payload_hex: "0000 0000 0000 0001 3f80 0000 e4bd a0e5 a5bd 68".into(),
            payload_size: 15,
            qos: 0,
            retain: false,
            dup: false,
            bytes: vec![
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x3f, 0x80, 0x00, 0x00, 0xe4, 0xbd,
                0xa0, 0xe5, 0xa5, 0xbd, 0x68,
            ],
        };

        let output = execute_message_parser(
            r#"
            function parse(input, helpers) {
              return {
                uint64: helpers.readUint64BE(input.bytes, 0),
                float32: helpers.readFloat32BE(input.bytes, 8),
                utf8: helpers.readUtf8(input.bytes, 12, 6),
                prefixArray: helpers.startsWithBytes(input.bytes, [0x00, 0x00], 0),
                prefixHex: helpers.startsWithBytes(input.bytes, "3f80", 8),
                hexRoundTrip: helpers.bytesToHex(helpers.hexToBytes("01 02 0A FF")),
              };
            }
            "#,
            &input,
        )
        .expect("extended helpers should succeed");

        let json: Value = serde_json::from_str(&output).expect("output should be valid json");
        assert_eq!(json["uint64"], "1");
        assert_eq!(json["float32"], 1.0);
        assert_eq!(json["utf8"], "你好");
        assert_eq!(json["prefixArray"], true);
        assert_eq!(json["prefixHex"], true);
        assert_eq!(json["hexRoundTrip"], "0102 0aff");
    }
}
