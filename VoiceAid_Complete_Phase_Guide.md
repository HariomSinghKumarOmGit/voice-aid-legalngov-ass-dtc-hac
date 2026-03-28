# VoiceAid — Complete Phase Guide + Git Auto-Commit
# voice-aid-legalngov-ass-dtc-hac

---

## 🗂️ Your Repo Structure (Target)

```
voice-aid-legalngov-ass-dtc-hac/
├── git-test/                    ← your auto-commit script lives here
│   └── index.js
├── backend-fastapi.md           ← skill reference
├── frontend-nextjs.md           ← skill reference
├── ollama-llm.md                ← skill reference
├── rag-chromadb.md              ← skill reference
├── SKILL.md                     ← skill router
├── stt-whisper.md               ← skill reference
├── tts-piper.md                 ← skill reference
├── VoiceAid_Local_Build_Guide.md
├── voiceaid-skill.zip
├── README.md                    ← auto-updated every 5 min
└── voiceaid/                    ← actual app (built in phases below)
    ├── frontend/
    ├── backend/
    ├── ai-engine/
    ├── data/
    ├── models/
    └── start.sh
```

---

## ⚙️ PHASE 0 — Git Auto-Commit Setup (Do This First)

This runs before anything else. Every 5 minutes it auto-commits
progress to your README so your contribution graph stays active
and your build log is tracked.

### Step 1: Create `git-test/index.js`

```js
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");   // repo root
const README = path.join(ROOT, "README.md");

function getBuildStatus() {
  // Read current phase from a status file you update manually
  let status = "Phase 0 — Setup";
  const statusFile = path.join(ROOT, ".build-status");
  if (fs.existsSync(statusFile)) {
    status = fs.readFileSync(statusFile, "utf8").trim();
  }
  return status;
}

function updateReadme() {
  const now = new Date().toISOString();
  const status = getBuildStatus();

  const content = `# VoiceAid — Local AI Government Assistant

> Fully offline voice + RAG pipeline for Indian government schemes.
> Running on Apple M4 Air. Zero cloud APIs.

## 🔄 Live Build Status

| Field | Value |
|---|---|
| Last Updated | ${now} |
| Current Phase | ${status} |
| Stack | Ollama + ChromaDB + whisper.cpp + Piper TTS |
| Model | gemma2:2b (local) |
| Target | M4 Air, zero cost, offline |

## Stack

- **LLM** — gemma2:2b via Ollama (Metal accelerated)
- **Embeddings** — nomic-embed-text (local)
- **Vector DB** — ChromaDB (on-disk)
- **STT** — whisper.cpp (Apple Metal)
- **TTS** — Piper TTS (Hindi + English)
- **Backend** — FastAPI
- **Frontend** — Next.js PWA

## Phases

- [x] Phase 0 — Git auto-commit
- [ ] Phase 1 — System setup (Ollama, whisper, Piper)
- [ ] Phase 2 — RAG pipeline (PDF ingestion + ChromaDB)
- [ ] Phase 3 — FastAPI backend (3 routes)
- [ ] Phase 4 — Next.js frontend (voice UI + PWA)
- [ ] Phase 5 — Integration test
- [ ] Phase 6 — Demo prep

---
*Auto-updated every 5 minutes by git-test/index.js*
`;

  fs.writeFileSync(README, content);
}

function runScript() {
  try {
    updateReadme();

    execSync("git add README.md", { cwd: ROOT });

    const message = `build: auto update ${new Date().toISOString()}`;
    execSync(`git commit -m "${message}"`, { cwd: ROOT });
    execSync("git push", { cwd: ROOT });

    console.log(`✅ Pushed at ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    // No changes to commit — skip silently
    if (err.message.includes("nothing to commit")) {
      console.log(`⏭️  No changes at ${new Date().toLocaleTimeString()}`);
    } else {
      console.error("❌ Error:", err.message);
    }
  }
}

