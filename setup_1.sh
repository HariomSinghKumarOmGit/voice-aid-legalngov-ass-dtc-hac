#!/bin/bash
export PATH="/opt/homebrew/bin:$PATH"
set -e

# Start Ollama service using brew
brew services start ollama
sleep 5

echo "Pulling ollama models..."
ollama pull gemma2:2b
ollama pull nomic-embed-text

echo "Downloading whisper base model..."
whisper-cpp-download-ggml-model base

echo "Setting up VoiceAid directories..."
mkdir -p voiceaid/models
cd voiceaid/models

echo "Downloading Piper voice models..."
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main
curl -L -o en_US-lessac-medium.onnx $BASE/en/en_US/lessac/medium/en_US-lessac-medium.onnx
curl -L -o en_US-lessac-medium.onnx.json $BASE/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
curl -L -o hi_IN-male-medium.onnx $BASE/hi/hi_IN/male/medium/hi_IN-male-medium.onnx
curl -L -o hi_IN-male-medium.onnx.json $BASE/hi/hi_IN/male/medium/hi_IN-male-medium.onnx.json

cd ..

echo "Setting up backend Python environment..."
mkdir -p backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn python-multipart python-dotenv langchain langchain-community langchain-ollama chromadb pypdf piper-tts pydub
cd ..

echo "Setting up Next.js frontend..."
npx -y create-next-app@latest frontend --typescript --tailwind --app --src-dir false --eslint --import-alias "@/*" --use-npm --yes
cd frontend
npm install axios
cd ..

echo "Phase 1 — System Setup ✅" > ../.build-status
echo "DONE PHASE 1"
