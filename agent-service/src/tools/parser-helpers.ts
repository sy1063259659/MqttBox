export interface ParserHelperReference {
  name: string;
  signature: string;
  description: string;
}

export const PARSER_HELPER_USAGE_NOTE =
  "Parser helpers never assume byte order. Use the explicit BE or LE variant for every multi-byte integer or float field.";

const PARSER_HELPERS: ParserHelperReference[] = [
  { name: "readUint8", signature: "readUint8(bytes, offset)", description: "Read one byte as an unsigned 8-bit integer." },
  { name: "readInt8", signature: "readInt8(bytes, offset)", description: "Read one byte as a signed 8-bit integer." },
  { name: "readUint16BE", signature: "readUint16BE(bytes, offset)", description: "Read 2 bytes as an unsigned 16-bit integer. BE = big-endian." },
  { name: "readUint16LE", signature: "readUint16LE(bytes, offset)", description: "Read 2 bytes as an unsigned 16-bit integer. LE = little-endian." },
  { name: "readInt16BE", signature: "readInt16BE(bytes, offset)", description: "Read 2 bytes as a signed 16-bit integer. BE = big-endian." },
  { name: "readInt16LE", signature: "readInt16LE(bytes, offset)", description: "Read 2 bytes as a signed 16-bit integer. LE = little-endian." },
  { name: "readUint32BE", signature: "readUint32BE(bytes, offset)", description: "Read 4 bytes as an unsigned 32-bit integer. BE = big-endian." },
  { name: "readUint32LE", signature: "readUint32LE(bytes, offset)", description: "Read 4 bytes as an unsigned 32-bit integer. LE = little-endian." },
  { name: "readInt32BE", signature: "readInt32BE(bytes, offset)", description: "Read 4 bytes as a signed 32-bit integer. BE = big-endian." },
  { name: "readInt32LE", signature: "readInt32LE(bytes, offset)", description: "Read 4 bytes as a signed 32-bit integer. LE = little-endian." },
  { name: "readUint64BE", signature: "readUint64BE(bytes, offset)", description: "Read 8 bytes as an unsigned 64-bit integer. Returns a string to avoid precision loss. BE = big-endian." },
  { name: "readUint64LE", signature: "readUint64LE(bytes, offset)", description: "Read 8 bytes as an unsigned 64-bit integer. Returns a string to avoid precision loss. LE = little-endian." },
  { name: "readInt64BE", signature: "readInt64BE(bytes, offset)", description: "Read 8 bytes as a signed 64-bit integer. Returns a string to avoid precision loss. BE = big-endian." },
  { name: "readInt64LE", signature: "readInt64LE(bytes, offset)", description: "Read 8 bytes as a signed 64-bit integer. Returns a string to avoid precision loss. LE = little-endian." },
  { name: "readFloat32BE", signature: "readFloat32BE(bytes, offset)", description: "Read 4 bytes as an IEEE-754 float32. BE = big-endian." },
  { name: "readFloat32LE", signature: "readFloat32LE(bytes, offset)", description: "Read 4 bytes as an IEEE-754 float32. LE = little-endian." },
  { name: "readFloat64BE", signature: "readFloat64BE(bytes, offset)", description: "Read 8 bytes as an IEEE-754 float64. BE = big-endian." },
  { name: "readFloat64LE", signature: "readFloat64LE(bytes, offset)", description: "Read 8 bytes as an IEEE-754 float64. LE = little-endian." },
  { name: "bit", signature: "bit(value, index)", description: "Return true when the bit at index is set." },
  { name: "bits", signature: "bits(value, start, length)", description: "Extract a bit range as an unsigned integer." },
  { name: "sliceBytes", signature: "sliceBytes(bytes, start, length)", description: "Slice a byte range into a new number array." },
  { name: "sliceHex", signature: "sliceHex(bytes, start, length)", description: "Slice a byte range and return it as a lowercase hex string." },
  { name: "hexToBytes", signature: "hexToBytes(hex)", description: "Convert a hex string into number[]. Whitespace is ignored." },
  { name: "bytesToHex", signature: "bytesToHex(bytes)", description: "Convert number[] into a lowercase hex string." },
  { name: "readAscii", signature: "readAscii(bytes, start, length)", description: "Read ASCII text from a byte range." },
  { name: "readUtf8", signature: "readUtf8(bytes, start, length)", description: "Read UTF-8 text from a byte range." },
  { name: "readBcd", signature: "readBcd(bytes, start, length)", description: "Decode packed BCD bytes into a digit string." },
  { name: "startsWithBytes", signature: "startsWithBytes(bytes, prefix, offset = 0)", description: "Check whether a byte array starts with a prefix. Prefix can be number[] or hex." },
  { name: "unixSeconds", signature: "unixSeconds(value)", description: "Convert unix seconds into an ISO-8601 UTC string." },
  { name: "unixMillis", signature: "unixMillis(value)", description: "Convert unix milliseconds into an ISO-8601 UTC string." },
];

export function listParserHelpers(names?: string[]): ParserHelperReference[] {
  if (!names || names.length === 0) {
    return [...PARSER_HELPERS];
  }

  const requested = new Set(names.map((name) => name.trim()).filter(Boolean));
  return PARSER_HELPERS.filter((helper) => requested.has(helper.name));
}
