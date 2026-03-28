const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const README = path.join(ROOT, "README.md");
const STATUS_FILE = path.join(ROOT, ".build-status");

function getBuildStatus() {
  if (fs.existsSync(STATUS_FILE)) {
    return fs.readFileSync(STATUS_FILE, "utf8").trim();
  }
  return "Phase 0 — Setup";
}

function updateReadme() {
  const now = new Date().toISOString();
  const status = getBuildStatus();

  const isDone = (phase) =>
    status.includes(phase) && status.includes("✅") ? "✅" : "⬜";

  const content = `# VoiceAid — Local AI Government Assistant

> Fully offline voice + RAG pipeline for Indian government schemes.
> Running on Apple M4 Air. Zero cloud APIs. Zero cost.

## 🔄 Live Build Status

| Field | Value |
|---|---|
| Last Updated | \`${now}\` |
| Current Phase | **${status}** |
| Stack | Ollama + ChromaDB + whisper.cpp + Piper TTS |
| Model | gemma2:2b (local, Metal) |
| Target Platform | Apple M4 Air |

## 📦 Stack

| Layer | Tool |
|---|---|
| LLM | gemma2:2b via Ollama |
| Embeddings | nomic-embed-text (local) |
| Vector DB | ChromaDB (on-disk) |
| STT | whisper.cpp (Apple Metal) |
| TTS | Piper TTS — Hindi + English |
| Backend | FastAPI |
| Frontend | Next.js PWA |

## 🗺️ Phase Progress

| Phase | Status |
|---|---|
| Phase 0 — Git Auto-Commit | ${isDone("Phase 0")} |
| Phase 1 — System Setup | ${isDone("Phase 1")} |
| Phase 2 — RAG Pipeline | ${isDone("Phase 2")} |
| Phase 3 — FastAPI Backend | ${isDone("Phase 3")} |
| Phase 4 — Next.js Frontend | ${isDone("Phase 4")} |
| Phase 5 — Integration | ${isDone("Phase 5")} |
| Phase 6 — Demo Ready | ${isDone("Phase 6")} |

## 📁 Skill Files (Antigravity)

| File | Purpose |
|---|---|
| \`SKILL.md\` | Router — which file to read per question |
| \`ollama-llm.md\` | Model selection, Hindi quality, prompt tuning |
| \`rag-chromadb.md\` | Ingestion, chunk tuning, PDF sources |
| \`stt-whisper.md\` | Audio format, Metal acceleration, Hindi STT |
| \`tts-piper.md\` | Voice models, Hindi detection, Piper debug |
| \`backend-fastapi.md\` | Routes, error handling, new endpoints |
| \`frontend-nextjs.md\` | Voice UI, PWA, mobile Safari fixes |

---
*Auto-updated every 5 minutes · voice-aid-legalngov-ass-dtc-hac*
`;

  fs.writeFileSync(README, content);
}

function runScript() {
  try {
    updateReadme();

    execSync("git add README.md .build-status", { cwd: ROOT });

    const status = getBuildStatus();
    const message = `build: ${status} — ${new Date().toISOString()}`;
    execSync(`git commit -m "${message}"`, { cwd: ROOT });
    execSync("git push", { cwd: ROOT });

    console.log(`✅ Pushed at ${new Date().toLocaleTimeString()} | ${status}`);
  } catch (err) {
    if (err.message.includes("nothing to commit")) {
      console.log(`⏭️  No changes at ${new Date().toLocaleTimeString()}`);
    } else {
      console.error("❌ Error:", err.message);
    }
  }
}

console.log("🚀 VoiceAid git auto-commit started (every 5 min)");
console.log(`📁 Repo root: ${ROOT}`);
console.log(`📄 Status file: ${STATUS_FILE}`);
console.log("─".repeat(50));

runScript();
setInterval(runScript, 300000); // 5 minutes
