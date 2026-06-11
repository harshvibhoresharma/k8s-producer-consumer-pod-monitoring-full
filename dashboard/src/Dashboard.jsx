import { useState, useEffect, useCallback } from "react";

const OBSERVER_URL = "http://localhost:8001";
const PRODUCER_URL = "http://localhost:8000";

const POLL_MS = 2000;

function Badge({ status }) {
  const map = {
    queued:     { bg: "#E6F1FB", color: "#0C447C", label: "queued" },
    processing: { bg: "#FAEEDA", color: "#633806", label: "processing" },
    done:       { bg: "#EAF3DE", color: "#27500A", label: "done" },
    requeued:   { bg: "#FAECE7", color: "#4A1B0C", label: "requeued" },
    alive:      { bg: "#EAF3DE", color: "#27500A", label: "alive" },
    dead:       { bg: "#FCEBEB", color: "#501313", label: "dead" },
    draining:   { bg: "#FAEEDA", color: "#633806", label: "draining" },
  };
  const s = map[status] || map.queued;
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 11, fontWeight: 500, padding: "2px 8px",
      borderRadius: 6, letterSpacing: "0.02em"
    }}>{s.label}</span>
  );
}

function ProgressBar({ percent }) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  const color = p === 100 ? "#639922" : p > 50 ? "#BA7517" : "#378ADD";
  return (
    <div style={{ background: "var(--color-background-secondary)", borderRadius: 4, height: 6, overflow: "hidden" }}>
      <div style={{ width: `${p}%`, height: "100%", background: color, transition: "width 0.4s ease", borderRadius: 4 }} />
    </div>
  );
}

function SummaryCard({ icon, label, value, accent }) {
  return (
    <div style={{
      background: "var(--color-background-secondary)", borderRadius: 8,
      padding: "12px 16px", display: "flex", flexDirection: "column", gap: 4
    }}>
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 500, color: accent || "var(--color-text-primary)" }}>{value}</span>
    </div>
  );
}

function TaskRow({ task }) {
  const p = task.progress || {};
  const elapsed = Number(p.elapsed || 0);
  const total   = Number(p.total || 30);
  const percent = Number(p.percent || 0);
  return (
    <div style={{
      padding: "10px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)",
      display: "grid", gridTemplateColumns: "80px 1fr 110px 80px 80px", gap: 12, alignItems: "center"
    }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-text-secondary)" }}>
        {task.task_id}
      </span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{task.name || "—"}</div>
        {task.status === "processing" && (
          <ProgressBar percent={percent} />
        )}
        {task.status === "processing" && (
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 3 }}>
            {elapsed}s / {total}s — {percent}%
          </div>
        )}
      </div>
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {task.pod ? task.pod.split("-").slice(-1)[0] : "—"}
      </span>
      <Badge status={task.status} />
      <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
        {task.slot || "—"}
      </span>
    </div>
  );
}

