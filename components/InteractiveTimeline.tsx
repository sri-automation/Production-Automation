"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { format } from "date-fns";

export interface Segment {
  startTime: Date;
  endTime: Date;
  label: string;
  kind: string;
}

export interface LegendItem {
  color: string;
  label: string;
  borderColor?: string;
}

interface Props {
  segments: Segment[];
  rangeStart: Date;
  rangeEnd: Date;
  legend: LegendItem[];
  emptyMessage?: string;
  nowTime?: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

function getTickConfig(visibleMs: number): {
  intervalMs: number;
  fmt: string;
} {
  if (visibleMs > 14 * 86400_000)
    return { intervalMs: 2 * 86400_000, fmt: "dd MMM" };
  if (visibleMs > 7 * 86400_000)
    return { intervalMs: 86400_000, fmt: "dd MMM" };
  if (visibleMs > 3 * 86400_000)
    return { intervalMs: 12 * 3600_000, fmt: "dd MMM HH:mm" };
  if (visibleMs > 86400_000)
    return { intervalMs: 4 * 3600_000, fmt: "HH:mm" };
  if (visibleMs > 12 * 3600_000)
    return { intervalMs: 2 * 3600_000, fmt: "HH:mm" };
  if (visibleMs > 6 * 3600_000)
    return { intervalMs: 3600_000, fmt: "HH:mm" };
  if (visibleMs > 3600_000)
    return { intervalMs: 600_000, fmt: "HH:mm" };
  if (visibleMs > 1800_000)
    return { intervalMs: 300_000, fmt: "HH:mm:ss" };
  if (visibleMs > 600_000)
    return { intervalMs: 60_000, fmt: "HH:mm:ss" };
  if (visibleMs > 300_000)
    return { intervalMs: 30_000, fmt: "HH:mm:ss" };
  if (visibleMs > 60_000)
    return { intervalMs: 10_000, fmt: "HH:mm:ss" };
  if (visibleMs > 30_000)
    return { intervalMs: 5_000, fmt: "HH:mm:ss" };
  if (visibleMs > 10_000)
    return { intervalMs: 2_000, fmt: "HH:mm:ss" };
  return { intervalMs: 1_000, fmt: "HH:mm:ss" };
}

const MIN_VISIBLE_MS = 5_000;
const ZOOM_FACTOR = 0.75;
const PAN_SPEED = 0.15;

function segMatch(a: Segment | null, b: Segment): boolean {
  if (!a) return false;
  return (
    a.startTime.getTime() === b.startTime.getTime() &&
    a.endTime.getTime() === b.endTime.getTime() &&
    a.kind === b.kind
  );
}

export default function InteractiveTimeline({
  segments,
  rangeStart,
  rangeEnd,
  legend,
  emptyMessage = "No data available for this time range.",
  nowTime,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const scrollTrackRef = useRef<HTMLDivElement>(null);

  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();
  const totalRangeMs = rangeEndMs - rangeStartMs;

  const [visibleStart, setVisibleStart] = useState(rangeStartMs);
  const [visibleEnd, setVisibleEnd] = useState(rangeEndMs);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(
    null
  );

  const dragRef = useRef({
    mode: "none" as "none" | "pan" | "scroll",
    startX: 0,
    anchorStart: 0,
    totalMovement: 0,
  });

  const touchRef = useRef({
    active: false,
    startX: 0,
    anchorStart: 0,
    lastDist: 0,
    lastCenter: 0,
    isPinch: false,
  });

  useEffect(() => {
    setVisibleStart(rangeStartMs);
    setVisibleEnd(rangeEndMs);
    setSelectedSegment(null);
  }, [rangeStartMs, rangeEndMs]);

  const visibleMs = visibleEnd - visibleStart;
  const zoomLevel = totalRangeMs / Math.max(visibleMs, 1);
  const isZoomed = zoomLevel > 1.05;

  const clampRange = useCallback(
    (start: number, end: number): [number, number] => {
      let s = start;
      let e = end;
      const range = e - s;
      if (s < rangeStartMs) {
        s = rangeStartMs;
        e = s + range;
      }
      if (e > rangeEndMs) {
        e = rangeEndMs;
        s = e - range;
      }
      s = Math.max(s, rangeStartMs);
      e = Math.min(e, rangeEndMs);
      return [s, e];
    },
    [rangeStartMs, rangeEndMs]
  );

  const applyZoom = useCallback(
    (anchorPct: number, factor: number) => {
      const anchorTime = visibleStart + anchorPct * visibleMs;
      let newRange = visibleMs * factor;
      newRange = Math.max(MIN_VISIBLE_MS, Math.min(totalRangeMs, newRange));
      const [cs, ce] = clampRange(
        anchorTime - anchorPct * newRange,
        anchorTime + (1 - anchorPct) * newRange
      );
      setVisibleStart(cs);
      setVisibleEnd(ce);
    },
    [visibleStart, visibleMs, totalRangeMs, clampRange]
  );

  const applyPan = useCallback(
    (deltaMs: number) => {
      const newStart = visibleStart + deltaMs;
      const [cs, ce] = clampRange(newStart, newStart + visibleMs);
      setVisibleStart(cs);
      setVisibleEnd(ce);
    },
    [visibleStart, visibleMs, clampRange]
  );

  const visibleSegments = useMemo(() => {
    const vRange = visibleEnd - visibleStart;
    if (vRange <= 0) return [];
    return segments
      .filter(
        (s) =>
          s.endTime.getTime() > visibleStart &&
          s.startTime.getTime() < visibleEnd
      )
      .map((s) => {
        const cStart = Math.max(s.startTime.getTime(), visibleStart);
        const cEnd = Math.min(s.endTime.getTime(), visibleEnd);
        return {
          startPct: ((cStart - visibleStart) / vRange) * 100,
          widthPct: ((cEnd - cStart) / vRange) * 100,
          seg: s,
        };
      });
  }, [segments, visibleStart, visibleEnd]);

  const ticks = useMemo(() => {
    const { intervalMs, fmt } = getTickConfig(visibleMs);
    const vRange = visibleEnd - visibleStart;
    if (vRange <= 0) return [];
    const result: { pct: number; label: string }[] = [];
    const first = Math.ceil(visibleStart / intervalMs) * intervalMs;
    for (let t = first; t <= visibleEnd; t += intervalMs) {
      const pct = ((t - visibleStart) / vRange) * 100;
      if (pct >= 0 && pct <= 100) {
        result.push({ pct, label: format(new Date(t), fmt) });
      }
    }
    return result;
  }, [visibleStart, visibleEnd, visibleMs]);

  const nowPct = useMemo(() => {
    if (!nowTime) return null;
    const vRange = visibleEnd - visibleStart;
    if (vRange <= 0) return null;
    const pct = ((nowTime - visibleStart) / vRange) * 100;
    if (pct < 0 || pct > 100) return null;
    return pct;
  }, [nowTime, visibleStart, visibleEnd]);

  /* ── Wheel: Ctrl+scroll = zoom, normal/Shift+scroll = pan ── */
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const mousePct = Math.max(
          0,
          Math.min(1, (e.clientX - rect.left) / rect.width)
        );
        const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        applyZoom(mousePct, factor);
      } else if (isZoomed) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.shiftKey ? (e.deltaY || e.deltaX) : e.deltaY;
        const panMs = (delta / rect.width) * visibleMs * 3;
        applyPan(panMs);
      }
    },
    [visibleMs, isZoomed, applyZoom, applyPan]
  );

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  /* ── Touch gestures: 1-finger pan, 2-finger pinch zoom ── */
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const center = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        touchRef.current = {
          active: true,
          startX: center,
          anchorStart: visibleStart,
          lastDist: dist,
          lastCenter: center,
          isPinch: true,
        };
        e.preventDefault();
      } else if (e.touches.length === 1) {
        touchRef.current = {
          active: true,
          startX: e.touches[0].clientX,
          anchorStart: visibleStart,
          lastDist: 0,
          lastCenter: e.touches[0].clientX,
          isPinch: false,
        };
      }
    },
    [visibleStart]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchRef.current.active) return;
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;

      if (e.touches.length === 2 && touchRef.current.isPinch) {
        e.preventDefault();
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const center = (e.touches[0].clientX + e.touches[1].clientX) / 2;

        const scale = dist / Math.max(touchRef.current.lastDist, 1);
        const centerPct = Math.max(
          0,
          Math.min(1, (center - rect.left) / rect.width)
        );

        if (Math.abs(scale - 1) > 0.01) {
          applyZoom(centerPct, 1 / scale);
          touchRef.current.lastDist = dist;
          touchRef.current.lastCenter = center;
        }
      } else if (e.touches.length === 1 && !touchRef.current.isPinch) {
        const dx = e.touches[0].clientX - touchRef.current.startX;
        const timeDelta = -(dx / rect.width) * visibleMs;
        const newStart = touchRef.current.anchorStart + timeDelta;
        const [cs, ce] = clampRange(newStart, newStart + visibleMs);
        setVisibleStart(cs);
        setVisibleEnd(ce);
      }
    },
    [visibleMs, applyZoom, clampRange]
  );

  const handleTouchEnd = useCallback(() => {
    touchRef.current.active = false;
    touchRef.current.isPinch = false;
  }, []);

  /* ── Bar mousedown → pan ─────────────────── */
  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      dragRef.current = {
        mode: "pan",
        startX: e.clientX,
        anchorStart: visibleStart,
        totalMovement: 0,
      };
      e.preventDefault();
    },
    [visibleStart]
  );

  /* ── Scrollbar mousedown ─────────────────── */
  const handleScrollMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const track = scrollTrackRef.current;
      if (!track) return;
      const trackRect = track.getBoundingClientRect();
      const clickX = e.clientX - trackRect.left;

      const thumbLeft =
        ((visibleStart - rangeStartMs) / totalRangeMs) * trackRect.width;
      const thumbWidth = (visibleMs / totalRangeMs) * trackRect.width;

      if (clickX >= thumbLeft && clickX <= thumbLeft + thumbWidth) {
        dragRef.current = {
          mode: "scroll",
          startX: e.clientX,
          anchorStart: visibleStart,
          totalMovement: 0,
        };
      } else {
        const clickPct = clickX / trackRect.width;
        const centerTime = rangeStartMs + clickPct * totalRangeMs;
        const [cs, ce] = clampRange(
          centerTime - visibleMs / 2,
          centerTime + visibleMs / 2
        );
        setVisibleStart(cs);
        setVisibleEnd(ce);
      }
    },
    [visibleStart, visibleMs, rangeStartMs, totalRangeMs, clampRange]
  );

  /* ── Global mouse move / up ──────────────── */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current.mode === "none") return;
      const dx = e.clientX - dragRef.current.startX;
      dragRef.current.totalMovement = Math.max(
        dragRef.current.totalMovement,
        Math.abs(dx)
      );

      if (dragRef.current.mode === "pan") {
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect) return;
        const timeDelta = -(dx / rect.width) * visibleMs;
        const newStart = dragRef.current.anchorStart + timeDelta;
        const [cs, ce] = clampRange(newStart, newStart + visibleMs);
        setVisibleStart(cs);
        setVisibleEnd(ce);
      } else if (dragRef.current.mode === "scroll") {
        const track = scrollTrackRef.current;
        if (!track) return;
        const trackRect = track.getBoundingClientRect();
        const timeDelta = (dx / trackRect.width) * totalRangeMs;
        const newStart = dragRef.current.anchorStart + timeDelta;
        const [cs, ce] = clampRange(newStart, newStart + visibleMs);
        setVisibleStart(cs);
        setVisibleEnd(ce);
      }
    };

    const onUp = () => {
      setTimeout(() => {
        dragRef.current.mode = "none";
        dragRef.current.totalMovement = 0;
      }, 0);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [visibleMs, totalRangeMs, clampRange]);

  /* ── Segment click ───────────────────────── */
  const handleSegmentClick = useCallback(
    (e: React.MouseEvent, seg: Segment) => {
      e.stopPropagation();
      if (dragRef.current.totalMovement > 3) return;
      setSelectedSegment((prev) => (segMatch(prev, seg) ? null : seg));
    },
    []
  );

  const handleBarClick = useCallback(() => {
    if (dragRef.current.totalMovement > 3) return;
    setSelectedSegment(null);
  }, []);

  /* ── Zoom buttons ────────────────────────── */
  const zoomIn = useCallback(() => {
    applyZoom(0.5, ZOOM_FACTOR);
  }, [applyZoom]);

  const zoomOut = useCallback(() => {
    applyZoom(0.5, 1 / ZOOM_FACTOR);
  }, [applyZoom]);

  const resetZoom = useCallback(() => {
    setVisibleStart(rangeStartMs);
    setVisibleEnd(rangeEndMs);
  }, [rangeStartMs, rangeEndMs]);

  if (segments.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  const thumbLeftPct =
    ((visibleStart - rangeStartMs) / totalRangeMs) * 100;
  const thumbWidthPct = Math.max(
    (visibleMs / totalRangeMs) * 100,
    2
  );

  const selDuration = selectedSegment
    ? selectedSegment.endTime.getTime() -
      selectedSegment.startTime.getTime()
    : 0;

  return (
    <div className="itl-root">
      {/* Toolbar */}
      <div className="itl-toolbar">
        <div className="itl-btn-group">
          <button
            className="itl-btn"
            onClick={zoomIn}
            disabled={visibleMs <= MIN_VISIBLE_MS}
            title="Zoom in"
          >
            +
          </button>
          <button
            className="itl-btn"
            onClick={zoomOut}
            disabled={visibleMs >= totalRangeMs}
            title="Zoom out"
          >
            &minus;
          </button>
          <button
            className="itl-btn"
            onClick={resetZoom}
            disabled={!isZoomed}
            title="Reset zoom"
          >
            Reset
          </button>
        </div>
        <span className="itl-info">
          {zoomLevel > 1.01 ? `${zoomLevel.toFixed(1)}x` : "1x"}
          {" \u00B7 "}
          {formatDuration(visibleMs)} visible
        </span>
        <span className="itl-hint itl-hint-desktop">
          Ctrl+Scroll to zoom{isZoomed ? " \u00B7 Scroll to pan" : ""}
        </span>
        <span className="itl-hint itl-hint-mobile">
          Pinch to zoom{isZoomed ? " \u00B7 Swipe to pan" : ""}
        </span>
      </div>

      {/* Timeline bar */}
      <div
        className="itl-bar"
        ref={barRef}
        onMouseDown={handleBarMouseDown}
        onClick={handleBarClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {visibleSegments.map((vs, i) => (
          <div
            key={i}
            className={`timeline-segment ${vs.seg.kind}${segMatch(selectedSegment, vs.seg) ? " selected" : ""}`}
            style={{
              left: `${vs.startPct}%`,
              width: `${Math.max(vs.widthPct, 0.15)}%`,
            }}
            onClick={(e) => handleSegmentClick(e, vs.seg)}
          />
        ))}

        {nowPct !== null && (
          <div
            className="itl-now-marker"
            style={{ left: `${nowPct}%` }}
          >
            <span className="itl-now-label">NOW</span>
          </div>
        )}
      </div>

      {/* Scrollbar */}
      {isZoomed && (
        <div
          className="itl-scrollbar"
          ref={scrollTrackRef}
          onMouseDown={handleScrollMouseDown}
        >
          <div
            className="itl-scrollbar-thumb"
            style={{
              left: `${thumbLeftPct}%`,
              width: `${thumbWidthPct}%`,
            }}
          />
        </div>
      )}

      {/* Selected segment detail panel */}
      {selectedSegment && (
        <div className="itl-detail">
          <div className="itl-detail-grid">
            <span className="itl-detail-label">State</span>
            <span className={`state-badge ${selectedSegment.kind}`}>
              {selectedSegment.label}
            </span>
            <span className="itl-detail-label">From</span>
            <span className="timestamp">
              {format(
                selectedSegment.startTime,
                "dd MMM yyyy, HH:mm:ss"
              )}
            </span>
            <span className="itl-detail-label">To</span>
            <span className="timestamp">
              {format(
                selectedSegment.endTime,
                "dd MMM yyyy, HH:mm:ss"
              )}
            </span>
            <span className="itl-detail-label">Duration</span>
            <span className="timestamp" style={{ fontWeight: 600 }}>
              {formatDuration(selDuration)}
            </span>
          </div>
          <button
            className="itl-detail-close"
            onClick={() => setSelectedSegment(null)}
            title="Close"
          >
            &times;
          </button>
        </div>
      )}

      {/* Time axis */}
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

      {/* Legend */}
      <div className="timeline-legend">
        {legend.map((item, i) => (
          <span key={i}>
            <span
              className="swatch"
              style={{
                background: item.color,
                borderColor: item.borderColor,
              }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
