from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os, json
from datetime import datetime, timezone

import redis as redis_lib

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
r = redis_lib.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

app = FastAPI(title="Observer Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def enrich_pod(raw: dict) -> dict:
    """Add derived fields to pod data."""
    if not raw:
        return {}
    pod_name = raw.get("pod_name", "")
    # fetch tasks assigned to this pod that are still processing
    active_task_keys = [
        k for k in r.keys("task:*")
        if r.hget(k, "pod") == pod_name and r.hget(k, "status") == "processing"
    ]
    tasks = []
    for tk in active_task_keys:
        task_data = r.hgetall(tk)
        task_id   = task_data.get("task_id", tk.split(":")[1])
        progress  = r.hgetall(f"progress:{task_id}")
        tasks.append({**task_data, "progress": progress})

    return {**raw, "active_task_list": tasks}


@app.get("/pods")
def get_pods():
    pod_keys = r.smembers("pods:all")
    pods = []
    for pk in pod_keys:
        raw = r.hgetall(pk)
        if not raw:
            continue
        # filter out truly dead pods (TTL expired)
        if r.ttl(pk) <= 0:
            continue
        pods.append(enrich_pod(raw))
    return {"pods": pods, "count": len(pods)}


@app.get("/pods/{pod_name}")
def get_pod(pod_name: str):
    raw = r.hgetall(f"pod:{pod_name}")
    if not raw:
        return {"error": "pod not found or expired"}
    return enrich_pod(raw)


@app.get("/tasks")
def get_tasks(status: str = None):
    keys = r.keys("task:*")
    tasks = []
    for k in keys:
        d = r.hgetall(k)
        if not d:
            continue
        if status and d.get("status") != status:
            continue
        task_id  = d.get("task_id", "")
        progress = r.hgetall(f"progress:{task_id}")
        tasks.append({**d, "progress": progress})
    tasks.sort(key=lambda t: t.get("created_at", ""), reverse=True)
    return {"tasks": tasks, "count": len(tasks)}


@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    data     = r.hgetall(f"task:{task_id}")
    progress = r.hgetall(f"progress:{task_id}")
    return {**data, "progress": progress}


@app.get("/summary")
def summary():
    queue_depth  = r.llen("task_queue")
    pod_keys     = [pk for pk in r.smembers("pods:all") if r.ttl(pk) > 0]
    all_task_keys = r.keys("task:*")

    processing = sum(1 for k in all_task_keys if r.hget(k, "status") == "processing")
    done       = sum(1 for k in all_task_keys if r.hget(k, "status") == "done")
    queued     = sum(1 for k in all_task_keys if r.hget(k, "status") == "queued")

    return {
        "queue_depth":   queue_depth,
        "active_pods":   len(pod_keys),
        "tasks_queued":  queued,
        "tasks_processing": processing,
        "tasks_done":    done,
    }


@app.get("/health")
def health():
    return {"status": "ok"}
