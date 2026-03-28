---
name: voiceaid-local-stack
description: >
  Build, debug, extend, or modify the VoiceAid local AI stack — a fully offline
  voice + RAG pipeline for Indian government scheme queries. Use this skill
  whenever the user is working with any part of this project: Ollama LLM setup,
  ChromaDB ingestion, whisper.cpp STT, Piper TTS, FastAPI backend, or the
  Next.js PWA frontend. Also trigger for questions about: adding new PDF sources,
  switching models, fixing voice pipeline bugs, adding new API routes, tuning RAG
  retrieval, improving Hindi detection, or deploying the app. Trigger even if the
  user only mentions one component (e.g., "piper not working", "chroma is empty",
  "ollama slow").
---

# VoiceAid Local Stack — Skill Guide

Full-stack offline voice assistant. Government scheme RAG on Apple M4 Air.
Zero cloud APIs. Zero cost per query.

## Architecture at a Glance

```
User Voice/Text
      │
      ▼
[STT] whisper.cpp          ← Apple Metal, base.en model
      │
      ▼
[RAG] ChromaDB + Ollama    ← nomic-embed-text embeddings
      │
      ▼
[LLM] gemma2:2b via Ollama ← ~30 tok/s on M4, ~2GB RAM
      │
      ▼
[TTS] Piper TTS            ← CPU only, Hindi + English voices
      │
      ▼
[API] FastAPI :8000        ← 3 routes: /health /query /voice-query
      │
      ▼
[UI]  Next.js PWA :3000    ← Hold-to-speak, text fallback, audio playback
```

## Component Reference Files

Load the relevant reference file when working on a specific layer:

| Layer | File | When to Read |
|---|---|---|
| Ollama + LLM | `references/ollama-llm.md` | Model selection, performance, Hindi quality |
| RAG Pipeline | `references/rag-chromadb.md` | Ingestion, retrieval, chunk tuning |
| STT (whisper) | `references/stt-whisper.md` | Model selection, audio format, Metal |
| TTS (Piper) | `references/tts-piper.md` | Voice models, Hindi, output format |
| FastAPI Backend | `references/backend-fastapi.md` | Routes, error handling, new endpoints |
| Next.js Frontend | `references/frontend-nextjs.md` | UI, PWA, voice recording, audio playback |

## Common Tasks — Quick Routing

| User says | Read |
|---|---|
| "Model is slow / too heavy" | `ollama-llm.md` |
| "No results / wrong answers" | `rag-chromadb.md` |
| "Transcription wrong / not working" | `stt-whisper.md` |
| "No audio / wrong voice / TTS error" | `tts-piper.md` |
| "API route broken / add new route" | `backend-fastapi.md` |
| "UI not working / PWA / recording" | `frontend-nextjs.md` |
| "Hindi not detected / wrong language" | `backend-fastapi.md` + `tts-piper.md` |
| "Add new PDF / re-ingest" | `rag-chromadb.md` |

## Environment Quick Reference

```bash
# Activate backend
cd voiceaid/backend && source venv/bin/activate

# Check Ollama
curl http://localhost:11434/api/tags

# Check backend health
curl http://localhost:8000/health

# Re-ingest PDFs
cd voiceaid/ai-engine && python ingest.py

# Start everything
./voiceaid/start.sh
```

## Key File Paths

```
voiceaid/
├── backend/.env                 ← All config lives here
├── ai-engine/ingest.py          ← PDF → ChromaDB pipeline
├── ai-engine/query_engine.py    ← LLM + retrieval chain
├── backend/main.py              ← FastAPI routes
├── frontend/app/page.tsx        ← Voice UI
├── models/                      ← Piper .onnx voice files
└── data/                        ← Government PDFs (input)
```

## .env Reference

```env
OLLAMA_BASE_URL=http://localhost:11434
LLM_MODEL=gemma2:2b
EMBED_MODEL=nomic-embed-text
CHROMA_DB_PATH=./chroma_db
PIPER_MODELS_PATH=../models
WHISPER_MODEL=base.en
```
