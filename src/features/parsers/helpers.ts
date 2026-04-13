import type { SupportedLocale } from "@/lib/locale";

type LocalizedText = Record<SupportedLocale, string>;

interface ParserHelperMetadata {
  name: string;
  signature: string;
  insertText: string;
  detail: LocalizedText;
  documentation: LocalizedText;
  example: LocalizedText;
}

export interface ParserHelperDescriptor {
  name: string;
  signature: string;
  insertText: string;
  detail: string;
  documentation: string;
  example: string;
}

function localized(locale: SupportedLocale, text: LocalizedText) {
  return text[locale] ?? text["en-US"];
}

const PARSER_HELPER_METADATA: ParserHelperMetadata[] = [
  {
    name: "readUint8",
    signature: "readUint8(bytes, offset)",
    insertText: "readUint8(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 8-bit unsigned integer",
      "zh-CN": "读取 8 位无符号整数",
    },
    documentation: {
      "en-US": "Reads 1 byte from the given offset and returns an unsigned integer.",
      "zh-CN": "从指定 offset 读取 1 个字节，并返回 8 位无符号整数。",
    },
    example: {
      "en-US": "Example: helpers.readUint8(input.bytes, 0)",
      "zh-CN": "示例：helpers.readUint8(input.bytes, 0)",
    },
  },
  {
    name: "readInt8",
    signature: "readInt8(bytes, offset)",
    insertText: "readInt8(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 8-bit signed integer",
      "zh-CN": "读取 8 位有符号整数",
    },
    documentation: {
      "en-US": "Reads 1 byte from the given offset and returns a signed integer.",
      "zh-CN": "从指定 offset 读取 1 个字节，并返回 8 位有符号整数。",
    },
    example: {
      "en-US": "Example: helpers.readInt8(input.bytes, 1)",
      "zh-CN": "示例：helpers.readInt8(input.bytes, 1)",
    },
  },
  {
    name: "readUint16BE",
    signature: "readUint16BE(bytes, offset)",
    insertText: "readUint16BE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 16-bit unsigned integer, BE = big-endian",
      "zh-CN": "读取 16 位无符号整数，BE = 大端",
    },
    documentation: {
      "en-US": "Reads 2 bytes as an unsigned 16-bit integer. BE means big-endian, high byte first.",
      "zh-CN": "按 2 个字节读取 16 位无符号整数。BE 表示大端，高字节在前。",
    },
    example: {
      "en-US": "Example: helpers.readUint16BE(input.bytes, 2)",
      "zh-CN": "示例：helpers.readUint16BE(input.bytes, 2)",
    },
  },
  {
    name: "readUint16LE",
    signature: "readUint16LE(bytes, offset)",
    insertText: "readUint16LE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 16-bit unsigned integer, LE = little-endian",
      "zh-CN": "读取 16 位无符号整数，LE = 小端",
    },
    documentation: {
      "en-US": "Reads 2 bytes as an unsigned 16-bit integer. LE means little-endian, low byte first.",
      "zh-CN": "按 2 个字节读取 16 位无符号整数。LE 表示小端，低字节在前。",
    },
    example: {
      "en-US": "Example: helpers.readUint16LE(input.bytes, 2)",
      "zh-CN": "示例：helpers.readUint16LE(input.bytes, 2)",
    },
  },
  {
    name: "readInt16BE",
    signature: "readInt16BE(bytes, offset)",
    insertText: "readInt16BE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read signed 16-bit integer, BE = big-endian",
      "zh-CN": "读取 16 位有符号整数，BE = 大端",
    },
    documentation: {
      "en-US": "Reads 2 bytes as a signed 16-bit integer in big-endian order.",
      "zh-CN": "按大端顺序读取 2 个字节，并返回 16 位有符号整数。",
    },
    example: {
      "en-US": "Example: helpers.readInt16BE(input.bytes, 4)",
      "zh-CN": "示例：helpers.readInt16BE(input.bytes, 4)",
    },
  },
  {
    name: "readInt16LE",
    signature: "readInt16LE(bytes, offset)",
    insertText: "readInt16LE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read signed 16-bit integer, LE = little-endian",
      "zh-CN": "读取 16 位有符号整数，LE = 小端",
    },
    documentation: {
      "en-US": "Reads 2 bytes as a signed 16-bit integer in little-endian order.",
      "zh-CN": "按小端顺序读取 2 个字节，并返回 16 位有符号整数。",
    },
    example: {
      "en-US": "Example: helpers.readInt16LE(input.bytes, 4)",
      "zh-CN": "示例：helpers.readInt16LE(input.bytes, 4)",
    },
  },
  {
    name: "readUint32BE",
    signature: "readUint32BE(bytes, offset)",
    insertText: "readUint32BE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 32-bit unsigned integer, BE = big-endian",
      "zh-CN": "读取 32 位无符号整数，BE = 大端",
    },
    documentation: {
      "en-US": "Reads 4 bytes as an unsigned 32-bit integer. BE means big-endian, high byte first.",
      "zh-CN": "按 4 个字节读取 32 位无符号整数。BE 表示大端，高字节在前。",
    },
    example: {
      "en-US": "Example: helpers.readUint32BE(input.bytes, 0)",
      "zh-CN": "示例：helpers.readUint32BE(input.bytes, 0)",
    },
  },
  {
    name: "readUint32LE",
    signature: "readUint32LE(bytes, offset)",
    insertText: "readUint32LE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 32-bit unsigned integer, LE = little-endian",
      "zh-CN": "读取 32 位无符号整数，LE = 小端",
    },
    documentation: {
      "en-US": "Reads 4 bytes as an unsigned 32-bit integer. LE means little-endian, low byte first.",
      "zh-CN": "按 4 个字节读取 32 位无符号整数。LE 表示小端，低字节在前。",
    },
    example: {
      "en-US": "Example: helpers.readUint32LE(input.bytes, 0)",
      "zh-CN": "示例：helpers.readUint32LE(input.bytes, 0)",
    },
  },
  {
    name: "readInt32BE",
    signature: "readInt32BE(bytes, offset)",
    insertText: "readInt32BE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read signed 32-bit integer, BE = big-endian",
      "zh-CN": "读取 32 位有符号整数，BE = 大端",
    },
    documentation: {
      "en-US": "Reads 4 bytes as a signed 32-bit integer in big-endian order.",
      "zh-CN": "按大端顺序读取 4 个字节，并返回 32 位有符号整数。",
    },
    example: {
      "en-US": "Example: helpers.readInt32BE(input.bytes, 0)",
      "zh-CN": "示例：helpers.readInt32BE(input.bytes, 0)",
    },
  },
  {
    name: "readInt32LE",
    signature: "readInt32LE(bytes, offset)",
    insertText: "readInt32LE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read signed 32-bit integer, LE = little-endian",
      "zh-CN": "读取 32 位有符号整数，LE = 小端",
    },
    documentation: {
      "en-US": "Reads 4 bytes as a signed 32-bit integer in little-endian order.",
      "zh-CN": "按小端顺序读取 4 个字节，并返回 32 位有符号整数。",
    },
    example: {
      "en-US": "Example: helpers.readInt32LE(input.bytes, 0)",
      "zh-CN": "示例：helpers.readInt32LE(input.bytes, 0)",
    },
  },
  {
    name: "readUint64BE",
    signature: "readUint64BE(bytes, offset)",
    insertText: "readUint64BE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 64-bit unsigned integer, BE = big-endian",
      "zh-CN": "读取 64 位无符号整数，BE = 大端",
    },
    documentation: {
      "en-US": "Reads 8 bytes as an unsigned 64-bit integer in big-endian order. Returns a string to avoid precision loss.",
      "zh-CN": "按大端顺序读取 8 个字节，并返回 64 位无符号整数。为避免精度丢失，返回字符串。",
    },
    example: {
      "en-US": "Example: helpers.readUint64BE(input.bytes, 0)",
      "zh-CN": "示例：helpers.readUint64BE(input.bytes, 0)",
    },
  },
  {
    name: "readUint64LE",
    signature: "readUint64LE(bytes, offset)",
    insertText: "readUint64LE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 64-bit unsigned integer, LE = little-endian",
      "zh-CN": "读取 64 位无符号整数，LE = 小端",
    },
    documentation: {
      "en-US": "Reads 8 bytes as an unsigned 64-bit integer in little-endian order. Returns a string to avoid precision loss.",
      "zh-CN": "按小端顺序读取 8 个字节，并返回 64 位无符号整数。为避免精度丢失，返回字符串。",
    },
    example: {
      "en-US": "Example: helpers.readUint64LE(input.bytes, 0)",
      "zh-CN": "示例：helpers.readUint64LE(input.bytes, 0)",
    },
  },
  {
    name: "readInt64BE",
    signature: "readInt64BE(bytes, offset)",
    insertText: "readInt64BE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read signed 64-bit integer, BE = big-endian",
      "zh-CN": "读取 64 位有符号整数，BE = 大端",
    },
    documentation: {
      "en-US": "Reads 8 bytes as a signed 64-bit integer in big-endian order. Returns a string to avoid precision loss.",
      "zh-CN": "按大端顺序读取 8 个字节，并返回 64 位有符号整数。为避免精度丢失，返回字符串。",
    },
    example: {
      "en-US": "Example: helpers.readInt64BE(input.bytes, 0)",
      "zh-CN": "示例：helpers.readInt64BE(input.bytes, 0)",
    },
  },
  {
    name: "readInt64LE",
    signature: "readInt64LE(bytes, offset)",
    insertText: "readInt64LE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read signed 64-bit integer, LE = little-endian",
      "zh-CN": "读取 64 位有符号整数，LE = 小端",
    },
    documentation: {
      "en-US": "Reads 8 bytes as a signed 64-bit integer in little-endian order. Returns a string to avoid precision loss.",
      "zh-CN": "按小端顺序读取 8 个字节，并返回 64 位有符号整数。为避免精度丢失，返回字符串。",
    },
    example: {
      "en-US": "Example: helpers.readInt64LE(input.bytes, 0)",
      "zh-CN": "示例：helpers.readInt64LE(input.bytes, 0)",
    },
  },
  {
    name: "readFloat32BE",
    signature: "readFloat32BE(bytes, offset)",
    insertText: "readFloat32BE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 32-bit float, BE = big-endian",
      "zh-CN": "读取 32 位浮点数，BE = 大端",
    },
    documentation: {
      "en-US": "Reads 4 bytes as an IEEE-754 float32 in big-endian order.",
      "zh-CN": "按大端顺序读取 4 个字节，并返回 IEEE-754 float32 浮点数。",
    },
    example: {
      "en-US": "Example: helpers.readFloat32BE(input.bytes, 8)",
      "zh-CN": "示例：helpers.readFloat32BE(input.bytes, 8)",
    },
  },
  {
    name: "readFloat32LE",
    signature: "readFloat32LE(bytes, offset)",
    insertText: "readFloat32LE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 32-bit float, LE = little-endian",
      "zh-CN": "读取 32 位浮点数，LE = 小端",
    },
    documentation: {
      "en-US": "Reads 4 bytes as an IEEE-754 float32 in little-endian order.",
      "zh-CN": "按小端顺序读取 4 个字节，并返回 IEEE-754 float32 浮点数。",
    },
    example: {
      "en-US": "Example: helpers.readFloat32LE(input.bytes, 8)",
      "zh-CN": "示例：helpers.readFloat32LE(input.bytes, 8)",
    },
  },
  {
    name: "readFloat64BE",
    signature: "readFloat64BE(bytes, offset)",
    insertText: "readFloat64BE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 64-bit float, BE = big-endian",
      "zh-CN": "读取 64 位浮点数，BE = 大端",
    },
    documentation: {
      "en-US": "Reads 8 bytes as an IEEE-754 float64 in big-endian order.",
      "zh-CN": "按大端顺序读取 8 个字节，并返回 IEEE-754 float64 浮点数。",
    },
    example: {
      "en-US": "Example: helpers.readFloat64BE(input.bytes, 8)",
      "zh-CN": "示例：helpers.readFloat64BE(input.bytes, 8)",
    },
  },
  {
    name: "readFloat64LE",
    signature: "readFloat64LE(bytes, offset)",
    insertText: "readFloat64LE(${1:bytes}, ${2:offset})",
    detail: {
      "en-US": "Read 64-bit float, LE = little-endian",
      "zh-CN": "读取 64 位浮点数，LE = 小端",
    },
    documentation: {
      "en-US": "Reads 8 bytes as an IEEE-754 float64 in little-endian order.",
      "zh-CN": "按小端顺序读取 8 个字节，并返回 IEEE-754 float64 浮点数。",
    },
    example: {
      "en-US": "Example: helpers.readFloat64LE(input.bytes, 8)",
      "zh-CN": "示例：helpers.readFloat64LE(input.bytes, 8)",
    },
  },
  {
    name: "bit",
    signature: "bit(value, index)",
    insertText: "bit(${1:value}, ${2:index})",
    detail: {
      "en-US": "Read a single bit",
      "zh-CN": "读取单个 bit 位",
    },
    documentation: {
      "en-US": "Returns true when the bit at the given index is 1.",
      "zh-CN": "读取指定 bit 位，当该位为 1 时返回 true。",
    },
    example: {
      "en-US": "Example: helpers.bit(flags, 3)",
      "zh-CN": "示例：helpers.bit(flags, 3)",
    },
  },
  {
    name: "bits",
    signature: "bits(value, start, length)",
    insertText: "bits(${1:value}, ${2:start}, ${3:length})",
    detail: {
      "en-US": "Read a bit range",
      "zh-CN": "读取 bit 范围",
    },
    documentation: {
      "en-US": "Extracts a bit range from a numeric value and returns it as an unsigned integer.",
      "zh-CN": "从数值中截取一段 bit 位，并以无符号整数形式返回。",
    },
    example: {
      "en-US": "Example: helpers.bits(flags, 2, 3)",
      "zh-CN": "示例：helpers.bits(flags, 2, 3)",
    },
  },
  {
    name: "sliceBytes",
    signature: "sliceBytes(bytes, start, length)",
    insertText: "sliceBytes(${1:bytes}, ${2:start}, ${3:length})",
    detail: {
      "en-US": "Slice raw bytes",
      "zh-CN": "截取字节数组",
    },
    documentation: {
      "en-US": "Returns a new byte array from the given start and length.",
      "zh-CN": "按起始位置和长度截取字节数组，并返回新的 number[]。",
    },
    example: {
      "en-US": "Example: helpers.sliceBytes(input.bytes, 6, 4)",
      "zh-CN": "示例：helpers.sliceBytes(input.bytes, 6, 4)",
    },
  },
  {
    name: "sliceHex",
    signature: "sliceHex(bytes, start, length)",
    insertText: "sliceHex(${1:bytes}, ${2:start}, ${3:length})",
    detail: {
      "en-US": "Slice bytes as hex string",
      "zh-CN": "截取为 Hex 字符串",
    },
    documentation: {
      "en-US": "Returns the selected bytes as a lowercase hex string with stable spacing.",
      "zh-CN": "将截取出的字节转换成小写 Hex 字符串，并保留稳定的分组空格。",
    },
    example: {
      "en-US": "Example: helpers.sliceHex(input.bytes, 6, 4)",
      "zh-CN": "示例：helpers.sliceHex(input.bytes, 6, 4)",
    },
  },
  {
    name: "hexToBytes",
    signature: "hexToBytes(hex)",
    insertText: "hexToBytes(${1:hex})",
    detail: {
      "en-US": "Convert hex string to bytes",
      "zh-CN": "将 Hex 字符串转成字节数组",
    },
    documentation: {
      "en-US": "Decodes a hex string into number[]. Whitespace is ignored.",
      "zh-CN": "将 Hex 字符串解码成 number[]。会自动忽略空白字符。",
    },
    example: {
      "en-US": "Example: helpers.hexToBytes(\"01 02 0A FF\")",
      "zh-CN": "示例：helpers.hexToBytes(\"01 02 0A FF\")",
    },
  },
  {
    name: "bytesToHex",
    signature: "bytesToHex(bytes)",
    insertText: "bytesToHex(${1:bytes})",
    detail: {
      "en-US": "Convert bytes to hex string",
      "zh-CN": "将字节数组转成 Hex 字符串",
    },
    documentation: {
      "en-US": "Converts number[] into a lowercase hex string with stable spacing.",
      "zh-CN": "将 number[] 转成小写 Hex 字符串，并保留稳定的分组空格。",
    },
    example: {
      "en-US": "Example: helpers.bytesToHex([1, 2, 10, 255])",
      "zh-CN": "示例：helpers.bytesToHex([1, 2, 10, 255])",
    },
  },
  {
    name: "readAscii",
    signature: "readAscii(bytes, start, length)",
    insertText: "readAscii(${1:bytes}, ${2:start}, ${3:length})",
    detail: {
      "en-US": "Read ASCII text",
      "zh-CN": "读取 ASCII 文本",
    },
    documentation: {
      "en-US": "Reads ASCII text from the selected byte range and trims trailing null bytes.",
      "zh-CN": "从指定字节范围读取 ASCII 文本，并去掉尾部的空字符。",
    },
    example: {
      "en-US": "Example: helpers.readAscii(input.bytes, 10, 6)",
      "zh-CN": "示例：helpers.readAscii(input.bytes, 10, 6)",
    },
  },
  {
    name: "readUtf8",
    signature: "readUtf8(bytes, start, length)",
    insertText: "readUtf8(${1:bytes}, ${2:start}, ${3:length})",
    detail: {
      "en-US": "Read UTF-8 text",
      "zh-CN": "读取 UTF-8 文本",
    },
    documentation: {
      "en-US": "Reads UTF-8 text from the selected byte range. Useful when payload contains Chinese or other multibyte characters.",
      "zh-CN": "从指定字节范围读取 UTF-8 文本。适合包含中文或其他多字节字符的报文。",
    },
    example: {
      "en-US": "Example: helpers.readUtf8(input.bytes, 12, 6)",
      "zh-CN": "示例：helpers.readUtf8(input.bytes, 12, 6)",
    },
  },
  {
    name: "readBcd",
    signature: "readBcd(bytes, start, length)",
    insertText: "readBcd(${1:bytes}, ${2:start}, ${3:length})",
    detail: {
      "en-US": "Read packed BCD",
      "zh-CN": "读取压缩 BCD",
    },
    documentation: {
      "en-US": "Reads packed BCD bytes and returns a digit string.",
      "zh-CN": "读取压缩 BCD 字节，并返回数字字符串。",
    },
    example: {
      "en-US": "Example: helpers.readBcd(input.bytes, 14, 3)",
      "zh-CN": "示例：helpers.readBcd(input.bytes, 14, 3)",
    },
  },
  {
    name: "startsWithBytes",
    signature: "startsWithBytes(bytes, prefix, offset = 0)",
    insertText: "startsWithBytes(${1:bytes}, ${2:prefix}, ${3:0})",
    detail: {
      "en-US": "Check byte prefix",
      "zh-CN": "判断字节前缀",
    },
    documentation: {
      "en-US": "Checks whether the byte array starts with the given prefix from the specified offset. Prefix can be number[] or a hex string.",
      "zh-CN": "判断字节数组从指定 offset 开始是否匹配某个前缀。prefix 可以是 number[] 或 Hex 字符串。",
    },
    example: {
      "en-US": "Example: helpers.startsWithBytes(input.bytes, [0x68, 0x68], 0)",
      "zh-CN": "示例：helpers.startsWithBytes(input.bytes, [0x68, 0x68], 0)",
    },
  },
  {
    name: "unixSeconds",
    signature: "unixSeconds(value)",
    insertText: "unixSeconds(${1:value})",
    detail: {
      "en-US": "Unix seconds to ISO string",
      "zh-CN": "Unix 秒时间戳转 ISO 字符串",
    },
    documentation: {
      "en-US": "Converts a unix-seconds timestamp into an ISO 8601 UTC string.",
      "zh-CN": "将 Unix 秒级时间戳转换成 ISO 8601 UTC 时间字符串。",
    },
    example: {
      "en-US": "Example: helpers.unixSeconds(1712995200)",
      "zh-CN": "示例：helpers.unixSeconds(1712995200)",
    },
  },
  {
    name: "unixMillis",
    signature: "unixMillis(value)",
    insertText: "unixMillis(${1:value})",
    detail: {
      "en-US": "Unix milliseconds to ISO string",
      "zh-CN": "Unix 毫秒时间戳转 ISO 字符串",
    },
    documentation: {
      "en-US": "Converts a unix-milliseconds timestamp into an ISO 8601 UTC string.",
      "zh-CN": "将 Unix 毫秒级时间戳转换成 ISO 8601 UTC 时间字符串。",
    },
    example: {
      "en-US": "Example: helpers.unixMillis(1712995200123)",
      "zh-CN": "示例：helpers.unixMillis(1712995200123)",
    },
  },
];

