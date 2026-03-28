# Backend — FastAPI Reference

## Routes

| Method | Path | Input | Output |
|---|---|---|---|
| GET | `/health` | — | `{status, message}` |
| POST | `/api/query` | `{text: str}` | `{question, answer}` |
| POST | `/api/voice-query` | `multipart/audio` | `{question, answer, audio_base64, language}` |

## Running the Backend

```bash
cd voiceaid/backend
source venv/bin/activate
uvicorn main:app --reload --port 8000

# Test routes
curl http://localhost:8000/health

curl -X POST http://localhost:8000/api/query \
  -H "Content-Type: application/json" \
  -d '{"text": "PM Kisan ke liye eligibility kya hai?"}'

# Interactive API docs
open http://localhost:8000/docs
```

## Adding a New Route

Template for a new endpoint:

```python
from pydantic import BaseModel

class NewRequest(BaseModel):
    field: str

@app.post("/api/new-route")
async def new_route(body: NewRequest):
    try:
        result = some_function(body.field)
        return {"result": result}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
```

## Voice Pipeline — Step by Step

```
POST /api/voice-query
  │
  ├─ 1. Save incoming WebM blob to /tmp/
  ├─ 2. ffmpeg: WebM → WAV (16kHz mono PCM)
  ├─ 3. whisper-cpp: WAV → transcript text
  ├─ 4. is_hindi(transcript): detect language
  ├─ 5. get_answer(transcript): RAG + LLM
  ├─ 6. text_to_speech(answer, is_hindi): Piper → WAV
  ├─ 7. base64 encode WAV
  └─ 8. Return {question, answer, audio_base64, language}
```

## CORS Configuration

Currently allows all origins (`"*"`) for local dev.
For production, restrict to your domain:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yourdomain.com"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)
```

## Error Handling Pattern

All routes follow this pattern — never let unhandled exceptions crash the server:

```python
@app.post("/api/query")
async def query_text(body: TextQuery):
    try:
        answer = get_answer(body.text)
        return {"question": body.text, "answer": answer}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
```

## Adding SMS Fallback (Twilio — Optional)

Only add this if you need offline SMS for users without smartphones:

```bash
pip install twilio
```

```python
# Add to .env
TWILIO_SID=your_sid
TWILIO_AUTH=your_auth
TWILIO_PHONE=+1234567890

# Add to main.py
@app.post("/api/sms")
async def sms_reply(Body: str, From: str):
    answer = get_answer(Body)
    from twilio.rest import Client
    client = Client(os.getenv("TWILIO_SID"), os.getenv("TWILIO_AUTH"))
    client.messages.create(
        body=answer[:1600],
        from_=os.getenv("TWILIO_PHONE"),
        to=From
    )
    return {"status": "SMS sent"}
```

## Streaming Responses (Optional Upgrade)

For faster perceived response time, stream LLM output:

```python
from fastapi.responses import StreamingResponse

@app.post("/api/query-stream")
async def query_stream(body: TextQuery):
    from langchain_ollama import ChatOllama

    llm = ChatOllama(model=LLM_MODEL, base_url=OLLAMA_URL, temperature=0.3)

    async def generate():
        for chunk in llm.stream(body.text):
            yield chunk.content

    return StreamingResponse(generate(), media_type="text/plain")
```

Then in frontend:
```tsx
const res = await fetch("http://localhost:8000/api/query-stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: textInput })
});
const reader = res.body!.getReader();
// ... read chunks and append to answer state
```

## Debugging

**Problem: 422 Unprocessable Entity**
→ Request body doesn't match Pydantic model
→ Check field names in request match `class TextQuery`

**Problem: 500 on /api/voice-query**
→ Check: is `ffmpeg` installed? Is `whisper-cpp` in PATH?
→ Run `transcribe_audio()` manually with a test WAV file

**Problem: query_engine not found / import error**
→ `sys.path.append("../ai-engine")` must point to correct path
→ Run uvicorn from `voiceaid/backend/` directory, not from project root

**Problem: Backend crashes on startup**
→ ChromaDB not initialized yet — run `python ingest.py` first
→ Ollama not running — `ollama serve &`

**Problem: Slow first request (~30s)**
→ Normal — Ollama loads gemma2:2b into unified memory on first call
→ Subsequent requests: ~3–6s
