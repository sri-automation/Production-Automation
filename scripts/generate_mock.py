"""
Mock data generator for device_sessions and sensor_logs.
Produces CSV files matching the Supabase table schemas.

Adjust the CONFIG section below to control generation behaviour.
"""

import csv
import os
import random
from datetime import datetime, timedelta, timezone

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  CONFIG — tweak these values before running                                ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

DEVICE_ID = "test"
DATE = "2026-03-12"
START_TIME = "10:30:00"
END_TIME = "21:00:00"
TZ_HOURS = 5
TZ_MINUTES = 30

# ON-state timing (seconds) — roughly constant with small jitter
AVG_ON_TIME = 60
ON_TIME_ERROR = 5  # ± jitter around AVG_ON_TIME

# OFF-state timing (seconds) — variable, skewed toward shorter durations
AVG_OFF_TIME = 30
MIN_OFF_TIME = 15
MAX_OFF_TIME = 90

# Session structure
MIN_SESSION_DURATION = 300   # 5 min
MAX_SESSION_DURATION = 5400  # 90 min
MIN_SESSION_GAP = 30         # gap between sessions
MAX_SESSION_GAP = 600        # 10 min

SESSION_ID_START = 5000

# Output paths
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
OUTPUT_SESSIONS = os.path.join(OUTPUT_DIR, "mock_device_sessions.csv")
OUTPUT_SENSORS = os.path.join(OUTPUT_DIR, "mock_sensor_logs.csv")

SEED = 42  # set to None for non-deterministic runs

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Generator internals                                                       ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

TZ = timezone(timedelta(hours=TZ_HOURS, minutes=TZ_MINUTES))
TZ_SUFFIX = f"+{TZ_HOURS:02d}:{TZ_MINUTES:02d}"


def _ts(date_str: str, time_str: str) -> datetime:
    dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M:%S")
    return dt.replace(tzinfo=TZ)


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S.%f") + TZ_SUFFIX


def _rand_on() -> float:
    """ON duration: roughly constant, clipped to ≥ 1 s."""
    return max(1.0, random.gauss(AVG_ON_TIME, ON_TIME_ERROR / 2))


def _rand_off() -> float:
    """OFF duration: beta-distributed in [MIN_OFF, MAX_OFF] with mean ≈ AVG_OFF."""
    span = MAX_OFF_TIME - MIN_OFF_TIME
    ratio = (AVG_OFF_TIME - MIN_OFF_TIME) / span
    alpha = 2.0
    beta = alpha * (1 - ratio) / ratio
    return MIN_OFF_TIME + random.betavariate(alpha, beta) * span


def generate():
    if SEED is not None:
        random.seed(SEED)

    t_start = _ts(DATE, START_TIME)
    t_end = _ts(DATE, END_TIME)

    sessions = []
    sensor_logs = []
    sid = SESSION_ID_START
    cursor = t_start + timedelta(seconds=random.uniform(0, 60))

    while cursor < t_end:
        # ── new session ──────────────────────────────────────────────
        dur = random.uniform(MIN_SESSION_DURATION, MAX_SESSION_DURATION)
        s_end = min(cursor + timedelta(seconds=dur), t_end)

        # sensor cycles inside this session
        session_sensor_logs = []
        t = cursor + timedelta(seconds=random.uniform(0.5, 2.0))

        # initial OFF right after session start
        session_sensor_logs.append({
            "device_id": DEVICE_ID, "state": "OFF", "created_at": t,
        })

        while t < s_end:
            t += timedelta(seconds=_rand_off())
            if t >= s_end:
                break

            session_sensor_logs.append({
                "device_id": DEVICE_ID, "state": "ON", "created_at": t,
            })

            t += timedelta(seconds=_rand_on())
            if t >= s_end:
                break

            session_sensor_logs.append({
                "device_id": DEVICE_ID, "state": "OFF", "created_at": t,
            })

        # shrink session end to just after the last sensor event
        if session_sensor_logs:
            last_event = session_sensor_logs[-1]["created_at"]
            s_end = last_event + timedelta(seconds=random.uniform(1.0, 5.0))

        sessions.append({
            "device_id": DEVICE_ID,
            "session_id": sid,
            "start_time": _fmt(cursor),
            "end_time": _fmt(s_end),
        })

        sensor_logs.extend(
            {**log, "created_at": _fmt(log["created_at"])} for log in session_sensor_logs
        )

        gap = random.uniform(MIN_SESSION_GAP, MAX_SESSION_GAP)
        cursor = s_end + timedelta(seconds=gap)
        sid += random.randint(1, 5)

    # ── write CSVs ───────────────────────────────────────────────────
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(OUTPUT_SESSIONS, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["device_id", "session_id", "start_time", "end_time"])
        w.writeheader()
        w.writerows(sessions)

    with open(OUTPUT_SENSORS, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["device_id", "state", "created_at"])
        w.writeheader()
        w.writerows(sensor_logs)

    # ── summary ──────────────────────────────────────────────────────
    on_events = [l for l in sensor_logs if l["state"] == "ON"]
    off_events = [l for l in sensor_logs if l["state"] == "OFF"]
    print(f"Sessions : {len(sessions):>4}  ->  {OUTPUT_SESSIONS}")
    print(f"Sensor logs: {len(sensor_logs):>4}  ({len(on_events)} ON / {len(off_events)} OFF)  ->  {OUTPUT_SENSORS}")
    print(f"Time range : {_fmt(t_start)}  ->  {_fmt(t_end)}")


if __name__ == "__main__":
    generate()
