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
