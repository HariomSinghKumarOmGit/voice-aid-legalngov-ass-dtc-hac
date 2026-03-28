Let me build this out as a proper complete guide file.Complete guide is ready. Here's what's covered across all 6 phases:

**Phase 1 — Setup** — Homebrew tools, Ollama models, whisper.cpp, Piper with both English + Hindi voices, Python venv, Next.js.

**Phase 2 — RAG Pipeline** — ChromaDB replaces Pinecone entirely. `ingest.py` loads your govt PDFs, chunks them, embeds via `nomic-embed-text` locally, saves to disk. One-time run.

**Phase 3 — Backend** — Full FastAPI with 3 routes: text query, voice pipeline (whisper → RAG → Piper), and a health check. Auto-detects Hindi via Devanagari Unicode range and switches voices accordingly.

**Phase 4 — Frontend** — Same clean UI but with a replay audio button, PWA manifest, and proper error handling.

**Phase 5** — Single `start.sh` script that boots Ollama + backend + frontend in one command.

**Phase 6** — Testing checklist + performance table (everything runs on M4 silently, no fan).

The only thing you need from the internet is the initial model downloads. After that, the whole thing runs air-gapped.



# VoiceAid — Local Build Guide (M4 Air, Zero Cloud, Zero Cost)

> Fully offline. No OpenAI. No Pinecone. No API bills.
> Runs entirely on Apple Silicon via Metal GPU cores.

---

## Stack Overview

| Layer | Tool | Why |
|---|---|---|
| LLM | Phi-3 Mini / Gemma2:2b via Ollama | Metal-accelerated, low RAM |
| Embeddings | nomic-embed-text via Ollama | Fast, local, no API |
| Vector DB | ChromaDB | On-disk, no cloud |
| STT | whisper.cpp | Apple Metal, offline |
| TTS | Piper TTS + Hindi voice | CPU only, no fan spin |
| Backend | FastAPI | Same as original |
| Frontend | Next.js PWA | Same as original |

---

## Project Structure

```
voiceaid/
├── frontend/          # Next.js PWA
├── backend/           # FastAPI
├── ai-engine/         # LangChain + ChromaDB RAG
│   ├── ingest.py
│   └── query_engine.py
├── data/              # Government PDFs
├── models/            # Piper voice models
└── .env
```

---

## PHASE 1 — System Setup (Hour 0–2)

### Step 1: Install Homebrew Tools

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install system dependencies
brew install ollama ffmpeg whisper-cpp cmake
```

### Step 2: Pull Ollama Models

```bash
# Start Ollama daemon (runs in background, auto-sleeps when idle)
ollama serve &

# Pull models — these download once, run forever offline
ollama pull gemma2:2b            # LLM — better Hindi than Phi
ollama pull nomic-embed-text     # Embeddings for RAG

# Optional: better reasoning, heavier
# ollama pull phi3:mini
```

> **M4 Air tip:** `gemma2:2b` uses ~1.8GB RAM and runs at ~30 tok/s on M4. Plenty.

### Step 3: Install whisper.cpp for STT

```bash
# whisper.cpp installed via brew above
# Download the base model (~140MB, good accuracy/speed balance)
whisper-cpp-download-ggml-model base.en

# Test it works
echo "test" | say -o /tmp/test.aiff && \
  ffmpeg -i /tmp/test.aiff /tmp/test.wav -y && \
  whisper-cpp /tmp/test.wav --model base.en
```

### Step 4: Install Piper TTS + Hindi Voice

```bash
# Install Python and Piper
pip3 install piper-tts

# Create models directory
mkdir -p voiceaid/models

# Download English voice
curl -L -o voiceaid/models/en_US-lessac-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx

curl -L -o voiceaid/models/en_US-lessac-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

# Download Hindi voice
curl -L -o voiceaid/models/hi_IN-male-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/male/medium/hi_IN-male-medium.onnx

curl -L -o voiceaid/models/hi_IN-male-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/male/medium/hi_IN-male-medium.onnx.json
```

### Step 5: Backend Python Setup

```bash
cd voiceaid/backend

python3 -m venv venv
source venv/bin/activate

pip install fastapi uvicorn python-multipart python-dotenv
pip install langchain langchain-community langchain-ollama
pip install chromadb pypdf sentence-transformers
pip install piper-tts pydub

