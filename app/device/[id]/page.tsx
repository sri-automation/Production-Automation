"use client";

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import type { SensorLog, DeviceSession, DeviceDetails } from "@/lib/types";
import { format } from "date-fns";
import InteractiveTimeline, {
  type Segment,
} from "@/components/InteractiveTimeline";

/* ── helpers ──────────────────────────────── */

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function fmtDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h > 0 ? `${h}h` : "", m > 0 ? `${m}m` : "", `${s}s`]
    .filter(Boolean)
    .join(" ");
}

function buildSensorSegments(
  logs: SensorLog[],
  rangeStart: Date,
  rangeEnd: Date,
  priorState: string | null
): Segment[] {
  const rStart = rangeStart.getTime();
  const rEnd = rangeEnd.getTime();
  if (rEnd <= rStart) return [];

  const sorted = [...logs].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const segments: Segment[] = [];
  let cursor = rStart;
  let state = priorState ?? "OFF";

  for (const log of sorted) {
    const t = Math.max(new Date(log.created_at).getTime(), rStart);
    if (t > cursor) {
      segments.push({
        startTime: new Date(cursor),
        endTime: new Date(t),
        label: state,
        kind: state.toLowerCase(),
      });
    }
    state = log.state;
    cursor = Math.max(t, cursor);
  }

  if (cursor < rEnd) {
    segments.push({
      startTime: new Date(cursor),
      endTime: new Date(rEnd),
      label: state,
      kind: state.toLowerCase(),
    });
  }
  return segments;
}