// Run immediately, then every 5 minutes
runScript();
setInterval(runScript, 300000);
```

### Step 2: Create `.build-status` file in repo root

```bash
echo "Phase 0 — Git Auto-Commit" > .build-status
```

Update this file as you complete each phase — the README updates automatically.

### Step 3: Start the auto-committer

```bash
cd git-test
node index.js
```

> Leave this running in a separate terminal tab the entire build.
> Every 5 min your GitHub graph gets a commit.

### Step 4: Update status as you progress

```bash
# When you finish Phase 1:
echo "Phase 1 — System Setup ✅" > .build-status

# When you finish Phase 2:
echo "Phase 2 — RAG Pipeline ✅" > .build-status
```

---

## 🛠️ PHASE 1 — System Setup (Hour 0–2)

**Prompt to use with Claude + SKILL.md:**
> "I'm starting Phase 1 of VoiceAid. Help me install Ollama, pull gemma2:2b
> and nomic-embed-text, install whisper.cpp base model, and download Piper
> Hindi + English voice models. I'm on M4 Air macOS."

### Commands

```bash
# 1. Homebrew tools
brew install ollama ffmpeg whisper-cpp cmake

# 2. Start Ollama
ollama serve &

# 3. Pull models
ollama pull gemma2:2b
ollama pull nomic-embed-text

# 4. Download whisper base (multilingual — needed for Hindi)
whisper-cpp-download-ggml-model base

# 5. Create project + models dir
mkdir -p voice-aid-legalngov-ass-dtc-hac/voiceaid/models
cd voice-aid-legalngov-ass-dtc-hac/voiceaid

# 6. Download Piper voices
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main

curl -L -o models/en_US-lessac-medium.onnx \
  $BASE/en/en_US/lessac/medium/en_US-lessac-medium.onnx
curl -L -o models/en_US-lessac-medium.onnx.json \
  $BASE/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

curl -L -o models/hi_IN-male-medium.onnx \
  $BASE/hi/hi_IN/male/medium/hi_IN-male-medium.onnx
curl -L -o models/hi_IN-male-medium.onnx.json \
  $BASE/hi/hi_IN/male/medium/hi_IN-male-medium.onnx.json

# 7. Backend Python setup
mkdir backend && cd backend
python3 -m venv venv && source venv/bin/activate
pip install fastapi uvicorn python-multipart python-dotenv
pip install langchain langchain-community langchain-ollama
pip install chromadb pypdf piper-tts pydub
cd ..

# 8. Frontend setup
npx create-next-app@latest frontend --typescript --tailwind --app
cd frontend && npm install axios && cd ..

# 9. Create .env
cat > backend/.env << 'EOF'
OLLAMA_BASE_URL=http://localhost:11434
LLM_MODEL=gemma2:2b
EMBED_MODEL=nomic-embed-text
CHROMA_DB_PATH=./chroma_db
PIPER_MODELS_PATH=../models
WHISPER_MODEL=base
EOF
```

### Verify Phase 1

```bash
curl http://localhost:11434/api/tags       # Ollama running?
ollama list                                # gemma2:2b listed?
whisper-cpp --help | grep -i metal        # Metal enabled?
ls models/                                # 4 .onnx files?
```

### ✅ Update status

```bash
echo "Phase 1 — System Setup ✅" > .build-status
```

---

## 🧠 PHASE 2 — RAG Pipeline (Hour 2–8)

**Prompt to use with Claude + SKILL.md:**
> "I'm on Phase 2 of VoiceAid. I need to build ai-engine/ingest.py using
> ChromaDB + nomic-embed-text via Ollama. Then build query_engine.py with
> gemma2:2b, RetrievalQA, and a prompt that switches Hindi/English.
> Refer to rag-chromadb.md and ollama-llm.md."

### Step 1: Get government PDFs

```bash
mkdir -p data
# Download from:
# pmkisan.gov.in       → PM Kisan
# nrega.nic.in         → MGNREGA
# cic.gov.in           → RTI Act
# india.gov.in         → Any 5 more scheme PDFs
# Put all .pdf files in voiceaid/data/
```

### Step 2: Create `ai-engine/ingest.py`

```python
import os, sys
from pathlib import Path
from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_ollama import OllamaEmbeddings
from langchain_community.vectorstores import Chroma
from dotenv import load_dotenv

