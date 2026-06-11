from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import asyncio, json, os, socket, signal
from datetime import datetime

import redis as redis_lib
from shared import get_redis, TASK_QUEUE, MAX_TASKS_PER_POD, TASK_DURATION

app = FastAPI(title="Consumer Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

r = get_redis()

POD_NAME = os.getenv("POD_NAME", socket.gethostname())
POD_IP   = os.getenv("POD_IP",   "unknown")

# In-memory slot tracker for this pod
active_slots: dict[str, asyncio.Task] = {}   # slot_id → asyncio task
shutting_down = False


# ── helpers ──────────────────────────────────────────────────────────────────

def pod_key():
    return f"pod:{POD_NAME}"

def now():
    return datetime.utcnow().isoformat()

def refresh_pod_registry():
    """Write / refresh this pod's entry in Redis (TTL 60s, heartbeat keeps it alive)."""
    r.hset(pod_key(), mapping={
        "pod_name":        POD_NAME,
        "pod_ip":          POD_IP,
        "status":          "alive",
        "started_at":      r.hget(pod_key(), "started_at") or now(),
        "active_tasks":    len(active_slots),
        "slots_free":      MAX_TASKS_PER_POD - len(active_slots),
        "total_completed": r.hget(pod_key(), "total_completed") or 0,
        "last_heartbeat":  now(),
    })
    r.expire(pod_key(), 60)
    # also keep a set of all known pod keys for easy listing
    r.sadd("pods:all", pod_key())


async def heartbeat_loop():
    while not shutting_down:
        refresh_pod_registry()
        await asyncio.sleep(10)


# ── task processor ────────────────────────────────────────────────────────────

async def process_task(task: dict, slot_id: str):
    task_id = task["task_id"]
    try:
        # Mark task as processing
        r.hset(f"task:{task_id}", mapping={
            "status":     "processing",
            "pod":        POD_NAME,
            "started_at": now(),
            "slot":       slot_id,
        })

        # Initialise progress
        r.hset(f"progress:{task_id}", mapping={
            "task_id":    task_id,
            "pod":        POD_NAME,
            "elapsed":    0,
            "total":      TASK_DURATION,
            "percent":    0,
            "status":     "processing",
            "updated_at": now(),
        })
        r.expire(f"progress:{task_id}", 300)

        # Simulate 30-second work, ticking every second
        for elapsed in range(1, TASK_DURATION + 1):
            await asyncio.sleep(1)
            percent = int((elapsed / TASK_DURATION) * 100)
            r.hset(f"progress:{task_id}", mapping={
                "elapsed":    elapsed,
                "percent":    percent,
                "status":     "processing",
                "updated_at": now(),
            })
            # publish live tick for SSE subscribers
            r.publish(f"progress-stream:{task_id}", json.dumps({
                "elapsed": elapsed, "percent": percent
            }))

        # Done
        r.hset(f"task:{task_id}", mapping={"status": "done", "finished_at": now()})
        r.hset(f"progress:{task_id}", mapping={"status": "done", "percent": 100})
        r.hincrby(pod_key(), "total_completed", 1)

    except asyncio.CancelledError:
        # Pod is shutting down — requeue the task
        r.lpush(TASK_QUEUE, json.dumps(task))
        r.hset(f"task:{task_id}", "status", "requeued")
    finally:
        active_slots.pop(slot_id, None)
        refresh_pod_registry()


# ── main consumer loop ────────────────────────────────────────────────────────

async def consumer_loop():
    while not shutting_down:
        if len(active_slots) >= MAX_TASKS_PER_POD:
            await asyncio.sleep(0.5)
            continue

        raw = r.brpop(TASK_QUEUE, timeout=2)
        if not raw:
            continue

        task = json.loads(raw[1])
        slot_id = f"slot-{len(active_slots)+1}"
        t = asyncio.create_task(process_task(task, slot_id))
        active_slots[slot_id] = t
        refresh_pod_registry()


# ── startup / shutdown ────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    r.hset(pod_key(), mapping={
        "pod_name":        POD_NAME,
        "pod_ip":          POD_IP,
        "status":          "alive",
        "started_at":      now(),
        "active_tasks":    0,
        "slots_free":      MAX_TASKS_PER_POD,
        "total_completed": 0,
        "last_heartbeat":  now(),
    })
    r.expire(pod_key(), 60)
    r.sadd("pods:all", pod_key())
    asyncio.create_task(heartbeat_loop())
    asyncio.create_task(consumer_loop())

    # subscribe to pod-specific command channel
    asyncio.create_task(command_listener())


@app.on_event("shutdown")
async def shutdown():
    global shutting_down
    shutting_down = True
    # cancel in-flight tasks (they will requeue themselves)
    for t in active_slots.values():
        t.cancel()
    await asyncio.gather(*active_slots.values(), return_exceptions=True)
    r.hset(pod_key(), "status", "dead")
    r.expire(pod_key(), 10)


# ── command listener (pub/sub) ────────────────────────────────────────────────

async def command_listener():
    # run blocking pubsub in a thread executor
    def _listen():
        ps = r.pubsub()
        ps.subscribe(f"cmd:{POD_NAME}", "cmd:broadcast")
        for msg in ps.listen():
            if msg["type"] == "message":
                cmd = json.loads(msg["data"])
                # handle commands: {"action": "status"} etc.
                pass  # extend as needed
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _listen)


# ── endpoints ────────────────────────────────────────────────────────────────

@app.get("/status")
def status():
    return {
        "pod":          POD_NAME,
        "active_tasks": len(active_slots),
        "slots_free":   MAX_TASKS_PER_POD - len(active_slots),
        "slots":        list(active_slots.keys()),
    }

@app.get("/progress/{task_id}/stream")
async def stream_progress(task_id: str):
    """SSE endpoint — streams live ticks for a task."""
    async def generator():
        ps = r.pubsub()
        ps.subscribe(f"progress-stream:{task_id}")
        try:
            for msg in ps.listen():
                if msg["type"] == "message":
                    yield f"data: {msg['data']}\n\n"
                    data = json.loads(msg["data"])
                    if data.get("percent", 0) >= 100:
                        break
        finally:
            ps.unsubscribe()
    return StreamingResponse(generator(), media_type="text/event-stream")

@app.get("/health")
def health():
    return {"status": "ok", "pod": POD_NAME}
