#!/bin/bash
# ──────────────────────────────────────────────────────────
#  FLIR Thermal Analysis — One-Click Startup
#  Usage: ./start.sh
# ──────────────────────────────────────────────────────────

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
    echo -e "${GREEN}Done.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}  FLIR 红外测温分析系统 — 一键启动${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"

# ── Kill stale processes ─────────────────────────────────
echo -e "${YELLOW}[1/4] Cleaning up old processes...${NC}"
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true
sleep 1

# ── Check dependencies ───────────────────────────────────
echo -e "${YELLOW}[2/4] Checking dependencies...${NC}"

if ! command -v python3 &>/dev/null; then
    echo -e "${RED}ERROR: python3 not found${NC}"
    exit 1
fi

if ! command -v node &>/dev/null; then
    echo -e "${RED}ERROR: node not found${NC}"
    exit 1
fi

if ! "$ROOT/backend/venv/bin/python3" -c "import fastapi" 2>/dev/null; then
    echo -e "${RED}ERROR: FastAPI not installed. Run: cd backend && source venv/bin/activate && pip install -r requirements.txt${NC}"
    exit 1
fi

if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo -e "${YELLOW}  Installing frontend dependencies...${NC}"
    cd "$ROOT/frontend" && npm install
fi

# ── Start backend ────────────────────────────────────────
echo -e "${YELLOW}[3/4] Starting backend (port 8000)...${NC}"
cd "$ROOT/backend"
"$ROOT/backend/venv/bin/python3" -m uvicorn main:app --port 8000 &
BACKEND_PID=$!

# ── Start frontend ───────────────────────────────────────
echo -e "${YELLOW}[4/4] Starting frontend (port 5173)...${NC}"
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

# ── Wait for services ────────────────────────────────────
echo -e "\n${CYAN}Waiting for services to be ready...${NC}"

for i in {1..30}; do
    if curl -s http://localhost:8000/api/health &>/dev/null; then
        break
    fi
    sleep 1
done

# ── Open browser ─────────────────────────────────────────
sleep 1
echo -e "\n${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Backend:  http://localhost:8000${NC}"
echo -e "${GREEN}  Frontend: http://localhost:5173${NC}"
echo -e "${GREEN}  API docs: http://localhost:8000/docs${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "  Press ${RED}Ctrl+C${NC} to stop all services\n"

# WSL: use wslview to open browser, fallback to xdg-open
if command -v wslview &>/dev/null; then
    wslview "http://localhost:5173"
elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:5173" 2>/dev/null || true
fi

# ── Keep alive ───────────────────────────────────────────
wait