# Verify Ollama is accessible
curl http://localhost:11434/api/tags
```

### Step 6: Frontend Setup

```bash
cd voiceaid
npx create-next-app@latest frontend --typescript --tailwind --app
cd frontend
npm install axios
```

### Step 7: Create `.env`

```bash
# voiceaid/backend/.env
cat > .env << EOF
OLLAMA_BASE_URL=http://localhost:11434
LLM_MODEL=gemma2:2b
EMBED_MODEL=nomic-embed-text
CHROMA_DB_PATH=./chroma_db
PIPER_MODELS_PATH=../models
WHISPER_MODEL=base.en
EOF
```

---

## PHASE 2 — AI Engine / RAG Pipeline (Hour 2–8)

### Step 8: Drop Government PDFs

Put these in `voiceaid/data/`:
- PM Kisan Yojana guidelines — [pmkisan.gov.in](https://pmkisan.gov.in)
- MGNREGA scheme PDF — [nrega.nic.in](https://nrega.nic.in)
- RTI Act 2005 — [cic.gov.in](https://cic.gov.in)
- Any 5–10 scheme PDFs from india.gov.in

### Step 9: Ingest Script (Replaces Pinecone with ChromaDB)

Create `voiceaid/ai-engine/ingest.py`:

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
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
OLLAMA_URL  = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

def ingest_pdfs(pdf_folder="./data"):
    all_docs = []

    for file in Path(pdf_folder).glob("*.pdf"):
        try:
            loader = PyPDFLoader(str(file))
            docs = loader.load()
            all_docs.extend(docs)
            print(f"✅ Loaded: {file.name} ({len(docs)} pages)")
        except Exception as e:
            print(f"❌ Failed: {file.name} — {e}")

    if not all_docs:
        print("No PDFs found. Add PDFs to ./data/ first.")
        sys.exit(1)

    # Chunk documents
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50,
        separators=["\n\n", "\n", "। ", ". ", " ", ""]
    )
    chunks = splitter.split_documents(all_docs)
    print(f"\n📦 Total chunks: {len(chunks)}")

    # Embed locally via Ollama (nomic-embed-text)
    print(f"🔄 Embedding with {EMBED_MODEL} via Ollama...")
    embeddings = OllamaEmbeddings(
        model=EMBED_MODEL,
        base_url=OLLAMA_URL
    )

    # Store to disk (ChromaDB)
    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=CHROMA_PATH
    )

    print(f"✅ Stored {len(chunks)} chunks to {CHROMA_PATH}")
    print("🚀 RAG pipeline ready — fully offline!")

if __name__ == "__main__":
    ingest_pdfs("../data")
```

```bash
# Run ingestion (takes 2–5 min depending on PDF size)
cd voiceaid/ai-engine
python ingest.py
```

### Step 10: Query Engine (Replaces OpenAI with Ollama)

Create `voiceaid/ai-engine/query_engine.py`:

```python
import os
from langchain_ollama import OllamaEmbeddings, ChatOllama
from langchain_community.vectorstores import Chroma
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate
from dotenv import load_dotenv

load_dotenv("../backend/.env")

CHROMA_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
LLM_MODEL   = os.getenv("LLM_MODEL", "gemma2:2b")
OLLAMA_URL  = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

PROMPT_TEMPLATE = """
You are VoiceAid, a government rights assistant for Indian citizens.
Answer in simple language anyone can understand.
If the user writes in Hindi or uses Devanagari script, respond in Hindi.
If English, respond in English.
Keep answers short and actionable — 3 to 5 sentences maximum.
Always mention which document or scheme your answer comes from.

Context from government documents:
{context}

User Question: {question}

Answer:
"""

# Load once at module level (no re-init per request)
_qa_chain = None

def _get_chain():
    global _qa_chain
    if _qa_chain is not None:
        return _qa_chain

    embeddings = OllamaEmbeddings(
        model=EMBED_MODEL,
        base_url=OLLAMA_URL
    )
    vectorstore = Chroma(
        persist_directory=CHROMA_PATH,
        embedding_function=embeddings
    )
    llm = ChatOllama(
        model=LLM_MODEL,
        base_url=OLLAMA_URL,
        temperature=0.3
    )
    prompt = PromptTemplate(
        template=PROMPT_TEMPLATE,
        input_variables=["context", "question"]
    )
    _qa_chain = RetrievalQA.from_chain_type(
        llm=llm,
        chain_type="stuff",
        retriever=vectorstore.as_retriever(search_kwargs={"k": 4}),
        chain_type_kwargs={"prompt": prompt}
    )
    return _qa_chain

def get_answer(question: str) -> str:
    chain = _get_chain()
    result = chain.invoke({"query": question})
    return result["result"]
```

