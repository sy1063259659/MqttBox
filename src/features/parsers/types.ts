export interface MessageParserDto {
  id: string;
  name: string;
  script: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageParserInput {
  id?: string;
  name: string;
  script: string;
}

export interface MessageParserTestRequest {
  script: string;
  payloadHex: string;
  topic?: string;
}

export interface MessageParserTestResultDto {
  ok: boolean;
  parsedPayloadJson?: string | null;
  parseError?: string | null;
}
