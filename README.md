# KEDA Producer-Consumer System

## Architecture

```
Producer (FastAPI)  →  Redis Queue  →  Consumer Pods (KEDA scaled, max 3 tasks each)
                              ↓
                    Consumer pods write progress → Redis
                              ↓
                    Observer (FastAPI)  →  Dashboard (React)
```

## Project Structure

```
keda-system/
├── producer/         FastAPI — push tasks to queue
│   ├── main.py
│   ├── shared.py
│   ├── requirements.txt
│   └── Dockerfile
├── consumer/         FastAPI — pulls tasks, max 3 concurrent, emits progress
│   ├── main.py
│   ├── shared.py
│   ├── requirements.txt
│   └── Dockerfile
├── observer/         FastAPI — reads Redis, exposes data to dashboard
│   ├── main.py
│   ├── shared.py
│   ├── requirements.txt
│   └── Dockerfile
├── dashboard/
│   └── Dashboard.jsx  React dashboard (paste into Claude artifact or Vite project)
└── k8s/
    └── manifests.yaml  All K8s + KEDA resources
```

---

## Local Dev (no K8s)

### 1. Start Redis
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

### 2. Start Producer (terminal 1)
```bash
cd producer
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

### 3. Start Observer (terminal 2)
```bash
cd observer
pip install -r requirements.txt
uvicorn main:app --port 8001 --reload
```

### 4. Start Consumer(s) (terminal 3, 4, 5 — simulate multiple pods)
```bash
cd consumer
POD_NAME=pod-alpha POD_IP=127.0.0.1 uvicorn main:app --port 8010 --reload
# terminal 4:
POD_NAME=pod-beta  POD_IP=127.0.0.1 uvicorn main:app --port 8011 --reload
```

### 5. Dashboard
Paste `Dashboard.jsx` into a Claude artifact or a Vite + React project.
Make sure `OBSERVER_URL=http://localhost:8001` and `PRODUCER_URL=http://localhost:8000`.

---

## Kubernetes + KEDA

### 1. Build images (Minikube)
```bash
eval $(minikube docker-env)

docker build -t producer:latest ./producer
docker build -t consumer:latest ./consumer
docker build -t observer:latest ./observer
```

### 2. Deploy
```bash
kubectl apply -f k8s/manifests.yaml
```

### 3. Access services
```bash
# Producer
kubectl port-forward svc/producer 8000:8000

# Observer (dashboard backend)
kubectl port-forward svc/observer 8001:8001
```

### 4. Watch KEDA scale
```bash
# Push tasks via producer
curl -X POST http://localhost:8000/tasks \
  -H "Content-Type: application/json" \
  -d '{"name": "my-task"}'

# Watch pods appear
kubectl get pods -w

# Watch queue depth
watch -n 1 "kubectl exec deploy/redis -- redis-cli llen task_queue"
```

---

## How It Works

### Scaling logic
- KEDA watches `task_queue` list length
- `listLength: 3` → 1 pod per 3 queued tasks
- Each pod processes max 3 tasks concurrently (slots)
- Pod registers itself in Redis on startup with TTL + heartbeat
- Dead pods auto-expire from registry in 60s

### Progress tracking
- Each task tick (1s) → pod writes to `progress:{task_id}` in Redis
- Pod also publishes to `progress-stream:{task_id}` channel (pub/sub)
- Observer reads Redis directly, dashboard polls every 2s

### Graceful shutdown
- SIGTERM → consumer stops taking new tasks
- In-flight tasks are requeued back to `task_queue`
- Pod marks itself as dead in registry

---

## Key Redis Keys

| Key | Type | Contents |
|-----|------|----------|
| `task_queue` | List | queued task JSON |
| `task:{id}` | Hash | task metadata, status, pod assignment |
| `progress:{id}` | Hash | elapsed, percent, status |
| `pod:{name}` | Hash | pod status, slots, heartbeat |
| `pods:all` | Set | all known pod keys |
| `cmd:{pod}` | Pub/Sub | commands to a specific pod |
| `progress-stream:{id}` | Pub/Sub | live tick stream |
