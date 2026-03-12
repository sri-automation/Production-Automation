"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import type { SensorLog, DeviceSession, DeviceDetails } from "@/lib/types";
import { format } from "date-fns";

/* ── helpers ─────────────────────────────────── */

interface DeviceOption {
  device_id: string;
  device_name: string | null;
}

interface ReportData {
  deviceLabel: string;
  dateLabel: string;
  rangeLabel: string;
  totalDurationMs: number;
  onlineTimeMs: number;
  onTimeMs: number;
  offTimeMs: number;
  cycleCount: number;
  avgCycleTimeMs: number;
  avgOffTimeMs: number;
  offDurations: { startTime: Date; endTime: Date; durationMs: number }[];
}

function fmtDur(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ── line chart component ────────────────────── */

const CHART_PADDING = { top: 20, right: 24, bottom: 50, left: 72 };

function OffDurationLineChart({
  offDurations,
  chartData,
}: {
  offDurations: { startTime: Date; endTime: Date; durationMs: number }[];
  chartData: { maxDur: number; minTime: number; maxTime: number };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.max(rect.width, 300), h: Math.max(rect.height, 250) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { maxDur, minTime, maxTime } = chartData;
  const plotW = size.w - CHART_PADDING.left - CHART_PADDING.right;
  const plotH = size.h - CHART_PADDING.top - CHART_PADDING.bottom;
  const timeSpan = maxTime - minTime || 1;
  const durCeil = maxDur || 1;

  const toX = (t: number) =>
    CHART_PADDING.left + ((t - minTime) / timeSpan) * plotW;
  const toY = (d: number) =>
    CHART_PADDING.top + plotH - (d / durCeil) * plotH;

  const points = offDurations.map((d) => ({
    x: toX((d.startTime.getTime() + d.endTime.getTime()) / 2),
    y: toY(d.durationMs),
    dur: d.durationMs,
    start: d.startTime,
    end: d.endTime,
  }));

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  const area =
    `M ${points[0].x},${CHART_PADDING.top + plotH} ` +
    points.map((p) => `L ${p.x},${p.y}`).join(" ") +
    ` L ${points[points.length - 1].x},${CHART_PADDING.top + plotH} Z`;

  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const val = (durCeil / yTickCount) * i;
    return { val, y: toY(val) };
  });

  const xTickCount = Math.min(offDurations.length, 8);
  const xStep = Math.max(1, Math.floor(offDurations.length / xTickCount));
  const xTicks: { time: number; x: number }[] = [];
  for (let i = 0; i < offDurations.length; i += xStep) {
    const d = offDurations[i];
    const mid = (d.startTime.getTime() + d.endTime.getTime()) / 2;
    xTicks.push({ time: mid, x: toX(mid) });
  }

  return (
    <div ref={containerRef} className="report-line-chart-container">
      <svg
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        className="report-line-chart-svg"
      >
        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <line
            key={`yg-${i}`}
            x1={CHART_PADDING.left}
            y1={t.y}
            x2={CHART_PADDING.left + plotW}
            y2={t.y}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}

        {/* Area fill */}
        <path d={area} fill="rgba(239, 68, 68, 0.08)" />

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="#ef4444"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={5} fill="#ef4444" />
            <circle cx={p.x} cy={p.y} r={3} fill="#ffffff" />
            <title>
              {format(p.start, "HH:mm:ss")} – {format(p.end, "HH:mm:ss")}
              {"\n"}Duration: {fmtDur(p.dur)}
            </title>
          </g>
        ))}

        {/* Y axis */}
        <line
          x1={CHART_PADDING.left}
          y1={CHART_PADDING.top}
          x2={CHART_PADDING.left}
          y2={CHART_PADDING.top + plotH}
          stroke="#94a3b8"
          strokeWidth={1}
        />
        {yTicks.map((t, i) => (
          <text
            key={`yl-${i}`}
            x={CHART_PADDING.left - 8}
            y={t.y + 4}
            textAnchor="end"
            fontSize={11}
            fontFamily="var(--font-geist-mono), monospace"
            fill="#64748b"
          >
            {fmtDur(t.val)}
          </text>
        ))}
        <text
          x={CHART_PADDING.left - 8}
          y={CHART_PADDING.top - 8}
          textAnchor="end"
          fontSize={10}
          fontWeight={600}
          fill="#94a3b8"
          style={{ textTransform: "uppercase" }}
        >
          Duration
        </text>

        {/* X axis */}
        <line
          x1={CHART_PADDING.left}
          y1={CHART_PADDING.top + plotH}
          x2={CHART_PADDING.left + plotW}
          y2={CHART_PADDING.top + plotH}
          stroke="#94a3b8"
          strokeWidth={1}
        />
        {xTicks.map((t, i) => (
          <text
            key={`xl-${i}`}
            x={t.x}
            y={CHART_PADDING.top + plotH + 18}
            textAnchor="middle"
            fontSize={11}
            fontFamily="var(--font-geist-mono), monospace"
            fill="#64748b"
          >
            {format(new Date(t.time), "HH:mm")}
          </text>
        ))}
        <text
          x={CHART_PADDING.left + plotW / 2}
          y={size.h - 4}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fill="#94a3b8"
        >
          Time
        </text>

        {/* Average line */}
        {offDurations.length > 1 && (() => {
          const avg =
            offDurations.reduce((s, d) => s + d.durationMs, 0) /
            offDurations.length;
          const avgY = toY(avg);
          return (
            <>
              <line
                x1={CHART_PADDING.left}
                y1={avgY}
                x2={CHART_PADDING.left + plotW}
                y2={avgY}
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              <text
                x={CHART_PADDING.left + plotW + 4}
                y={avgY + 4}
                fontSize={10}
                fontWeight={600}
                fill="#f59e0b"
              >
                Avg
              </text>
            </>
          );
        })()}
      </svg>
    </div>
  );
}

