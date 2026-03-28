from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import subprocess
import tempfile
import os
import base64
import sys
import logging
import re
from pathlib import Path
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("VoiceAid")

load_dotenv()
sys.path.append("../ai-engine")
from query_engine import get_answer  # noqa: E402

MODELS_PATH   = os.getenv("PIPER_MODELS_PATH", "../models")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "../models/ggml-base.bin")

app = FastAPI(title="VoiceAid")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])


def is_hindi(text: str) -> bool:
    deva = sum(1 for c in text if '\u0900' <= c <= '\u097F')
    return deva / max(len(text), 1) > 0.2


def _detect_suffix(filename: str, content_type: str) -> str:
    """Pick a file extension from the uploaded filename or content-type."""
    fn = (filename or "").lower()
    ct = (content_type or "").lower()
    if "mp4" in fn or "mp4" in ct:
        return ".mp4"
    if "ogg" in fn or "ogg" in ct:
        return ".ogg"
    if "wav" in fn or "wav" in ct:
        return ".wav"
    return ".webm"


def transcribe_audio(audio_path: str) -> str:
    """Convert uploaded audio to 16 kHz mono WAV then run whisper-cli."""

    # If the file is already WAV (from the new frontend), use it directly
    if audio_path.endswith(".wav"):
        wav_path = audio_path
        logger.info(f"Input is already WAV: {audio_path} (size={os.path.getsize(audio_path)})")
    else:
        wav_path = tempfile.mktemp(suffix=".wav")
        logger.info(f"Converting {audio_path} (size={os.path.getsize(audio_path)}) -> {wav_path}")

        # FFmpeg conversion
        conv = subprocess.run([
            "ffmpeg",
            "-y",                      # overwrite
            "-nostdin",                 # don't try to read terminal
            "-i", audio_path,
            "-vn",                     # no video
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            "-f", "wav",
            wav_path,
        ], capture_output=True, text=True, timeout=30)

        if conv.returncode != 0:
            logger.error(f"FFmpeg stderr:\n{conv.stderr}")
            raise Exception(f"FFmpeg conversion failed: {conv.stderr[-500:]}")

    wav_size = os.path.getsize(wav_path)
    logger.info(f"WAV ready: {wav_size} bytes")
    if wav_size < 1000:
        if os.path.exists(wav_path):
            os.unlink(wav_path)
        raise Exception("Audio too short or silent.")

    # ── Step 2: Whisper transcription ──
    logger.info(f"Transcribing with whisper-cli ({WHISPER_MODEL})...")
    trans = subprocess.run(
        ["whisper-cli", "-f", wav_path, "--model", WHISPER_MODEL,
         "--output-txt", "--no-prints"],
        capture_output=True, text=True, timeout=120
    )

    if trans.returncode != 0:
        logger.error(f"Whisper stderr:\n{trans.stderr}")
        if os.path.exists(wav_path):
            os.unlink(wav_path)
        raise Exception(f"Transcription failed: {trans.stderr[-300:]}")

    txt_path = wav_path + ".txt"
    text = ""
    if Path(txt_path).exists():
        text = Path(txt_path).read_text().strip()
        # Remove [BLANK_AUDIO] markers
        text = text.replace("[BLANK_AUDIO]", "").strip()
        os.unlink(txt_path)

    if os.path.exists(wav_path):
        os.unlink(wav_path)

    return text


def text_to_speech(text: str, hindi: bool = False) -> str:
    model = (f"{MODELS_PATH}/hi_IN-pratham-medium.onnx" if hindi
             else f"{MODELS_PATH}/en_US-lessac-medium.onnx")

    out_path = f"/tmp/va_{os.urandom(4).hex()}.wav"

    # Sanitize: keep only basic text characters Piper can handle
    safe_text = re.sub(r'[^\w\s।,.!?\-:\'"()]', '', text)
    if not safe_text.strip():
        safe_text = "Sorry, I could not generate a response."

    logger.info(f"TTS ({model.split('/')[-1]}): {safe_text[:80]}...")

    # Use a temporary text file instead of echo to avoid shell escaping issues
    txt_file = f"/tmp/va_txt_{os.urandom(4).hex()}.txt"
    Path(txt_file).write_text(safe_text)

    try:
        subprocess.run(
            f'cat "{txt_file}" | piper --model {model} --output_file {out_path}',
            shell=True, check=True, capture_output=True, text=True, timeout=30
        )
    except subprocess.CalledProcessError as e:
        logger.error(f"Piper TTS failed: {e.stderr}")
        raise
    finally:
        if os.path.exists(txt_file):
            os.unlink(txt_file)

    return out_path


class TextQuery(BaseModel):
    text: str


@app.on_event("startup")
async def startup_event():
    logger.info("Pre-warming AI models (Ollama / Chroma)...")
    try:
        get_answer("test")
        logger.info("AI models ready!")
    except Exception as e:
        logger.warning(f"Pre-warm failed (non-fatal): {e}")


@app.get("/health")
def health():
    return {"status": "ok", "stack": "local-ollama-chromadb-piper"}


@app.post("/api/query")
async def query_text(body: TextQuery):
    try:
        logger.info(f"Text query: {body.text}")
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
        suffix = _detect_suffix(audio.filename or "", audio.content_type or "")
        content = await audio.read()

        logger.info(f"Voice upload: {audio.filename}, "
                     f"content_type={audio.content_type}, "
                     f"size={len(content)}, suffix={suffix}")

        if len(content) < 100:
            return JSONResponse(status_code=400,
                                content={"error": "Empty or too-small audio file."})

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        question = transcribe_audio(tmp_path)
        if not question:
            return JSONResponse(status_code=400,
                                content={"error": "Could not transcribe audio – please speak clearly and hold longer."})

        logger.info(f"Transcription: {question}")
        answer = get_answer(question)
        hindi = is_hindi(question) or is_hindi(answer)
        wav = text_to_speech(answer, hindi)

        with open(wav, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()

        # Clean up temp files
        for p in [tmp_path, wav]:
            if p and os.path.exists(p):
                os.unlink(p)

        return {
            "question": question,
            "answer": answer,
            "audio_base64": audio_b64,
            "language": "hi" if hindi else "en"
        }
    except Exception as e:
        logger.error(f"Voice query error: {e}")
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return JSONResponse(status_code=500, content={"error": str(e)})
