"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import type {
  SensorLog,
  DeviceSession,
  TimeRange,
} from "@/lib/types";
import { TIME_RANGE_OPTIONS, getTimeRangeStart } from "@/lib/types";
import { format } from "date-fns";

interface TimelineSegment {
  startPct: number;
  widthPct: number;
  label: string;
  kind: string;
}

function buildSensorTimeline(
  logs: SensorLog[],
  rangeStart: Date,
  rangeEnd: Date,
  priorState: string | null
): TimelineSegment[] {
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  if (totalMs <= 0) return [];

  const sorted = [...logs].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const segments: TimelineSegment[] = [];
  let cursor = rangeStart.getTime();
  let currentState = priorState ?? "OFF";

  for (const log of sorted) {
    const logTime = new Date(log.created_at).getTime();
    const clampedLogTime = Math.max(logTime, rangeStart.getTime());

    if (clampedLogTime > cursor) {
      const startPct = ((cursor - rangeStart.getTime()) / totalMs) * 100;
      const widthPct =
        ((clampedLogTime - cursor) / totalMs) * 100;
      segments.push({
        startPct,
        widthPct,
        label: currentState,
        kind: currentState.toLowerCase(),
      });
    }
    currentState = log.state;
    cursor = Math.max(clampedLogTime, cursor);
  }

  if (cursor < rangeEnd.getTime()) {
    const startPct = ((cursor - rangeStart.getTime()) / totalMs) * 100;
    const widthPct =
      ((rangeEnd.getTime() - cursor) / totalMs) * 100;
    segments.push({
      startPct,
      widthPct,
      label: currentState,
      kind: currentState.toLowerCase(),
    });
  }

  return segments;
}

