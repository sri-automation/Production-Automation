"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import type { SensorLog, DeviceSession, DeviceInfo } from "@/lib/types";
import { format } from "date-fns";

const ONLINE_THRESHOLD_MS = 15_000;

export default function HomePage() {
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDevices = useCallback(async () => {
    const supabase = getSupabase();
    const [sessionsRes, logsRes] = await Promise.all([
      supabase
        .from("device_sessions")
        .select("device_id, session_id, start_time, end_time")
        .order("end_time", { ascending: false }),
      supabase
        .from("sensor_logs")
        .select("id, device_id, state, created_at")
        .order("created_at", { ascending: false }),
    ]);

    const sessions: DeviceSession[] = sessionsRes.data ?? [];
    const logs: SensorLog[] = logsRes.data ?? [];

    const deviceMap = new Map<string, DeviceInfo>();

    for (const s of sessions) {
      if (!deviceMap.has(s.device_id)) {
        const timeSinceUpdate =
          Date.now() - new Date(s.end_time).getTime();
        deviceMap.set(s.device_id, {
          device_id: s.device_id,
          is_online: timeSinceUpdate < ONLINE_THRESHOLD_MS,
          last_seen: s.end_time,
          current_state: null,
          last_state_change: null,
        });
      }
    }

    for (const l of logs) {
      const existing = deviceMap.get(l.device_id);
      if (existing && existing.current_state === null) {
        existing.current_state = l.state;
        existing.last_state_change = l.created_at;
      }
      if (!deviceMap.has(l.device_id)) {
        deviceMap.set(l.device_id, {
          device_id: l.device_id,
          is_online: false,
          last_seen: null,
          current_state: l.state,
          last_state_change: l.created_at,
        });
      }
    }

    const sorted = Array.from(deviceMap.values()).sort((a, b) =>
      a.device_id.localeCompare(b.device_id)
    );

    setDevices(sorted);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 10_000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  const onlineCount = devices.filter((d) => d.is_online).length;
  const offlineCount = devices.filter((d) => !d.is_online).length;

  return (
    <div className="page-container">
      <h1 className="page-title">Device Overview</h1>
      <p className="page-subtitle">
        All registered ESP32 devices and their current status
      </p>

      <div className="summary-row">
        <div className="summary-card">
          <div className="label">Total Devices</div>
          <div className="value">{devices.length}</div>
        </div>
        <div className="summary-card">
          <div className="label">Online</div>
          <div className="value" style={{ color: "var(--success)" }}>
            {onlineCount}
          </div>
        </div>
        <div className="summary-card">
          <div className="label">Offline</div>
          <div className="value" style={{ color: "var(--danger)" }}>
            {offlineCount}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Device Registry</h2>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
            Auto-refreshes every 10s
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          {loading ? (
            <div className="loading-state">
              <span className="loading-spinner" />
              Loading devices...
            </div>
          ) : devices.length === 0 ? (
            <div className="empty-state">
              No devices found. Ensure your ESP32 devices are sending data to
              Supabase.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Device ID</th>
                  <th>Status</th>
                  <th>Last Seen</th>
                  <th>Sensor State</th>
                  <th>Last State Change</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr
                    key={d.device_id}
                    className="clickable"
                    onClick={() =>
                      router.push(
                        `/device/${encodeURIComponent(d.device_id)}`
                      )
                    }
                  >
                    <td>
                      <span className="device-id">{d.device_id}</span>
                    </td>
                    <td>
                      <span
                        className={`status-badge ${d.is_online ? "online" : "offline"}`}
                      >
                        <span className="dot" />
                        {d.is_online ? "Online" : "Offline"}
                      </span>
                    </td>
                    <td>
                      <span className="timestamp">
                        {d.last_seen
                          ? format(
                              new Date(d.last_seen),
                              "dd MMM yyyy, HH:mm:ss"
                            )
                          : "—"}
                      </span>
                    </td>
                    <td>
                      {d.current_state ? (
                        <span
                          className={`state-badge ${d.current_state.toLowerCase()}`}
                        >
                          {d.current_state}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className="timestamp">
                        {d.last_state_change
                          ? format(
                              new Date(d.last_state_change),
                              "dd MMM yyyy, HH:mm:ss"
                            )
                          : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
