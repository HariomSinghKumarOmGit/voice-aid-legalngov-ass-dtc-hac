# Ollama + LLM Reference

## Model Selection

| Model | RAM | Speed (M4) | Hindi | Use When |
|---|---|---|---|---|
| `gemma2:2b` | ~1.8GB | ~30 tok/s | ✅ Good | Default — best balance |
| `phi3:mini` | ~2.3GB | ~25 tok/s | ⚠️ Weak | English-only queries |
| `phi4-mini` | ~2.5GB | ~20 tok/s | ⚠️ Weak | Better reasoning needed |
| `llama3.2:3b` | ~2.0GB | ~22 tok/s | ✅ Good | Alternative to gemma2 |
| `aya:8b` | ~5GB | ~10 tok/s | ✅ Best | Max Hindi quality (heavy) |

**Default: `gemma2:2b`** — silent on M4 Air, no fan, good Hindi.

## Pull / Switch Models

```bash
ollama pull gemma2:2b
ollama pull nomic-embed-text   # Always needed for RAG

# Switch model: update .env
LLM_MODEL=llama3.2:3b
# Then restart backend — query_engine.py reads from .env
```

## Ollama Daemon Management

```bash
# Start (auto-sleeps when idle — good for battery)
ollama serve &

# Check running models
curl http://localhost:11434/api/tags

# List pulled models
ollama list

# Remove model to free disk
ollama rm phi3:mini

# Check memory usage
ollama ps
```

## Performance Tips for M4 Air

- First query after idle is slow (~5–10s) — Ollama loads model into unified memory
- Subsequent queries: fast (~2–4s for gemma2:2b)
- `ollama serve` auto-unloads model after 5 min idle (saves RAM)
- Do NOT run other heavy apps (Xcode, video editors) during inference
- Keep `num_ctx` default (2048) — increasing it raises RAM significantly

## query_engine.py — Key Settings

```python
llm = ChatOllama(
    model=LLM_MODEL,
    base_url=OLLAMA_URL,
    temperature=0.3,    # Lower = more factual (good for govt queries)
    num_ctx=2048,       # Context window — keep default
)
```

**Tuning temperature:**
- `0.1–0.3` → Strict, factual answers (recommended for govt data)
- `0.5–0.7` → More conversational
- `>0.8` → Creative / unpredictable (avoid for this use case)

## Prompt Engineering for Government Data

The system prompt in `query_engine.py` controls tone and language switching.
Edit `PROMPT_TEMPLATE` to:

```python
PROMPT_TEMPLATE = """
You are VoiceAid, a government rights assistant for Indian citizens.
Answer in simple language anyone can understand.
If the user writes in Hindi or uses Devanagari script, respond in Hindi.
If English, respond in English.
Keep answers short and actionable — 3 to 5 sentences maximum.
Always mention which scheme or document your answer comes from.
If information is not in the context, say "I don't have that information."

Context from government documents:
{context}

User Question: {question}

Answer:
"""
```

**Key rules:**
- Never remove `{context}` and `{question}` — these are LangChain template vars
- Always instruct the model to say "I don't know" rather than hallucinate
- Keep the answer length instruction — long answers get cut off in TTS

## Debugging LLM Issues

**Problem: Answers are wrong / hallucinated**
→ Check RAG first (`rag-chromadb.md`). LLM answers are only as good as retrieved context.

**Problem: Model not found**
```bash
ollama list   # Is it pulled?
ollama pull gemma2:2b
```

**Problem: Very slow (>30s per query)**
→ Check RAM pressure: `Activity Monitor → Memory → Memory Pressure`
→ Close other apps
→ Switch to smaller model: `phi3:mini`

**Problem: Hindi response in English**
→ The prompt is correct — check if whisper transcribed Hindi as Roman text
→ See `stt-whisper.md` for Hindi transcription tips