export function getParserHelpers(locale: SupportedLocale): ParserHelperDescriptor[] {
  return PARSER_HELPER_METADATA.map((helper) => ({
    name: helper.name,
    signature: helper.signature,
    insertText: helper.insertText,
    detail: localized(locale, helper.detail),
    documentation: localized(locale, helper.documentation),
    example: localized(locale, helper.example),
  }));
}

export const PARSER_MONACO_DECLARATIONS = `
declare interface ParserRuntimeInput {
  topic: string;
  connectionId: string;
  payloadType: string;
  payloadText: string;
  payloadBase64: string;
  payloadHex: string;
  payloadSize: number;
  qos: number;
  retain: boolean;
  dup: boolean;
  bytes: number[];
}

declare interface ParserHelpers {
  readUint8(bytes: number[], offset: number): number;
  readInt8(bytes: number[], offset: number): number;
  readUint16BE(bytes: number[], offset: number): number;
  readUint16LE(bytes: number[], offset: number): number;
  readInt16BE(bytes: number[], offset: number): number;
  readInt16LE(bytes: number[], offset: number): number;
  readUint32BE(bytes: number[], offset: number): number;
  readUint32LE(bytes: number[], offset: number): number;
  readInt32BE(bytes: number[], offset: number): number;
  readInt32LE(bytes: number[], offset: number): number;
  readUint64BE(bytes: number[], offset: number): string;
  readUint64LE(bytes: number[], offset: number): string;
  readInt64BE(bytes: number[], offset: number): string;
  readInt64LE(bytes: number[], offset: number): string;
  readFloat32BE(bytes: number[], offset: number): number;
  readFloat32LE(bytes: number[], offset: number): number;
  readFloat64BE(bytes: number[], offset: number): number;
  readFloat64LE(bytes: number[], offset: number): number;
  bit(value: number, index: number): boolean;
  bits(value: number, start: number, length: number): number;
  sliceBytes(bytes: number[], start: number, length: number): number[];
  sliceHex(bytes: number[], start: number, length: number): string;
  hexToBytes(hex: string): number[];
  bytesToHex(bytes: number[]): string;
  readAscii(bytes: number[], start: number, length: number): string;
  readUtf8(bytes: number[], start: number, length: number): string;
  readBcd(bytes: number[], start: number, length: number): string;
  startsWithBytes(bytes: number[], prefix: number[] | string, offset?: number): boolean;
  unixSeconds(value: number): string;
  unixMillis(value: number): string;
}
`;