---

## PHASE 3 — Backend API (Hour 8–14)

### Step 11: FastAPI Backend (No Cloud APIs)

Create `voiceaid/backend/main.py`:

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
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base.en")

app = FastAPI(title="VoiceAid Local API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def is_hindi(text: str) -> bool:
    """Detect if text is mostly Devanagari."""
    devanagari = sum(1 for c in text if '\u0900' <= c <= '\u097F')
    return devanagari / max(len(text), 1) > 0.2

def transcribe_audio(audio_path: str) -> str:
    """Use whisper.cpp locally via Apple Metal."""
    wav_path = audio_path.replace(".webm", ".wav")

    # Convert to WAV (whisper needs 16kHz mono WAV)
    subprocess.run([
        "ffmpeg", "-i", audio_path,
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        wav_path, "-y", "-loglevel", "quiet"
    ], check=True)

    result = subprocess.run(
        ["whisper-cpp", wav_path, "--model", WHISPER_MODEL,
         "--output-txt", "--no-prints"],
        capture_output=True, text=True
    )

    txt_path = wav_path + ".txt"
    if Path(txt_path).exists():
        text = Path(txt_path).read_text().strip()
        os.unlink(txt_path)
        return text

    # Fallback: parse stdout
    lines = [l.strip() for l in result.stdout.split("\n") if l.strip()]
    return " ".join(lines).strip()

def text_to_speech(text: str, is_hindi_text: bool = False) -> str:
    """Convert text to audio using Piper TTS. Returns path to .wav file."""
    if is_hindi_text:
        model = f"{MODELS_PATH}/hi_IN-male-medium.onnx"
    else:
        model = f"{MODELS_PATH}/en_US-lessac-medium.onnx"

    out_path = f"/tmp/response_{os.urandom(4).hex()}.wav"

    subprocess.run(
        f'echo "{text}" | piper --model {model} --output_file {out_path}',
        shell=True, check=True
    )
    return out_path


# ─── Routes ───────────────────────────────────────────────────────────────────

class TextQuery(BaseModel):
    text: str

@app.get("/health")
def health():
    return {"status": "ok", "message": "VoiceAid Local running"}


# Route 1: Text → Answer (text only)
@app.post("/api/query")
async def query_text(body: TextQuery):
    try:
        answer = get_answer(body.text)
        return {"question": body.text, "answer": answer}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# Route 2: Voice → Transcribe → Answer → Voice (full pipeline)
@app.post("/api/voice-query")
async def voice_query(audio: UploadFile = File(...)):
    try:
        # Save incoming audio
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
            tmp.write(await audio.read())
            tmp_path = tmp.name

        # STT via whisper.cpp (local, Metal-accelerated)
        question = transcribe_audio(tmp_path)
        print(f"🎙️ Transcribed: {question}")

        if not question:
            return JSONResponse(
                status_code=400,
                content={"error": "Could not transcribe audio"}
            )

        # RAG query via local Ollama
        answer = get_answer(question)
        print(f"🤖 Answer: {answer[:100]}...")

        # TTS — detect language and use correct voice
        hindi = is_hindi(question) or is_hindi(answer)
        audio_path = text_to_speech(answer, is_hindi_text=hindi)

        # Return base64 audio + text
        with open(audio_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()

        os.unlink(tmp_path)
        os.unlink(audio_path)

        return {
            "question": question,
            "answer": answer,
            "audio_base64": audio_b64,
            "language": "hi" if hindi else "en"
        }

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# Run with: uvicorn main:app --reload --port 8000
```

```bash
# Start backend
cd voiceaid/backend
source venv/bin/activate
uvicorn main:app --reload --port 8000

# Verify
curl http://localhost:8000/health
curl -X POST http://localhost:8000/api/query \
  -H "Content-Type: application/json" \
  -d '{"text": "What is PM Kisan Yojana?"}'
```

---

## PHASE 4 — Frontend (Hour 14–24)

### Step 12: Voice UI — Next.js

Create `voiceaid/frontend/app/page.tsx`:

```tsx
"use client";
import { useState, useRef, useEffect } from "react";
import axios from "axios";

type Status = "idle" | "recording" | "processing" | "done" | "error";

interface Result {
  question: string;
  answer: string;
  audioBase64?: string;
  language?: string;
}

export default function Home() {
  const [status, setStatus]         = useState<Status>("idle");
  const [result, setResult]         = useState<Result | null>(null);
  const [textInput, setTextInput]   = useState("");
  const [errorMsg, setErrorMsg]     = useState("");
  const mediaRef  = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // ── Voice Recording ──────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await sendVoice(blob);
      };

      recorder.start(100);
      setStatus("recording");
      setResult(null);
      setErrorMsg("");
    } catch {
      setErrorMsg("Microphone access denied.");
      setStatus("error");
    }
  };

  const stopRecording = () => {
    if (mediaRef.current?.state === "recording") {
      mediaRef.current.stop();
      setStatus("processing");
    }
  };

  // ── Send Voice ────────────────────────────────────────────────────
  const sendVoice = async (blob: Blob) => {
    try {
      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");

      const res = await axios.post(
        "http://localhost:8000/api/voice-query",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      setResult({
        question:    res.data.question,
        answer:      res.data.answer,
        audioBase64: res.data.audio_base64,
        language:    res.data.language
      });

      // Auto-play response audio
      if (res.data.audio_base64) {
        const audio = new Audio(`data:audio/wav;base64,${res.data.audio_base64}`);
        audio.play();
      }

      setStatus("done");
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || "Something went wrong.");
      setStatus("error");
    }
  };

  // ── Send Text ─────────────────────────────────────────────────────
  const sendText = async () => {
    if (!textInput.trim()) return;
    setStatus("processing");
    setResult(null);
    setErrorMsg("");

    try {
      const res = await axios.post("http://localhost:8000/api/query", {
        text: textInput,
      });
      setResult({ question: res.data.question, answer: res.data.answer });
      setStatus("done");
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || "Something went wrong.");
      setStatus("error");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") sendText();
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900
                     flex flex-col items-center justify-center p-6 text-white">

      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold tracking-tight mb-2">
          🎙️ VoiceAid
        </h1>
        <p className="text-blue-300 text-lg">
          Government rights assistant — fully offline
        </p>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-green-400 text-sm font-mono">running local</span>
        </div>
      </div>

      {/* Voice Button */}
      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
        onTouchEnd={(e)  => { e.preventDefault(); stopRecording();  }}
        disabled={status === "processing"}
        className={`
          w-36 h-36 rounded-full font-bold text-lg shadow-2xl
          transition-all duration-200 select-none
          ${status === "recording"
            ? "bg-red-500 scale-110 ring-4 ring-red-300 animate-pulse"
            : status === "processing"
            ? "bg-slate-600 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-500 hover:scale-105 active:scale-95"}
        `}
      >
        {status === "recording"   ? "🔴 Release"  :
         status === "processing"  ? "⏳ Wait..."  : "🎤 Hold"}
      </button>

      <p className="mt-3 text-blue-400 text-sm">
        {status === "recording" ? "Listening... release to send"
         : "Hold to speak • Release to send"}
      </p>

      {/* Text Input */}
      <div className="mt-8 w-full max-w-lg flex gap-2">
        <input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ya yahan type karein / Or type here..."
          className="flex-1 p-3 rounded-xl bg-blue-900/50 border border-blue-700
                     placeholder-blue-500 focus:outline-none focus:ring-2
                     focus:ring-blue-500 text-sm"
        />
        <button
          onClick={sendText}
          disabled={status === "processing" || !textInput.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600
                     px-5 rounded-xl font-bold transition-colors"
        >
          Send
        </button>
      </div>

      {/* Status */}
      {status === "processing" && (
        <div className="mt-8 flex items-center gap-3 text-yellow-300">
          <div className="w-4 h-4 border-2 border-yellow-300 border-t-transparent
                          rounded-full animate-spin" />
          <span>Thinking locally...</span>
        </div>
      )}

      {/* Error */}
      {status === "error" && errorMsg && (
        <div className="mt-6 w-full max-w-lg bg-red-900/50 border border-red-700
                        rounded-xl p-4 text-red-300 text-sm">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Result */}
      {result && status === "done" && (
        <div className="mt-8 w-full max-w-lg bg-blue-900/40 rounded-2xl p-6
                        border border-blue-700/50 shadow-xl">
          <p className="text-blue-400 text-xs uppercase tracking-wider mb-1">
            You asked
          </p>
          <p className="font-medium mb-5 text-white">"{result.question}"</p>

          <p className="text-blue-400 text-xs uppercase tracking-wider mb-1">
            VoiceAid says
          </p>
          <p className="text-emerald-300 leading-relaxed text-sm">
            {result.answer}
          </p>

          {/* Replay button if audio exists */}
          {result.audioBase64 && (
            <button
              onClick={() => {
                const audio = new Audio(
                  `data:audio/wav;base64,${result.audioBase64}`
                );
                audio.play();
              }}
              className="mt-4 text-xs text-blue-400 hover:text-blue-300
                         flex items-center gap-1 transition-colors"
            >
              🔊 Replay audio
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <p className="mt-12 text-slate-600 text-xs">
        100% offline · No data leaves your device · Apple M4 Metal
      </p>
    </main>
  );
}
```

### Step 13: Make it a PWA

Add `voiceaid/frontend/public/manifest.json`:

```json
{
  "name": "VoiceAid",
  "short_name": "VoiceAid",
  "description": "Government rights assistant — offline",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#1e3a8a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Update `voiceaid/frontend/app/layout.tsx`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VoiceAid",
  description: "Government rights assistant",
  manifest: "/manifest.json",
  themeColor: "#1e3a8a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

---

## PHASE 5 — Running Everything (Hour 24–26)

### Step 14: Startup Script

Create `voiceaid/start.sh`:

```bash
#!/bin/bash
echo "🚀 Starting VoiceAid (Local Mode)..."

# Start Ollama if not running
if ! pgrep -x "ollama" > /dev/null; then
  echo "Starting Ollama..."
  ollama serve &
  sleep 2
fi

# Start Backend
echo "Starting FastAPI backend..."
cd backend && source venv/bin/activate
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

# Start Frontend
echo "Starting Next.js frontend..."
cd ../frontend
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ VoiceAid running!"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:8000"
echo "   API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop all services."

# Wait and cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; pkill ollama; exit" INT
wait
```

```bash
chmod +x voiceaid/start.sh
./voiceaid/start.sh
```

---

## PHASE 6 — Testing Checklist

```
✅ ollama serve running (check: curl localhost:11434/api/tags)
✅ gemma2:2b and nomic-embed-text pulled
✅ PDFs in ./data/ folder
✅ python ingest.py ran successfully (chroma_db/ folder exists)
✅ /health returns {"status": "ok"}
✅ /api/query returns answer for English question
✅ /api/query returns Hindi answer for Hindi question
✅ /api/voice-query accepts audio and returns audio
✅ Frontend mic button works (Chrome or Safari)
✅ Audio plays back in browser
✅ App loads as PWA on mobile
```

---

## Energy & Performance Reference (M4 Air)

| Operation | Duration | RAM Used | Fan? |
|---|---|---|---|
| Embedding 10 PDFs | ~3–4 min | ~1.5 GB | No |
| Text query (gemma2:2b) | ~3–6 sec | ~2 GB | No |
| Whisper transcription (base) | ~1–2 sec | ~400 MB | No |
| Piper TTS | <0.5 sec | ~200 MB | No |
| Full voice pipeline | ~5–10 sec | ~2.5 GB | No |

> M4 Air has no fan. All of this runs silently on efficiency cores.

---

## Troubleshooting

**Ollama model slow on first query:**
Normal — it loads the model into unified memory. Subsequent queries are fast.

**whisper-cpp not found:**
```bash
brew reinstall whisper-cpp
which whisper-cpp   # should return a path
```

**ChromaDB empty / no results:**
Re-run `python ingest.py`. Make sure PDFs are in `../data/` relative to `ai-engine/`.

**Piper voice model not found:**
Check `PIPER_MODELS_PATH` in `.env` matches where you downloaded the `.onnx` files.

**Hindi not detected:**
The `is_hindi()` function checks Devanagari Unicode range. If the user types in Roman Hindi (Hinglish), it will default to English voice — that is expected.

---

## Upgrade Path (When You're Ready)

| Need | Upgrade |
|---|---|
| Better Hindi quality | Switch LLM to `Sarvam-1` or `Krutrim` API |
| Faster STT | Use `whisper.cpp` `small` model instead of `base` |
| Multi-user / deployed | Add Postgres, auth, swap ChromaDB → Qdrant |
| SMS fallback | Add Twilio back (just the SMS route, nothing else) |
| Better accuracy | Switch to `phi4-mini` or `llama3.2:3b` |

---

*Built for M4 Air · 100% offline · Zero API cost · Apple Metal accelerated*