load_dotenv("../backend/.env")

CHROMA_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
EMBED_MODEL  = os.getenv("EMBED_MODEL", "nomic-embed-text")
OLLAMA_URL   = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

def ingest_pdfs(pdf_folder="../data"):
    all_docs = []
    for file in Path(pdf_folder).glob("*.pdf"):
        try:
            loader = PyPDFLoader(str(file))
            docs = loader.load()
            for doc in docs:
                doc.metadata["source_scheme"] = file.stem
            all_docs.extend(docs)
            print(f"✅ Loaded: {file.name} ({len(docs)} pages)")
        except Exception as e:
            print(f"❌ Failed: {file.name} — {e}")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500, chunk_overlap=50,
        separators=["\n\n", "\n", "। ", ". ", " ", ""]
    )
    chunks = splitter.split_documents(all_docs)
    print(f"\n📦 Total chunks: {len(chunks)}")

    embeddings = OllamaEmbeddings(model=EMBED_MODEL, base_url=OLLAMA_URL)
    Chroma.from_documents(chunks, embeddings, persist_directory=CHROMA_PATH)
    print(f"✅ Stored to {CHROMA_PATH}")

if __name__ == "__main__":
    ingest_pdfs()
```

### Step 3: Create `ai-engine/query_engine.py`

```python
import os
from langchain_ollama import OllamaEmbeddings, ChatOllama
from langchain_community.vectorstores import Chroma
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate
from dotenv import load_dotenv

load_dotenv("../backend/.env")

CHROMA_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
EMBED_MODEL  = os.getenv("EMBED_MODEL", "nomic-embed-text")
LLM_MODEL    = os.getenv("LLM_MODEL", "gemma2:2b")
OLLAMA_URL   = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

PROMPT_TEMPLATE = """
You are VoiceAid, a government rights assistant for Indian citizens.
Answer in simple language anyone can understand.
If the user writes in Hindi or Devanagari, respond in Hindi.
If English, respond in English.
Keep answers to 3–5 sentences. Mention which scheme your answer is from.
If info is not in context, say: "Mujhe yeh jaankari nahi hai."

Context:
{context}

Question: {question}

Answer:
"""

_qa_chain = None

def _get_chain():
    global _qa_chain
    if _qa_chain:
        return _qa_chain
    embeddings = OllamaEmbeddings(model=EMBED_MODEL, base_url=OLLAMA_URL)
    vectorstore = Chroma(persist_directory=CHROMA_PATH, embedding_function=embeddings)
    llm = ChatOllama(model=LLM_MODEL, base_url=OLLAMA_URL, temperature=0.3)
    prompt = PromptTemplate(
        template=PROMPT_TEMPLATE, input_variables=["context", "question"]
    )
    _qa_chain = RetrievalQA.from_chain_type(
        llm=llm,
        chain_type="stuff",
        retriever=vectorstore.as_retriever(search_kwargs={"k": 4}),
        chain_type_kwargs={"prompt": prompt}
    )
    return _qa_chain

def get_answer(question: str) -> str:
    return _get_chain().invoke({"query": question})["result"]
```

### Step 4: Run ingestion

```bash
cd voiceaid/ai-engine
source ../backend/venv/bin/activate
python ingest.py
# Expected: ✅ chunks stored to ./chroma_db
```

### Verify Phase 2

```python
# Quick test
from query_engine import get_answer
print(get_answer("PM Kisan eligibility kya hai?"))
print(get_answer("What is RTI Act?"))
```

### ✅ Update status

```bash
echo "Phase 2 — RAG Pipeline ✅" > .build-status
```

---

## 🔌 PHASE 3 — FastAPI Backend (Hour 8–14)

**Prompt to use with Claude + SKILL.md:**
> "Build the FastAPI backend for VoiceAid Phase 3. I need 3 routes:
> /health, /api/query (text in → answer out), /api/voice-query
> (audio WebM in → transcribe via whisper.cpp → RAG → Piper TTS → WAV base64 out).
> Use is_hindi() for language detection. Refer to backend-fastapi.md."

### Create `backend/main.py`

```python
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import subprocess, tempfile, os, base64, sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
sys.path.append("../ai-engine")
from query_engine import get_answer