function PodCard({ pod }) {
  const tasks = pod.active_task_list || [];
  const slots = Number(pod.active_tasks || 0);
  const free  = Number(pod.slots_free || 0);
  const total = slots + free;

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: 12, padding: "14px 16px", marginBottom: 12
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500 }}>
            {pod.pod_name}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
            {pod.pod_ip} · completed: {pod.total_completed || 0}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            {slots}/{total} slots
          </div>
          <Badge status={pod.status} />
        </div>
      </div>

      {/* slot indicators */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 6, borderRadius: 3,
            background: i < slots ? "#378ADD" : "var(--color-background-secondary)"
          }} />
        ))}
      </div>

      {/* active task details */}
      {tasks.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tasks.map(t => {
            const p   = t.progress || {};
            const pct = Number(p.percent || 0);
            const ela = Number(p.elapsed || 0);
            return (
              <div key={t.task_id} style={{
                background: "var(--color-background-secondary)",
                borderRadius: 8, padding: "8px 12px"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{t.name}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-text-secondary)" }}>
                    {t.task_id} · {t.slot}
                  </span>
                </div>
                <ProgressBar percent={pct} />
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                  <span>{ela}s / 30s</span>
                  <span>{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>no active tasks</div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [summary, setSummary]     = useState({});
  const [pods, setPods]           = useState([]);
  const [tasks, setTasks]         = useState([]);
  const [taskName, setTaskName]   = useState("");
  const [pushing, setPushing]     = useState(false);
  const [error, setError]         = useState("");
  const [tab, setTab]             = useState("pods");   // pods | tasks

  const fetchAll = useCallback(async () => {
    try {
      const [sumRes, podsRes, tasksRes] = await Promise.all([
        fetch(`${OBSERVER_URL}/summary`),
        fetch(`${OBSERVER_URL}/pods`),
        fetch(`${OBSERVER_URL}/tasks`),
      ]);
      const [s, p, t] = await Promise.all([sumRes.json(), podsRes.json(), tasksRes.json()]);
      setSummary(s);
      setPods(p.pods || []);
      setTasks(t.tasks || []);
      setError("");
    } catch (e) {
      setError("Cannot reach observer service — is it running?");
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  async function pushTask() {
    if (!taskName.trim()) return;
    setPushing(true);
    try {
      const res = await fetch(`${PRODUCER_URL}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: taskName.trim(), payload: {} }),
      });
      if (!res.ok) throw new Error();
      setTaskName("");
      setTimeout(fetchAll, 300);
    } catch {
      setError("Failed to push task — is producer running?");
    } finally {
      setPushing(false);
    }
  }

  const activeCount = tasks.filter(t => t.status === "processing").length;
  const doneCount   = tasks.filter(t => t.status === "done").length;
  const queueCount  = tasks.filter(t => t.status === "queued").length;

  return (
    <div style={{ padding: "1.5rem 0", fontFamily: "var(--font-sans)" }}>
      <h2 style={{ sr: "only", position: "absolute", opacity: 0 }}>KEDA producer-consumer dashboard</h2>

      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500 }}>Task dashboard</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            polling every 2s · {new Date().toLocaleTimeString()}
          </div>
        </div>
        {error && (
          <div style={{ fontSize: 12, color: "var(--color-text-danger)", background: "var(--color-background-danger)", padding: "6px 12px", borderRadius: 8 }}>
            {error}
          </div>
        )}
      </div>

      {/* summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: "1.5rem" }}>
        <SummaryCard label="active pods"    value={summary.active_pods || 0}       accent="#378ADD" />
        <SummaryCard label="queue depth"    value={summary.queue_depth || 0}       accent="#BA7517" />
        <SummaryCard label="processing"     value={activeCount}                    accent="#BA7517" />
        <SummaryCard label="completed"      value={doneCount}                      accent="#639922" />
      </div>

      {/* push task bar */}
      <div style={{
        display: "flex", gap: 8, marginBottom: "1.5rem",
        background: "var(--color-background-secondary)", borderRadius: 10, padding: "10px 14px"
      }}>
        <input
          value={taskName}
          onChange={e => setTaskName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && pushTask()}
          placeholder="task name…"
          style={{ flex: 1, fontSize: 14 }}
        />
        <button onClick={pushTask} disabled={pushing || !taskName.trim()} style={{ fontSize: 13, padding: "0 16px" }}>
          {pushing ? "pushing…" : "push task ↗"}
        </button>
        <button onClick={() => {
          for (let i = 1; i <= 6; i++) {
            setTimeout(() => {
              fetch(`${PRODUCER_URL}/tasks`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: `batch-task-${i}`, payload: {} }),
              }).then(() => fetchAll());
            }, i * 100);
          }
        }} style={{ fontSize: 13, padding: "0 12px" }}>
          push 6 ↗
        </button>
      </div>

      {/* tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: "1rem", borderBottom: "0.5px solid var(--color-border-tertiary)", paddingBottom: 0 }}>
        {["pods", "tasks"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            fontSize: 13, padding: "6px 16px", border: "none", background: "none",
            borderBottom: tab === t ? "2px solid var(--color-text-primary)" : "2px solid transparent",
            color: tab === t ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            cursor: "pointer", marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>

      {/* pods view */}
      {tab === "pods" && (
        <div>
          {pods.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-text-secondary)", fontSize: 14 }}>
              no active pods — push tasks to trigger KEDA scale-up
            </div>
          ) : (
            pods.map(pod => <PodCard key={pod.pod_name} pod={pod} />)
          )}
        </div>
      )}

      {/* tasks view */}
      {tab === "tasks" && (
        <div style={{
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: 12, overflow: "hidden"
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "80px 1fr 110px 80px 80px", gap: 12,
            padding: "8px 14px", background: "var(--color-background-secondary)",
            fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 500, letterSpacing: "0.04em"
          }}>
            <span>ID</span><span>TASK</span><span>POD</span><span>STATUS</span><span>SLOT</span>
          </div>
          {tasks.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-secondary)", fontSize: 14 }}>
              no tasks yet
            </div>
          ) : (
            tasks.slice(0, 50).map(t => <TaskRow key={t.task_id} task={t} />)
          )}
        </div>
      )}

      {/* legend */}
      <div style={{ marginTop: "1.5rem", fontSize: 11, color: "var(--color-text-secondary)", display: "flex", gap: 16 }}>
        <span>slot bar = blue (busy) / gray (free)</span>
        <span>max 3 tasks / pod</span>
        <span>KEDA: 1 pod per 3 queued tasks</span>
      </div>
    </div>
  );
}