export function getDefaultParserScript(locale: SupportedLocale) {
  return locale === "zh-CN"
    ? `/**
 * @param {ParserRuntimeInput} input
 * @param {ParserHelpers} helpers
 */
function parse(input, helpers) {
  const bytes = input.bytes;
  const flags = bytes[0] ?? 0;

  return {
    payloadSize: input.payloadSize,
    online: helpers.bit(flags, 0),
    alarm: helpers.bit(flags, 1),
    rawWord: bytes.length >= 3 ? helpers.readUint16BE(bytes, 1) : null,
    utf8Preview: bytes.length >= 6 ? helpers.readUtf8(bytes, 2, 4) : "",
    rawHex: input.payloadHex,
  };
}`
    : `/**
 * @param {ParserRuntimeInput} input
 * @param {ParserHelpers} helpers
 */
function parse(input, helpers) {
  const bytes = input.bytes;
  const flags = bytes[0] ?? 0;

  return {
    payloadSize: input.payloadSize,
    online: helpers.bit(flags, 0),
    alarm: helpers.bit(flags, 1),
    rawWord: bytes.length >= 3 ? helpers.readUint16BE(bytes, 1) : null,
    utf8Preview: bytes.length >= 6 ? helpers.readUtf8(bytes, 2, 4) : "",
    rawHex: input.payloadHex,
  };
}`;
}
