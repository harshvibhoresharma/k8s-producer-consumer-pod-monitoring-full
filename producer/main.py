from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from shared import get_redis, TASK_QUEUE
import uuid, json
from datetime import datetime

app = FastAPI(title="Producer Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

r = get_redis()

class TaskRequest(BaseModel):
    name: str
    payload: dict = {}

@app.post("/tasks")
def push_task(req: TaskRequest):
    task_id = str(uuid.uuid4())[:8]
    task = {
        "task_id":    task_id,
        "name":       req.name,
        "payload":    json.dumps(req.payload),
        "created_at": datetime.utcnow().isoformat(),
        "status":     "queued"
    }
    r.lpush(TASK_QUEUE, json.dumps(task))
    r.hset(f"task:{task_id}", mapping=task)
    return {"task_id": task_id, "status": "queued", "queue_depth": r.llen(TASK_QUEUE)}

@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    data = r.hgetall(f"task:{task_id}")
    if not data:
        raise HTTPException(status_code=404, detail="Task not found")
    progress = r.hgetall(f"progress:{task_id}")
    return {**data, "progress": progress}

@app.get("/queue/depth")
def queue_depth():
    return {"depth": r.llen(TASK_QUEUE)}

@app.get("/health")
def health():
    return {"status": "ok"}