MODELS_PATH   = os.getenv("PIPER_MODELS_PATH", "../models")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")

app = FastAPI(title="VoiceAid")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

def is_hindi(text: str) -> bool:
    deva = sum(1 for c in text if '\u0900' <= c <= '\u097F')
    return deva / max(len(text), 1) > 0.2

def transcribe_audio(audio_path: str) -> str:
    wav_path = audio_path.replace(".webm", ".wav").replace(".mp4", ".wav")
    subprocess.run([
        "ffmpeg", "-i", audio_path,
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        wav_path, "-y", "-loglevel", "quiet"
    ], check=True)
    subprocess.run(
        ["whisper-cpp", wav_path, "--model", WHISPER_MODEL,
         "--output-txt", "--no-prints"],
        capture_output=True, text=True
    )
    txt_path = wav_path + ".txt"
    if Path(txt_path).exists():
        text = Path(txt_path).read_text().strip()
        os.unlink(txt_path)
        return text
    return ""

def text_to_speech(text: str, hindi: bool = False) -> str:
    model = f"{MODELS_PATH}/hi_IN-male-medium.onnx" if hindi \
            else f"{MODELS_PATH}/en_US-lessac-medium.onnx"
    out_path = f"/tmp/va_{os.urandom(4).hex()}.wav"
    safe = text.replace('"', '\\"')
    subprocess.run(
        f'echo "{safe}" | piper --model {model} --output_file {out_path}',
        shell=True, check=True
    )
    return out_path

class TextQuery(BaseModel):
    text: str

@app.get("/health")
def health():
    return {"status": "ok", "stack": "local-ollama-chromadb-piper"}

@app.post("/api/query")
async def query_text(body: TextQuery):
    try:
        answer = get_answer(body.text)
        return {"question": body.text, "answer": answer}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/voice-query")
