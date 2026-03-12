Below is a **clear technical specification** you can give to the **frontend developer / agent** so they understand exactly how the ESP32 + Supabase system behaves.
It explains the **device logic, database schema, API behavior, and expected frontend usage**.

---

# ESP32 Sensor Monitoring System

### Technical Context for Frontend Application

This system consists of **multiple ESP32 devices connected to sensors**.
Each device reports **sensor state changes** and **device uptime sessions** to a **Supabase PostgreSQL database via REST API**.

The frontend application will use this data to display:

* Device **current status**
* Device **uptime timeline**
* Sensor **state history**
* Device **online/offline state**

---

# 1. Device Overview

Each ESP32 device has:

| Component         | Purpose              |
| ----------------- | -------------------- |
| Sensor input      | Reports ON/OFF state |
| WiFi              | Connects to network  |
| Supabase REST API | Sends data           |
| OLED display      | Shows status locally |
| LED               | Mirrors sensor state |

Each device has a **unique device_id**.

Example:

```
esp32_001
esp32_002
esp32_003
```

---

# 2. Device Boot Behaviour

When the ESP32 starts:

1. Power on
2. Initialize pins and display
3. Connect to WiFi
4. Generate a **session_id**
5. Create a **new device session** in Supabase
6. Begin monitoring sensor state

Session ID is generated from:

```
session_id = millis()
```

This is unique for that boot cycle.

---

# 3. Continuous Runtime Behaviour

While the ESP32 is running it performs two main tasks.

---

# 3.1 Sensor State Monitoring

The sensor is connected to:

```
GPIO16
```

The device continuously checks the sensor state.

If the state changes:

```
OFF → ON
ON → OFF
```

the device sends a log entry to Supabase.

### API Request

POST

```
/rest/v1/sensor_logs
```

### Payload

```json
{
  "device_id": "esp32_001",
  "state": "ON"
}
```

or

```json
{
  "device_id": "esp32_001",
  "state": "OFF"
}
```

### Behavior

* Only sends when the **state changes**
* Prevents duplicate logs

---

# 3.2 Device Session Heartbeat

The ESP32 updates its active session every **5 seconds**.

Purpose:

* Track device uptime
* Detect if device goes offline
* Build device activity timeline

### Update Frequency

```
Every 5 seconds
```

### API Request

PATCH

```
/rest/v1/device_sessions
```

with filter:

```
device_id=eq.<device_id>
session_id=eq.<session_id>
```

### Payload

```json
{
  "end_time": "now()"
}
```

This extends the session end time.

If the device stops sending updates, the session ends automatically.

---

# 4. Supabase Database Structure

## 4.1 Sensor Logs Table

Table:

```
sensor_logs
```

Schema:

```sql
create table sensor_logs (
  id bigint generated always as identity primary key,
  device_id text not null,
  state text not null,
  created_at timestamptz default now()
);
```

### Purpose

Stores every **sensor state change event**.

Example data:

| id | device_id | state | created_at          |
| -- | --------- | ----- | ------------------- |
| 1  | esp32_001 | ON    | 2026-03-12 10:45:12 |
| 2  | esp32_001 | OFF   | 2026-03-12 11:01:32 |

---

## 4.2 Device Sessions Table

Table:

```
device_sessions
```

Schema:

```sql
create table device_sessions (
  device_id text not null,
  session_id bigint not null,
  start_time timestamptz default now(),
  end_time timestamptz default now(),
  primary key(device_id, session_id)
);
```

### Purpose

Tracks **device uptime sessions**.

Example:

| device_id | session_id | start_time | end_time |
| --------- | ---------- | ---------- | -------- |
| esp32_001 | 421233     | 10:30:00   | 10:45:00 |

If device crashes at **10:45**, last update will stop.

---

# 5. Determining Device Online Status

A device is considered **online** if:

```
now() - end_time < 10 seconds
```

Example query:

```sql
select
device_id,
end_time,
now() - end_time as last_seen
from device_sessions;
```

If last_seen < 10 seconds → device is **ONLINE**

Otherwise → **OFFLINE**

---

# 6. Determining Current Sensor State

Latest state per device:

```sql
select distinct on (device_id)
device_id,
state,
created_at
from sensor_logs
order by device_id, created_at desc;
```

---

# 7. Device Activity Timeline

The frontend can display uptime using:

```
device_sessions.start_time
device_sessions.end_time
```

Example timeline:

```
10:00 ───────────── 10:25  (online)
11:00 ─────── 11:10        (online)
```

---

# 8. Expected Frontend Features

The frontend should display:

### Device Dashboard

For each device:

```
Device ID
Online / Offline
Last Seen Time
Current Sensor State
```

---

### Sensor Event History

Show table:

| Time  | Device    | State |
| ----- | --------- | ----- |
| 10:45 | esp32_001 | ON    |
| 11:01 | esp32_001 | OFF   |

---

### Device Uptime Chart

Use session table:

```
start_time → end_time
```

to generate timeline bars.

---

# 9. Supabase API Usage

Frontend may use:

### Get sensor logs

```
GET /rest/v1/sensor_logs
```

---

### Get device sessions

```
GET /rest/v1/device_sessions
```

---

# 10. Timezone

All timestamps are stored as:

```
timestamptz
```

Database timezone:

```
Asia/Kolkata (IST)
```

---

# 11. Example Data Flow

```
Sensor ON
      ↓
ESP32 detects change
      ↓
POST sensor_logs
      ↓
Database stores event
```

and

```
ESP32 running
      ↓
Every 5 sec
PATCH device_sessions
      ↓
Update end_time
      ↓
System knows device is alive
```

---

# 12. Scaling

System supports **multiple ESP32 devices**.

Each device writes:

```
device_id
session_id
```

No collisions occur because:

```
PRIMARY KEY (device_id, session_id)
```

---

# 13. Typical Data Volume

With heartbeat every 5 sec:

```
720 updates per hour per device
```

But only **one session row per boot**, because only `end_time` updates.

---

# Summary

The system provides:

1. **Sensor event logging**
2. **Device uptime tracking**
3. **Online/offline detection**
4. **Activity timeline**

via two tables:

```
sensor_logs
device_sessions
```

---

If you want, I can also give you a **much better schema that reduces Supabase load by ~95% and makes the frontend queries 10× faster**, which is useful once you scale past **20+ ESP32 devices**.
