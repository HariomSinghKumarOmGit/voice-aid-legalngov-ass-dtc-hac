#!/bin/bash
echo "🚀 Starting VoiceAid (Local Mode)..."

# Ollama
if ! pgrep -x "ollama" > /dev/null; then
  echo "  Starting Ollama..."
  ollama serve &
  sleep 3
fi

# Backend
echo "  Starting FastAPI backend..."
(cd backend && source venv/bin/activate && \
  uvicorn main:app --port 8000 --log-level warning) &
BACKEND_PID=$!
sleep 2

# Frontend
echo "  Starting Next.js frontend..."
(cd frontend && npm run dev -- --port 3000) &
FRONTEND_PID=$!

echo ""
echo "✅ VoiceAid is live!"
echo "   App:      http://localhost:3000"
echo "   API:      http://localhost:8000"
echo "   API docs: http://localhost:8000/docs"
echo ""
echo "Ctrl+C to stop."

trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; pkill ollama; exit 0" INT
wait