/* ── component ───────────────────────────────── */

export default function ReportPage() {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  /* ── load device list ─────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const [detailsRes, logsRes] = await Promise.all([
          supabase.from("device_details").select("device_id, device_name"),
          supabase
            .from("sensor_logs")
            .select("device_id")
            .order("created_at", { ascending: false })
            .limit(500),
        ]);

        const map = new Map<string, string | null>();
        for (const d of (detailsRes.data ?? []) as DeviceDetails[]) {
          if (d.device_id) map.set(d.device_id, d.device_name);
        }
        for (const l of (logsRes.data ?? []) as { device_id: string }[]) {
          if (!map.has(l.device_id)) map.set(l.device_id, null);
        }

        const opts = Array.from(map.entries())
          .map(([device_id, device_name]) => ({ device_id, device_name }))
          .sort((a, b) =>
            (a.device_name ?? a.device_id).localeCompare(
              b.device_name ?? b.device_id
            )
          );

        setDevices(opts);
        if (opts.length > 0) setSelectedDevice(opts[0].device_id);
      } catch {
        /* supabase not configured */
      }
    })();
  }, []);

  /* ── generate report ──────────────────────── */
  const generate = useCallback(async () => {
    if (!selectedDevice) return;
    setGenerating(true);
    setReport(null);

    try {
      const supabase = getSupabase();
      const rangeStart = new Date(`${selectedDate}T${startTime}:00`);
      const rangeEnd = new Date(`${selectedDate}T${endTime}:59.999`);
      const rStartMs = rangeStart.getTime();
      const rEndMs = rangeEnd.getTime();
      const totalDurationMs = rEndMs - rStartMs;

      if (totalDurationMs <= 0) {
        setGenerating(false);
        return;
      }

      const [logsRes, priorRes, sessionsRes] = await Promise.all([
        supabase
          .from("sensor_logs")
          .select("*")
          .eq("device_id", selectedDevice)
          .gte("created_at", rangeStart.toISOString())
          .lte("created_at", rangeEnd.toISOString())
          .order("created_at", { ascending: true }),
        supabase
          .from("sensor_logs")
          .select("state")
          .eq("device_id", selectedDevice)
          .lt("created_at", rangeStart.toISOString())
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("device_sessions")
          .select("*")
          .eq("device_id", selectedDevice)
          .gte("end_time", rangeStart.toISOString())
          .lte("start_time", rangeEnd.toISOString())
          .order("start_time", { ascending: true }),
      ]);

      const logs: SensorLog[] = logsRes.data ?? [];
      const sessions: DeviceSession[] = sessionsRes.data ?? [];
      const priorState: string =
        priorRes.data && priorRes.data.length > 0
          ? priorRes.data[0].state
          : "OFF";

      /* Build online windows (sessions clamped to range) */
      const onlineWindows: { start: number; end: number }[] = [];
      for (const s of sessions) {
        const wStart = Math.max(new Date(s.start_time).getTime(), rStartMs);
        const wEnd = Math.min(new Date(s.end_time).getTime(), rEndMs);
        if (wEnd > wStart) onlineWindows.push({ start: wStart, end: wEnd });
      }

      const onlineTimeMs = onlineWindows.reduce(
        (sum, w) => sum + (w.end - w.start),
        0
      );

      /* Build raw sensor state segments across the full range */
      type RawSeg = { start: number; end: number; state: string };
      const rawSegs: RawSeg[] = [];
      let cursor = rStartMs;
      let state = priorState;

      for (const log of logs) {
        const t = Math.max(new Date(log.created_at).getTime(), rStartMs);
        if (t > cursor) {
          rawSegs.push({ start: cursor, end: t, state });
        }
        state = log.state;
        cursor = Math.max(t, cursor);
      }
      if (cursor < rEndMs) {
        rawSegs.push({ start: cursor, end: rEndMs, state });
      }

      /* Intersect sensor segments with online windows */
      function intersect(
        seg: RawSeg,
        windows: { start: number; end: number }[]
      ): RawSeg[] {
        const result: RawSeg[] = [];
        for (const w of windows) {
          const iStart = Math.max(seg.start, w.start);
          const iEnd = Math.min(seg.end, w.end);
          if (iEnd > iStart) {
            result.push({ start: iStart, end: iEnd, state: seg.state });
          }
        }
        return result;
      }

      let onTimeMs = 0;
      let offTimeMs = 0;
      let cycleCount = 0;
      const onDurations: number[] = [];
      const offDurations: {
        startTime: Date;
        endTime: Date;
        durationMs: number;
      }[] = [];

      for (const seg of rawSegs) {
        const onlineParts = intersect(seg, onlineWindows);
        for (const part of onlineParts) {
          const duration = part.end - part.start;
          if (part.state.toUpperCase() === "ON") {
            onTimeMs += duration;
            onDurations.push(duration);
          } else {
            offTimeMs += duration;
            offDurations.push({
              startTime: new Date(part.start),
              endTime: new Date(part.end),
              durationMs: duration,
            });
          }
        }
      }

      /* Count cycles (OFF→ON transitions while online) */
      const onlineSegs: RawSeg[] = [];
      for (const seg of rawSegs) {
        onlineSegs.push(...intersect(seg, onlineWindows));
      }
      onlineSegs.sort((a, b) => a.start - b.start);
      for (let i = 1; i < onlineSegs.length; i++) {
        if (
          onlineSegs[i - 1].state.toUpperCase() === "OFF" &&
          onlineSegs[i].state.toUpperCase() === "ON"
        ) {
          cycleCount++;
        }
      }

      const avgCycleTimeMs =
        onDurations.length > 0
          ? onDurations.reduce((a, b) => a + b, 0) / onDurations.length
          : 0;
      const avgOffTimeMs =
        offDurations.length > 0
          ? offDurations.reduce((a, b) => a + b.durationMs, 0) /
            offDurations.length
          : 0;

      const dev = devices.find((d) => d.device_id === selectedDevice);

      setReport({
        deviceLabel: dev?.device_name ?? selectedDevice,
        dateLabel: format(rangeStart, "dd MMM yyyy"),
        rangeLabel: `${startTime} – ${endTime}`,
        totalDurationMs,
        onlineTimeMs,
        onTimeMs,
        offTimeMs,
        cycleCount,
        avgCycleTimeMs,
        avgOffTimeMs,
        offDurations,
      });
    } catch (err) {
      console.error("Report generation failed:", err);
    }
    setGenerating(false);
  }, [selectedDevice, selectedDate, startTime, endTime, devices]);

  /* ── PDF download ─────────────────────────── */
  const downloadPdf = useCallback(async () => {
    const el = reportRef.current;
    if (!el) return;

    const html2canvas = (await import("html2canvas")).default;
    const { jsPDF } = await import("jspdf");

    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });

    const imgData = canvas.toDataURL("image/png");
    const imgW = canvas.width;
    const imgH = canvas.height;

    const pdfW = 210;
    const margin = 10;
    const contentW = pdfW - margin * 2;
    const contentH = (imgH * contentW) / imgW;

    const pdf = new jsPDF({
      orientation: contentH > 280 ? "portrait" : "portrait",
      unit: "mm",
      format: "a4",
    });

    pdf.addImage(imgData, "PNG", margin, margin, contentW, contentH);
    pdf.save(
      `report_${report?.deviceLabel}_${selectedDate}.pdf`
    );
  }, [report, selectedDate]);

  /* ── chart data ───────────────────────────── */
  const chartData = useMemo(() => {
    if (!report || report.offDurations.length === 0) return null;
    const maxDur = Math.max(...report.offDurations.map((d) => d.durationMs));
    const allTimes = report.offDurations.flatMap((d) => [
      d.startTime.getTime(),
      d.endTime.getTime(),
    ]);
    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(...allTimes);
    return { maxDur, minTime, maxTime };
  }, [report]);

  const activeTotal = report ? report.onTimeMs + report.offTimeMs : 0;
  const onPct =
    report && activeTotal > 0
      ? Math.max((report.onTimeMs / activeTotal) * 100, 0.5)
      : 0;
  const offPct = report && activeTotal > 0 ? 100 - onPct : 0;

  const todayStr = toDateStr(new Date());

  return (
    <div className="page-container">
      <div className="breadcrumb">
        <Link href="/">Devices</Link>
        <span className="separator">/</span>
        <span>Generate Report</span>
      </div>

      <h1 className="page-title">Generate Report</h1>
      <p className="page-subtitle">
        Analyze sensor activity for a specific device and time range
      </p>

      {/* ── Form ──────────────────────────────── */}
      <div className="panel">
        <div className="panel-header">
          <h2>Report Parameters</h2>
        </div>
        <div className="panel-body">
          <div className="report-form">
            <div className="report-field">
              <label className="report-label">Device</label>
              <select
                className="report-select"
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
              >
                {devices.length === 0 && (
                  <option value="">Loading devices…</option>
                )}
                {devices.map((d) => (
                  <option key={d.device_id} value={d.device_id}>
                    {d.device_name ?? d.device_id}
                  </option>
                ))}
              </select>
            </div>
            <div className="report-field">
              <label className="report-label">Date</label>
              <input
                type="date"
                className="report-input"
                value={selectedDate}
                max={todayStr}
                onChange={(e) => {
                  if (e.target.value) setSelectedDate(e.target.value);
                }}
              />
            </div>
            <div className="report-field">
              <label className="report-label">Start Time</label>
              <input
                type="time"
                className="report-input"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="report-field">
              <label className="report-label">End Time</label>
              <input
                type="time"
                className="report-input"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
            <div className="report-field report-field-action">
              <button
                className="report-generate-btn"
                onClick={generate}
                disabled={generating || !selectedDevice}
              >
                {generating ? (
                  <>
                    <span className="loading-spinner" />
                    Generating…
                  </>
                ) : (
                  "Generate Report"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Results ───────────────────────────── */}
      {report && (
        <>
          <div className="report-actions">
            <button className="report-download-btn" onClick={downloadPdf}>
              &#128196; Download PDF
            </button>
          </div>

          <div ref={reportRef} className="report-result">
            {/* Report header */}
            <div className="report-header">
              <div className="report-header-title">
                <h2>Production Report</h2>
                <span className="report-header-sub">
                  {report.deviceLabel}
                </span>
              </div>
              <div className="report-header-meta">
                <div>
                  <span className="report-meta-label">Date</span>
                  <span className="report-meta-value">
                    {report.dateLabel}
                  </span>
                </div>
                <div>
                  <span className="report-meta-label">Time Range</span>
                  <span className="report-meta-value">
                    {report.rangeLabel}
                  </span>
                </div>
                <div>
                  <span className="report-meta-label">Duration</span>
                  <span className="report-meta-value">
                    {fmtDur(report.totalDurationMs)}
                  </span>
                </div>
                <div>
                  <span className="report-meta-label">Online Time</span>
                  <span className="report-meta-value">
                    {fmtDur(report.onlineTimeMs)}
                  </span>
                </div>
              </div>
            </div>

            {/* ON/OFF time bar */}
            <div className="report-section">
              <h3 className="report-section-title">
                Sensor ON / OFF Distribution (while online)
              </h3>
              <div className="report-bar-chart">
                <div
                  className="report-bar-on"
                  style={{ width: `${onPct}%` }}
                >
                  {onPct > 8 && (
                    <span>ON {onPct.toFixed(1)}%</span>
                  )}
                </div>
                <div
                  className="report-bar-off"
                  style={{ width: `${offPct}%` }}
                >
                  {offPct > 8 && (
                    <span>OFF {offPct.toFixed(1)}%</span>
                  )}
                </div>
              </div>
              <div className="report-bar-legend">
                <span>
                  <span
                    className="swatch"
                    style={{ background: "#22c55e" }}
                  />
                  ON — {fmtDur(report.onTimeMs)}
                </span>
                <span>
                  <span
                    className="swatch"
                    style={{ background: "#ef4444" }}
                  />
                  OFF — {fmtDur(report.offTimeMs)}
                </span>
              </div>
            </div>

            {/* Metric cards */}
            <div className="report-metrics">
              <div className="report-metric-card">
                <div className="report-metric-icon on-icon">&#9650;</div>
                <div className="report-metric-label">Total ON Time</div>
                <div className="report-metric-value">
                  {fmtDur(report.onTimeMs)}
                </div>
              </div>
              <div className="report-metric-card">
                <div className="report-metric-icon off-icon">&#9660;</div>
                <div className="report-metric-label">Total OFF Time</div>
                <div className="report-metric-value">
                  {fmtDur(report.offTimeMs)}
                </div>
              </div>
              <div className="report-metric-card">
                <div className="report-metric-icon cycle-icon">&#8634;</div>
                <div className="report-metric-label">Cycle Count</div>
                <div className="report-metric-value">
                  {report.cycleCount}
                </div>
              </div>
              <div className="report-metric-card">
                <div className="report-metric-icon avg-on-icon">&#8986;</div>
                <div className="report-metric-label">Avg Cycle Time</div>
                <div className="report-metric-value">
                  {fmtDur(report.avgCycleTimeMs)}
                </div>
              </div>
              <div className="report-metric-card">
                <div className="report-metric-icon avg-off-icon">&#9202;</div>
                <div className="report-metric-label">Avg OFF Time</div>
                <div className="report-metric-value">
                  {fmtDur(report.avgOffTimeMs)}
                </div>
              </div>
            </div>

            {/* Off-time durations line chart */}
            <div className="report-section report-chart-section">
              <h3 className="report-section-title">
                OFF Duration Over Time
              </h3>
              {report.offDurations.length === 0 || !chartData ? (
                <div className="empty-state">
                  No OFF periods in the selected range.
                </div>
              ) : (
                <OffDurationLineChart
                  offDurations={report.offDurations}
                  chartData={chartData}
                />
              )}
            </div>

            {/* Footer */}
            <div className="report-footer">
              Generated on {format(new Date(), "dd MMM yyyy, HH:mm:ss")}
              {" · "}Production Monitoring System
            </div>
          </div>
        </>
      )}
    </div>
  );
}
