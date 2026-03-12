"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import type {
  SensorLog,
  DeviceSession,
  DeviceDetails,
  DeviceInfo,
} from "@/lib/types";
import { format } from "date-fns";

const ONLINE_THRESHOLD_MS = 15_000;

export default function HomePage() {
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDevices = useCallback(async () => {
    const supabase = getSupabase();
    const [sessionsRes, logsRes, detailsRes] = await Promise.all([
      supabase
        .from("device_sessions")
        .select("device_id, session_id, start_time, end_time")
        .order("end_time", { ascending: false }),
      supabase
        .from("sensor_logs")
        .select("id, device_id, state, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("device_details").select("*"),
    ]);

    const sessions: DeviceSession[] = sessionsRes.data ?? [];
    const logs: SensorLog[] = logsRes.data ?? [];
    const details: DeviceDetails[] = detailsRes.data ?? [];

    const detailsMap = new Map<
      string,
      { name: string | null; image: string | null }
    >();
    for (const d of details) {
      if (d.device_id) {
        detailsMap.set(d.device_id, {
          name: d.device_name,
          image: d.Image,
        });
      }
    }

    const deviceMap = new Map<string, DeviceInfo>();

    for (const s of sessions) {
      if (!deviceMap.has(s.device_id)) {
        const timeSinceUpdate =
          Date.now() - new Date(s.end_time).getTime();
        const det = detailsMap.get(s.device_id);
        deviceMap.set(s.device_id, {
          device_id: s.device_id,
          device_name: det?.name ?? null,
          image_url: det?.image ?? null,
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
        const det = detailsMap.get(l.device_id);
        deviceMap.set(l.device_id, {
          device_id: l.device_id,
          device_name: det?.name ?? null,
          image_url: det?.image ?? null,
          is_online: false,
          last_seen: null,
          current_state: l.state,
          last_state_change: l.created_at,
        });
      }
    }

    for (const [did, det] of detailsMap) {
      if (!deviceMap.has(did)) {
        deviceMap.set(did, {
          device_id: did,
          device_name: det.name,
          image_url: det.image,
          is_online: false,
          last_seen: null,
          current_state: null,
          last_state_change: null,
        });
      }
    }

    const sorted = Array.from(deviceMap.values()).sort((a, b) => {
      const nameA = a.device_name ?? a.device_id;
      const nameB = b.device_name ?? b.device_id;
      return nameA.localeCompare(nameB);
    });

    setDevices(sorted);
    setLoading(false);
  }, []);

  const pendingRef = useRef<NodeJS.Timeout>(undefined);
  const debouncedFetch = useCallback(() => {
    clearTimeout(pendingRef.current);
    pendingRef.current = setTimeout(fetchDevices, 2000);
  }, [fetchDevices]);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 30_000);

    let cleanup: (() => void) | undefined;
    try {
      const supabase = getSupabase();
      const channel = supabase
        .channel("home-devices")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "sensor_logs" },
          debouncedFetch
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "device_sessions" },
          debouncedFetch
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "device_details" },
          debouncedFetch
        )
        .subscribe();
      cleanup = () => supabase.removeChannel(channel);
    } catch {
      /* supabase not configured */
    }

    return () => {
      clearInterval(interval);
      clearTimeout(pendingRef.current);
      cleanup?.();
    };
  }, [fetchDevices, debouncedFetch]);

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
            Live &middot; updates in realtime
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
              No devices found. Ensure your ESP32 devices are sending data
              to Supabase.
            </div>
          ) : (
            <>
            {/* Desktop table */}
            <table className="data-table hide-on-mobile">
              <thead>
                <tr>
                  <th>Device</th>
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
                      <div className="device-cell">
                        {d.image_url ? (
                          <img
                            className="device-icon"
                            src={d.image_url}
                            alt={d.device_name ?? d.device_id}
                          />
                        ) : (
                          <span className="device-icon-placeholder" />
                        )}
                        <div>
                          <div className="device-name">
                            {d.device_name ?? d.device_id}
                          </div>
                          {d.device_name && (
                            <div className="device-id-sub">
                              {d.device_id}
                            </div>
                          )}
                        </div>
                      </div>
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
                          : "\u2014"}
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
                        <span style={{ color: "var(--muted)" }}>
                          {"\u2014"}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="timestamp">
                        {d.last_state_change
                          ? format(
                              new Date(d.last_state_change),
                              "dd MMM yyyy, HH:mm:ss"
                            )
                          : "\u2014"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile card list */}
            <div className="device-card-list show-on-mobile">
              {devices.map((d) => (
                <div
                  key={d.device_id}
                  className="device-card"
                  onClick={() =>
                    router.push(
                      `/device/${encodeURIComponent(d.device_id)}`
                    )
                  }
                >
                  <div className="device-card-top">
                    <div className="device-cell">
                      {d.image_url ? (
                        <img
                          className="device-icon"
                          src={d.image_url}
                          alt={d.device_name ?? d.device_id}
                        />
                      ) : (
                        <span className="device-icon-placeholder" />
                      )}
                      <div>
                        <div className="device-name">
                          {d.device_name ?? d.device_id}
                        </div>
                        {d.device_name && (
                          <div className="device-id-sub">
                            {d.device_id}
                          </div>
                        )}
                      </div>
                    </div>
                    <span
                      className={`status-badge ${d.is_online ? "online" : "offline"}`}
                    >
                      <span className="dot" />
                      {d.is_online ? "Online" : "Offline"}
                    </span>
                  </div>
                  <div className="device-card-meta">
                    <div>
                      <span className="device-card-label">Sensor</span>
                      {d.current_state ? (
                        <span
                          className={`state-badge ${d.current_state.toLowerCase()}`}
                        >
                          {d.current_state}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>
                          &mdash;
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="device-card-label">Last Seen</span>
                      <span className="timestamp">
                        {d.last_seen
                          ? format(
                              new Date(d.last_seen),
                              "dd MMM, HH:mm"
                            )
                          : "\u2014"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
