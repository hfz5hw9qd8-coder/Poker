#!/usr/bin/env bash
# Restart all project services (backend + frontend) in a clean way (WSL friendly)
set -u

# Determine project root (assumes script is in scripts/)
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "Project root: $BASE_DIR"
cd "$BASE_DIR" || exit 1

echo "1) Kill any node processes related to project"
pkill -f "$BASE_DIR" || true
pkill -f 'vite' || true
sleep 1

echo "2) Force-kill any remaining node processes that reference project"
for pid in $(ps aux | grep node | grep "$BASE_DIR" | awk '{print $2}' || true); do
  if [ -n "$pid" ]; then
    echo "killing $pid"
    kill -9 "$pid" || true
  fi
done

echo "3) Clean stale pid/log files"
rm -f backend/server.pid frontend_vite.pid backend/server.log frontend.log tools/sim.log users.json || true

echo "4) Start backend (PORT=5000)"
export PORT=5000
nohup node backend/server.js > backend/server.log 2>&1 & echo $! > backend/server.pid
sleep 2
echo "backend PID: $(cat backend/server.pid 2>/dev/null || echo 'none')"

echo "5) Wait for backend to listen on :5000 (3s)"
sleep 3
ss -ltnp | grep 5000 || true

echo "6) Start frontend (Vite)"
cd "$BASE_DIR/frontend" || true
nohup npm run dev -- --host 0.0.0.0 > ../frontend.log 2>&1 & echo $! > ../frontend_vite.pid
cd "$BASE_DIR" || true
sleep 3
echo "frontend PID: $(cat frontend_vite.pid 2>/dev/null || echo 'none')"

echo "7) Seed in-memory user (dev mode)"
curl -s -X POST http://localhost:5000/api/dev/seed-memory -w "\nHTTP:%{http_code}\n" || true

echo "8) Show final status"
echo "Listeners:"; ss -ltnp | grep -E ':3000|:5000' || true
echo "Node processes (project):"; ps aux | grep node | grep "$BASE_DIR" || true
echo "--- backend log (tail 50) ---"; tail -n 50 backend/server.log || true
echo "--- frontend log (tail 50) ---"; tail -n 50 frontend.log || true

echo "Restart sequence finished. If something failed, check backend/server.log and frontend.log"