function buildSessionTimeline(
  sessions: DeviceSession[],
  rangeStart: Date,
  rangeEnd: Date
): TimelineSegment[] {
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  if (totalMs <= 0) return [];

  const sorted = [...sessions].sort(
    (a, b) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  const segments: TimelineSegment[] = [];

  for (const s of sorted) {
    const sStart = Math.max(
      new Date(s.start_time).getTime(),
      rangeStart.getTime()
    );
    const sEnd = Math.min(
      new Date(s.end_time).getTime(),
      rangeEnd.getTime()
    );
    if (sEnd <= sStart) continue;

    const startPct = ((sStart - rangeStart.getTime()) / totalMs) * 100;
    const widthPct = ((sEnd - sStart) / totalMs) * 100;
    segments.push({
      startPct,
      widthPct,
      label: "Active",
      kind: "active",
    });
  }

  return segments;
}

function getTimeAxisTicks(
  rangeStart: Date,
  rangeEnd: Date,
  range: TimeRange
): { pct: number; label: string }[] {
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  if (totalMs <= 0) return [];

  let intervalMs: number;
  let fmt: string;
  switch (range) {
    case "1h":
      intervalMs = 10 * 60 * 1000;
      fmt = "HH:mm";
      break;
    case "6h":
      intervalMs = 60 * 60 * 1000;
      fmt = "HH:mm";
      break;
    case "12h":
      intervalMs = 2 * 60 * 60 * 1000;
      fmt = "HH:mm";
      break;
    case "24h":
      intervalMs = 4 * 60 * 60 * 1000;
      fmt = "HH:mm";
      break;
    case "3d":
      intervalMs = 12 * 60 * 60 * 1000;
      fmt = "dd MMM HH:mm";
      break;
    case "1w":
      intervalMs = 24 * 60 * 60 * 1000;
      fmt = "dd MMM";
      break;
    case "1m":
      intervalMs = 3 * 24 * 60 * 60 * 1000;
      fmt = "dd MMM";
      break;
  }

  const ticks: { pct: number; label: string }[] = [];
  const firstTick =
    Math.ceil(rangeStart.getTime() / intervalMs) * intervalMs;

  for (let t = firstTick; t <= rangeEnd.getTime(); t += intervalMs) {
    const pct = ((t - rangeStart.getTime()) / totalMs) * 100;
    if (pct >= 0 && pct <= 100) {
      ticks.push({ pct, label: format(new Date(t), fmt) });
    }
  }

  return ticks;
}

function TimelineBar({
  segments,
  ticks,
}: {
  segments: TimelineSegment[];
  ticks: { pct: number; label: string }[];
}) {
  return (
    <div className="timeline-container">
      <div className="timeline-bar">
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`timeline-segment ${seg.kind}`}
            style={{
              left: `${seg.startPct}%`,
              width: `${seg.widthPct}%`,
            }}
            title={seg.label}
          />
        ))}
      </div>
      <div className="timeline-axis">
        {ticks.map((tick, i) => (
          <span
            key={i}
            className="timeline-tick"
            style={{ left: `${tick.pct}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function DeviceDetailPage() {
  const params = useParams();
  const deviceId = decodeURIComponent(params.id as string);

  const [range, setRange] = useState<TimeRange>("24h");
  const [sensorLogs, setSensorLogs] = useState<SensorLog[]>([]);
  const [priorState, setPriorState] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [currentState, setCurrentState] = useState<string | null>(null);

  const rangeEnd = useMemo(() => new Date(), []);
  const rangeStart = useMemo(() => getTimeRangeStart(range), [range]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();
    const isoStart = rangeStart.toISOString();

    const [logsRes, priorRes, sessionsRes, latestSessionRes] =
      await Promise.all([
        supabase
          .from("sensor_logs")
          .select("*")
          .eq("device_id", deviceId)
          .gte("created_at", isoStart)
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

    setLoading(false);
  }, [deviceId, rangeStart]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sensorSegments = useMemo(
    () => buildSensorTimeline(sensorLogs, rangeStart, rangeEnd, priorState),
    [sensorLogs, rangeStart, rangeEnd, priorState]
  );

  const sessionSegments = useMemo(
    () => buildSessionTimeline(sessions, rangeStart, rangeEnd),
    [sessions, rangeStart, rangeEnd]
  );

  const ticks = useMemo(
    () => getTimeAxisTicks(rangeStart, rangeEnd, range),
    [rangeStart, rangeEnd, range]
  );

  return (
    <div className="page-container">
      <div className="breadcrumb">
        <Link href="/">Devices</Link>
        <span className="separator">/</span>
        <span>{deviceId}</span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            <span className="device-id" style={{ fontSize: "18px" }}>
              {deviceId}
            </span>
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginTop: "6px",
            }}
          >
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
        <div className="time-range-selector">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={range === opt.value ? "active" : ""}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
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
              {sensorSegments.length === 0 ? (
                <div className="empty-state">
                  No sensor data available for this time range.
                </div>
              ) : (
                <>
                  <TimelineBar segments={sensorSegments} ticks={ticks} />
                  <div className="timeline-legend">
                    <span>
                      <span
                        className="swatch"
                        style={{ background: "#22c55e" }}
                      />
                      ON
                    </span>
                    <span>
                      <span
                        className="swatch"
                        style={{ background: "#e2e8f0" }}
                      />
                      OFF
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Device Activity Timeline */}
          <div className="panel">
            <div className="panel-header">
              <h2>Device Activity Timeline</h2>
            </div>
            <div className="panel-body">
              {sessionSegments.length === 0 ? (
                <div className="empty-state">
                  No session data available for this time range.
                </div>
              ) : (
                <>
                  <TimelineBar
                    segments={sessionSegments}
                    ticks={ticks}
                  />
                  <div className="timeline-legend">
                    <span>
                      <span
                        className="swatch"
                        style={{ background: "#3b82f6" }}
                      />
                      Active
                    </span>
                    <span>
                      <span
                        className="swatch"
                        style={{ background: "#f1f5f9", border: "1px solid #cbd5e1" }}
                      />
                      Inactive
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sensor Event Log */}
          <div className="panel">
            <div className="panel-header">
              <h2>Sensor Event Log</h2>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                {sensorLogs.length} event{sensorLogs.length !== 1 && "s"}
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              {sensorLogs.length === 0 ? (
                <div className="empty-state">
                  No sensor events in this time range.
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
                {sessions.length} session{sessions.length !== 1 && "s"}
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              {sessions.length === 0 ? (
                <div className="empty-state">
                  No sessions in this time range.
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
                      const durationMs =
                        new Date(s.end_time).getTime() -
                        new Date(s.start_time).getTime();
                      const durationSec = Math.floor(durationMs / 1000);
                      const hours = Math.floor(durationSec / 3600);
                      const mins = Math.floor(
                        (durationSec % 3600) / 60
                      );
                      const secs = durationSec % 60;
                      const durationStr = [
                        hours > 0 ? `${hours}h` : "",
                        mins > 0 ? `${mins}m` : "",
                        `${secs}s`,
                      ]
                        .filter(Boolean)
                        .join(" ");

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
                              {durationStr}
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
