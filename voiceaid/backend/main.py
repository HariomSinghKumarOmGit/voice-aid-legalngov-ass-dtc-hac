from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import subprocess, tempfile, os, base64, sys, logging
from pathlib import Path
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("VoiceAid")

load_dotenv()
sys.path.append("../ai-engine")
from query_engine import get_answer

MODELS_PATH   = os.getenv("PIPER_MODELS_PATH", "../models")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "../models/ggml-base.bin")

app = FastAPI(title="VoiceAid")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

def is_hindi(text: str) -> bool:
    deva = sum(1 for c in text if '\u0900' <= c <= '\u097F')
    return deva / max(len(text), 1) > 0.2

def transcribe_audio(audio_path: str) -> str:
    wav_path = audio_path.replace(".webm", ".wav").replace(".mp4", ".wav")
    
    logger.info(f"Converting {audio_path} to {wav_path}...")
    # 1. Convert to 16kHz Mono WAV (Whisper requirement)
    # Removing quiet loglevel to catch errors if any
    conv = subprocess.run([
        "ffmpeg", "-i", audio_path,
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        wav_path, "-y"
    ], capture_output=True, text=True)
    
    if conv.returncode != 0:
        logger.error(f"FFmpeg failed (code {conv.returncode}): {conv.stderr}")
        raise Exception(f"FFmpeg conversion failed: {conv.stderr}")

    # 2. Transcribe with whisper-cli
    logger.info(f"Transcribing with {WHISPER_MODEL}...")
    trans = subprocess.run(
        ["whisper-cli", "-f", wav_path, "--model", WHISPER_MODEL,
         "--output-txt", "--no-prints"],
        capture_output=True, text=True
    )
    
    if trans.returncode != 0:
        logger.error(f"Whisper failed (code {trans.returncode}): {trans.stderr}")
        if os.path.exists(wav_path): os.unlink(wav_path)
        raise Exception(f"Transcription failed: {trans.stderr}")

    txt_path = wav_path + ".txt"
    text = ""
    if Path(txt_path).exists():
        text = Path(txt_path).read_text().strip()
        os.unlink(txt_path)
    
    if os.path.exists(wav_path):
        os.unlink(wav_path)
        
    return text

def text_to_speech(text: str, hindi: bool = False) -> str:
    # Use the specific downloaded Hindi model name
    model = f"{MODELS_PATH}/hi_IN-pratham-medium.onnx" if hindi \
            else f"{MODELS_PATH}/en_US-lessac-medium.onnx"
    
    out_path = f"/tmp/va_{os.urandom(4).hex()}.wav"
    safe = text.replace('"', '\\"').replace("'", "\\'")
    
    logger.info(f"Generating speech with model {model}...")
    subprocess.run(
        f'echo "{safe}" | piper --model {model} --output_file {out_path}',
        shell=True, check=True
    )
    return out_path

class TextQuery(BaseModel):
    text: str

@app.on_event("startup")
async def startup_event():
    logger.info("Pre-warming AI models (Ollama/Chroma)...")
    get_answer("test")
    logger.info("AI models ready!")

@app.post("/api/query")
async def query_text(body: TextQuery):
    try:
        logger.info(f"Text query received: {body.text}")
        answer = get_answer(body.text)
        logger.info("Response generated.")
        return {"question": body.text, "answer": answer}
    except Exception as e:
        logger.error(f"Query error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/voice-query")
async def voice_query(audio: UploadFile = File(...)):
    tmp_path = None
    try:
        suffix = ".mp4" if "mp4" in (audio.content_type or "") else ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await audio.read()
            if not content:
                return JSONResponse(status_code=400, content={"error": "Empty audio file"})
            tmp.write(content)
            tmp_path = tmp.name

        question = transcribe_audio(tmp_path)
        if not question:
            return JSONResponse(status_code=400,
                                content={"error": "Could not transcribe audio. Speak clearly!"})

        logger.info(f"User asked: {question}")
        answer = get_answer(question)
        hindi  = is_hindi(question) or is_hindi(answer)
        wav    = text_to_speech(answer, hindi)

        with open(wav, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()

        # Clean up
        if tmp_path and os.path.exists(tmp_path): os.unlink(tmp_path)
        if os.path.exists(wav): os.unlink(wav)

        return {
            "question": question,
            "answer":   answer,
            "audio_base64": audio_b64,
            "language": "hi" if hindi else "en"
        }
    except Exception as e:
        logger.error(f"Voice query error: {e}")
        if tmp_path and os.path.exists(tmp_path): os.unlink(tmp_path)
        return JSONResponse(status_code=500, content={"error": str(e)})