function buildSessionSegments(
  sessions: DeviceSession[],
  rangeStart: Date,
  rangeEnd: Date
): Segment[] {
  const rStart = rangeStart.getTime();
  const rEnd = rangeEnd.getTime();
  if (rEnd <= rStart) return [];

  const sorted = [...sessions].sort(
    (a, b) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  const segments: Segment[] = [];
  for (const s of sorted) {
    const sStart = Math.max(new Date(s.start_time).getTime(), rStart);
    const sEnd = Math.min(new Date(s.end_time).getTime(), rEnd);
    if (sEnd <= sStart) continue;
    segments.push({
      startTime: new Date(sStart),
      endTime: new Date(sEnd),
      label: "Active",
      kind: "active",
    });
  }
  return segments;
}

const SENSOR_LEGEND = [
  { color: "#22c55e", label: "ON" },
  { color: "#e2e8f0", label: "OFF" },
];
const SESSION_LEGEND = [
  { color: "#3b82f6", label: "Active" },
  { color: "#f1f5f9", label: "Inactive", borderColor: "#cbd5e1" },
];

/* ── component ────────────────────────────── */

export default function DeviceDetailPage() {
  const params = useParams();
  const deviceId = decodeURIComponent(params.id as string);

  const todayStr = toDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const isToday = selectedDate === todayStr;
  const canGoNext = selectedDate < todayStr;

  const rangeStart = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }, [selectedDate]);

  const rangeEnd = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999);
  }, [selectedDate]);

  useEffect(() => {
    hasLoadedOnce.current = false;
  }, [selectedDate]);

  const [sensorLogs, setSensorLogs] = useState<SensorLog[]>([]);
  const [priorState, setPriorState] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [isOnline, setIsOnline] = useState(false);
  const [currentState, setCurrentState] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceImage, setDeviceImage] = useState<string | null>(null);

  /* ── fetch device details (one-time) ──────── */
  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from("device_details")
          .select("*")
          .eq("device_id", deviceId)
          .limit(1);
        const det: DeviceDetails | undefined = data?.[0];
        if (det) {
          setDeviceName(det.device_name);
          setDeviceImage(det.Image);
        }
      } catch {
        /* supabase not configured */
      }
    })();
  }, [deviceId]);

  /* ── "now" tick every second ─────────────── */
  const [nowTime, setNowTime] = useState(Date.now());
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => setNowTime(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isToday]);

  /* ── data fetching ──────────────────────── */
  const fetchData = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true);
    const supabase = getSupabase();
    const isoStart = rangeStart.toISOString();
    const isoEnd = rangeEnd.toISOString();

    const [logsRes, priorRes, sessionsRes, latestSessionRes] =
      await Promise.all([
        supabase
          .from("sensor_logs")
          .select("*")
          .eq("device_id", deviceId)
          .gte("created_at", isoStart)
          .lte("created_at", isoEnd)
          .order("created_at", { ascending: true }),
        supabase
          .from("sensor_logs")
          .select("state")
          .eq("device_id", deviceId)
          .lt("created_at", isoStart)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("device_sessions")
          .select("*")
          .eq("device_id", deviceId)
          .gte("end_time", isoStart)
          .lte("start_time", isoEnd)
          .order("start_time", { ascending: true }),
        supabase
          .from("device_sessions")
          .select("end_time")
          .eq("device_id", deviceId)
          .order("end_time", { ascending: false })
          .limit(1),
      ]);

    setSensorLogs(logsRes.data ?? []);
    setPriorState(
      priorRes.data && priorRes.data.length > 0
        ? priorRes.data[0].state
        : null
    );
    setSessions(sessionsRes.data ?? []);

    if (latestSessionRes.data && latestSessionRes.data.length > 0) {
      const lastEnd = new Date(
        latestSessionRes.data[0].end_time
      ).getTime();
      setIsOnline(Date.now() - lastEnd < 15_000);
    } else {
      setIsOnline(false);
    }

    const allLogs = logsRes.data ?? [];
    if (allLogs.length > 0) {
      setCurrentState(allLogs[allLogs.length - 1].state);
    } else if (priorRes.data && priorRes.data.length > 0) {
      setCurrentState(priorRes.data[0].state);
    } else {
      setCurrentState(null);
    }

    hasLoadedOnce.current = true;
    setLoading(false);
  }, [deviceId, rangeStart, rangeEnd]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── realtime subscription ──────────────── */
  const pendingRef = useRef<NodeJS.Timeout>(undefined);
  const debouncedFetch = useCallback(() => {
    clearTimeout(pendingRef.current);
    pendingRef.current = setTimeout(fetchData, 2000);
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, 30_000);
    let cleanup: (() => void) | undefined;
    try {
      const supabase = getSupabase();
      const channel = supabase
        .channel(`device-${deviceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "sensor_logs",
            filter: `device_id=eq.${deviceId}`,
          },
          (payload) => {
            if (payload.eventType === "INSERT" && payload.new) {
              const row = payload.new as { state?: string };
              if (row.state) setCurrentState(row.state);
            }
            debouncedFetch();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "device_sessions",
            filter: `device_id=eq.${deviceId}`,
          },
          (payload) => {
            if (payload.new) {
              const row = payload.new as { end_time?: string };
              if (row.end_time) {
                const elapsed = Date.now() - new Date(row.end_time).getTime();
                setIsOnline(elapsed < 15_000);
              }
            }
            debouncedFetch();
          }
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
  }, [deviceId, fetchData, debouncedFetch]);

  /* ── derived data ───────────────────────── */
  const sensorSegments = useMemo(
    () =>
      buildSensorSegments(sensorLogs, rangeStart, rangeEnd, priorState),
    [sensorLogs, rangeStart, rangeEnd, priorState]
  );

  const sessionSegments = useMemo(
    () => buildSessionSegments(sessions, rangeStart, rangeEnd),
    [sessions, rangeStart, rangeEnd]
  );

  /* ── render ─────────────────────────────── */
  return (
    <div className="page-container">
      <div className="breadcrumb">
        <Link href="/">Devices</Link>
        <span className="separator">/</span>
        <span>{deviceName ?? deviceId}</span>
      </div>

      {/* Header row */}
      <div className="device-header-row">
        <div className="device-header-info">
          {deviceImage ? (
            <img
              className="device-icon-lg"
              src={deviceImage}
              alt={deviceName ?? deviceId}
            />
          ) : (
            <span className="device-icon-placeholder-lg" />
          )}
          <div>
            <h1 className="page-title" style={{ marginBottom: 0 }}>
              {deviceName ?? deviceId}
            </h1>
            {deviceName && (
              <span className="device-id-sub">{deviceId}</span>
            )}
            <div className="device-header-badges">
              <span
                className={`status-badge ${isOnline ? "online" : "offline"}`}
              >
                <span className="dot" />
                {isOnline ? "Online" : "Offline"}
              </span>
              {currentState && (
                <span
                  className={`state-badge ${currentState.toLowerCase()}`}
                >
                  Sensor: {currentState}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Date navigator */}
        <div className="date-nav">
          <button
            className="date-nav-btn"
            onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
            title="Previous day"
          >
            &#9664;
          </button>
          <input
            type="date"
            className="date-nav-input"
            value={selectedDate}
            max={todayStr}
            onChange={(e) => {
              if (e.target.value) setSelectedDate(e.target.value);
            }}
          />
          <button
            className="date-nav-btn"
            onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
            disabled={!canGoNext}
            title="Next day"
          >
            &#9654;
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <span className="loading-spinner" />
          Loading device data...
        </div>
      ) : (
        <>
          {/* Sensor State Timeline */}
          <div className="panel">
            <div className="panel-header">
              <h2>Sensor State Timeline</h2>
            </div>
            <div className="panel-body">
              <InteractiveTimeline
                segments={sensorSegments}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                legend={SENSOR_LEGEND}
                emptyMessage="No sensor data available for this date."
                nowTime={isToday ? nowTime : undefined}
              />
            </div>
          </div>

          {/* Device Activity Timeline */}
          <div className="panel">
            <div className="panel-header">
              <h2>Device Activity Timeline</h2>
            </div>
            <div className="panel-body">
              <InteractiveTimeline
                segments={sessionSegments}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                legend={SESSION_LEGEND}
                emptyMessage="No session data available for this date."
                nowTime={isToday ? nowTime : undefined}
              />
            </div>
          </div>

          {/* Sensor Event Log */}
          <div className="panel">
            <div className="panel-header">
              <h2>Sensor Event Log</h2>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                {sensorLogs.length} event
                {sensorLogs.length !== 1 && "s"}
              </span>
            </div>
            <div className="log-scroll-container">
              {sensorLogs.length === 0 ? (
                <div className="empty-state">
                  No sensor events for this date.
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Timestamp</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...sensorLogs].reverse().map((log, idx) => (
                      <tr key={log.id}>
                        <td style={{ color: "var(--muted)" }}>
                          {sensorLogs.length - idx}
                        </td>
                        <td>
                          <span className="timestamp">
                            {format(
                              new Date(log.created_at),
                              "dd MMM yyyy, HH:mm:ss"
                            )}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`state-badge ${log.state.toLowerCase()}`}
                          >
                            {log.state}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Session History */}
          <div className="panel">
            <div className="panel-header">
              <h2>Session History</h2>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                {sessions.length} session
                {sessions.length !== 1 && "s"}
              </span>
            </div>
            <div className="log-scroll-container">
              {sessions.length === 0 ? (
                <div className="empty-state">
                  No sessions for this date.
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Session ID</th>
                      <th>Start Time</th>
                      <th>End Time</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...sessions].reverse().map((s) => {
                      const dur =
                        new Date(s.end_time).getTime() -
                        new Date(s.start_time).getTime();
                      return (
                        <tr key={`${s.device_id}-${s.session_id}`}>
                          <td>
                            <span
                              className="device-id"
                              style={{ color: "var(--foreground)" }}
                            >
                              {s.session_id}
                            </span>
                          </td>
                          <td>
                            <span className="timestamp">
                              {format(
                                new Date(s.start_time),
                                "dd MMM yyyy, HH:mm:ss"
                              )}
                            </span>
                          </td>
                          <td>
                            <span className="timestamp">
                              {format(
                                new Date(s.end_time),
                                "dd MMM yyyy, HH:mm:ss"
                              )}
                            </span>
                          </td>
                          <td>
                            <span className="timestamp">
                              {fmtDuration(dur)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