async def voice_query(audio: UploadFile = File(...)):
    try:
        suffix = ".mp4" if "mp4" in (audio.content_type or "") else ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await audio.read())
            tmp_path = tmp.name

        question = transcribe_audio(tmp_path)
        if not question:
            return JSONResponse(status_code=400,
                                content={"error": "Could not transcribe"})

        answer = get_answer(question)
        hindi  = is_hindi(question) or is_hindi(answer)
        wav    = text_to_speech(answer, hindi)

        with open(wav, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()

        os.unlink(tmp_path)
        os.unlink(wav)

        return {
            "question": question,
            "answer":   answer,
            "audio_base64": audio_b64,
            "language": "hi" if hindi else "en"
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
```

### Run + Verify Phase 3

```bash
cd voiceaid/backend
source venv/bin/activate
uvicorn main:app --reload --port 8000

# Test 1: health
curl http://localhost:8000/health

# Test 2: text query
curl -X POST http://localhost:8000/api/query \
  -H "Content-Type: application/json" \
  -d '{"text": "PM Kisan ke liye eligibility kya hai?"}'

# Test 3: API docs
open http://localhost:8000/docs
```

### ✅ Update status

```bash
echo "Phase 3 — FastAPI Backend ✅" > .build-status
```

---

## 🎨 PHASE 4 — Next.js Frontend (Hour 14–24)

**Prompt to use with Claude + SKILL.md:**
> "Build the VoiceAid Next.js frontend Phase 4. Hold-to-speak button,
> text input fallback, audio playback, language badge, replay button.
> Fix the mobile Safari double-fire bug with e.preventDefault().
> Refer to frontend-nextjs.md."

### Create `frontend/app/page.tsx`

(Full code is in `VoiceAid_Local_Build_Guide.md` — Phase 4, Step 12)

### Make it a PWA

```bash
# Create icons (need any 512px PNG as source)
npm install -g sharp-cli
npx sharp -i public/icon.png -o public/icon-192.png resize 192
npx sharp -i public/icon.png -o public/icon-512.png resize 512
```

### Run + Verify Phase 4

```bash
cd voiceaid/frontend
npm run dev
# Open http://localhost:3000
# Test: hold mic button, speak, release — should get audio response
```

### ✅ Update status

```bash
echo "Phase 4 — Next.js Frontend ✅" > .build-status
```

---

## 🚀 PHASE 5 — Integration + One-Command Start (Hour 24–26)

**Prompt to use with Claude + SKILL.md:**
> "Help me create a start.sh for VoiceAid that boots Ollama, FastAPI backend,
> and Next.js frontend in one command with proper cleanup on Ctrl+C."

### Create `voiceaid/start.sh`

```bash
#!/bin/bash
set -e
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
```

```bash
chmod +x voiceaid/start.sh
./voiceaid/start.sh
```

### Full Integration Test Checklist

```
✅ http://localhost:8000/health → {"status": "ok"}
✅ Text query (English) → correct answer
✅ Text query (Hindi) → Hindi answer
✅ Voice query → transcription visible
✅ Voice query → audio plays back
✅ Hindi speech → Piper uses hi_IN voice
✅ Mobile Chrome → mic works
✅ Mobile Safari → audio plays (check mp4 fallback)
✅ PWA install prompt appears on mobile
```

### ✅ Update status

```bash
echo "Phase 5 — Integration ✅ — LIVE" > .build-status
```

---

## 🎤 PHASE 6 — Demo Prep (Hour 26–30)

**Prompt to use with Claude + SKILL.md:**
> "I'm prepping my VoiceAid demo. Give me 3 test Hindi queries about
> PM Kisan, MGNREGA, and RTI that would work well in a live demo.
> Also help me tune the Piper voice speed and the LLM response length."

### Demo Queries to Practice

| Language | Query | What to Show |
|---|---|---|
| Hindi | "Mujhe PM Kisan ka paisa nahi mila, kya karu?" | Auto Hindi voice response |
| English | "What documents do I need for MGNREGA registration?" | Scheme-specific answer |
| Hindi | "RTI file kaise karte hain?" | Step-by-step in Hindi |

### Pitch Structure (3 Minutes)

| Time | What |
|---|---|
| 0:00–0:30 | Problem — "500M Indians don't know their rights" |
| 0:30–1:30 | Live demo — Hindi query → auto response |
| 1:30–2:00 | Tech slide — 100% offline, M4 Air, zero API cost |
| 2:00–2:30 | Impact — NGOs, state govts, no internet areas |
| 2:30–3:00 | Ask — "Pilot with 1 NGO in 30 days" |

### ✅ Final status

```bash
echo "Phase 6 — Demo Ready 🚀" > .build-status
```

---

## 📋 Master Checklist

```
Phase 0  ✅ git auto-commit running (node git-test/index.js)
Phase 1  ✅ Ollama + whisper.cpp + Piper installed
Phase 2  ✅ PDFs ingested → chroma_db has >100 chunks
Phase 3  ✅ /health + /api/query + /api/voice-query working
Phase 4  ✅ Frontend loads, mic works, audio plays
Phase 5  ✅ start.sh boots everything in one command
Phase 6  ✅ 3 demo queries tested, pitch rehearsed
```

---

## 🆘 Quick Debug Commands

```bash
# Is Ollama running?
curl http://localhost:11434/api/tags

# Is backend running?
curl http://localhost:8000/health

# Is ChromaDB populated?
python3 -c "
import chromadb
c = chromadb.PersistentClient('./voiceaid/ai-engine/chroma_db')
print('Chunks:', c.get_collection('langchain').count())
"

# Test TTS directly
echo "Namaste, main VoiceAid hun." | \
  piper --model voiceaid/models/hi_IN-male-medium.onnx \
        --output_file /tmp/test.wav && afplay /tmp/test.wav

# Test STT directly
whisper-cpp /tmp/test.wav --model base
```

---

*voice-aid-legalngov-ass-dtc-hac · M4 Air · 100% offline · Apple Metal*
