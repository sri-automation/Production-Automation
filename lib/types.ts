export interface SensorLog {
  id: number;
  device_id: string;
  state: string;
  created_at: string;
}

export interface DeviceSession {
  device_id: string;
  session_id: number;
  start_time: string;
  end_time: string;
}

export interface DeviceDetails {
  id: number;
  device_id: string;
  device_name: string | null;
  created_at: string;
  Image: string | null;
}

export interface DeviceInfo {
  device_id: string;
  device_name: string | null;
  image_url: string | null;
  is_online: boolean;
  last_seen: string | null;
  current_state: string | null;
  last_state_change: string | null;
}

export type TimeRange =
  | "1h"
  | "6h"
  | "12h"
  | "24h"
  | "3d"
  | "1w"
  | "1m";

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "1 Hour" },
  { value: "6h", label: "6 Hours" },
  { value: "12h", label: "12 Hours" },
  { value: "24h", label: "24 Hours" },
  { value: "3d", label: "3 Days" },
  { value: "1w", label: "1 Week" },
  { value: "1m", label: "1 Month" },
];

export function getTimeRangeStart(range: TimeRange): Date {
  const now = new Date();
  switch (range) {
    case "1h":
      return new Date(now.getTime() - 60 * 60 * 1000);
    case "6h":
      return new Date(now.getTime() - 6 * 60 * 60 * 1000);
    case "12h":
      return new Date(now.getTime() - 12 * 60 * 60 * 1000);
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "3d":
      return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    case "1w":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "1m":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}
