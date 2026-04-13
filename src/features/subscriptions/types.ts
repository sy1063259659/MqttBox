export interface SubscriptionDto {
  id: string;
  connectionId: string;
  topicFilter: string;
  qos: 0 | 1 | 2;
  parserId?: string | null;
  enabled: boolean;
  isPreset: boolean;
  note?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SubscriptionInput {
  id?: string;
  connectionId: string;
  topicFilter: string;
  qos: 0 | 1 | 2;
  parserId?: string | null;
  enabled: boolean;
  isPreset: boolean;
  note?: string;
}
