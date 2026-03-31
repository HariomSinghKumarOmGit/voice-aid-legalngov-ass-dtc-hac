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
            "-y", "-nostdin",
            "-i", audio_path,
            "-vn", "-ar", "16000", "-ac", "1",
            "-c:a", "pcm_s16le", "-f", "wav",
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

    # ── Step 1: Detect language first ──
    logger.info("Detecting language...")
    detect = subprocess.run(
        ["whisper-cli", "-f", wav_path, "--model", WHISPER_MODEL,
         "--detect-language"],
        capture_output=True, text=True, timeout=30
    )
    detected_lang = "en"
    # Whisper prints: "auto-detected language: hi (p = 0.98)" to stderr
    all_output = (detect.stdout or "") + (detect.stderr or "")
    import re as _re
    lang_match = _re.search(r'auto-detected language:\s*(\w+)', all_output)
    if lang_match:
        detected_lang = lang_match.group(1)
    logger.info(f"Language detection output: {lang_match.group(0) if lang_match else 'not found'}")

    logger.info(f"Detected language: {detected_lang}")

    # ── Step 2: Transcribe with detected language ──
    logger.info(f"Transcribing with whisper-cli ({WHISPER_MODEL}), lang={detected_lang}...")
    cmd = [
        "whisper-cli", "-f", wav_path, "--model", WHISPER_MODEL,
        "-l", detected_lang,
        "--output-txt", "--no-prints",
        "--suppress-nst",       # suppress non-speech tokens
        "-et", "2.4",           # entropy threshold for decoding fail
        "-nth", "0.4"           # no-speech probability threshold
    ]
    trans = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    if trans.returncode != 0:
        logger.error(f"Whisper stderr:\n{trans.stderr}")
        if os.path.exists(wav_path):
            os.unlink(wav_path)
        raise Exception(f"Transcription failed: {trans.stderr[-300:]}")

    txt_path = wav_path + ".txt"
    text = ""
    if Path(txt_path).exists():
        text = Path(txt_path).read_text().strip()
        os.unlink(txt_path)

    # Clean up common Whisper artifacts
    for garbage in ["[BLANK_AUDIO]", "(music)", "(laughing)", "[Music]",
                     "(upbeat music)", "(gentle music)", "(sighs)",
                     "♪", "♪♪", "...", "---", "***", "???"]:
        text = text.replace(garbage, "")
    text = text.strip()

    # Drop well-known silent/background-noise hallucinations
    lower_test = text.lower()
    hallucinations = [
        "thank you.", "thank you for watching.", "thanks for watching.", 
        "please subscribe to my channel.", "subscribe to my channel.",
        "thanks for watching", "thank you", "subscribe.", "subscribe",
        "you", "bye", "amine", "amen", "धन्यवाद।", "धन्यवाद", 
        "सब्सक्राइब करें", "देखने के लिए धन्यवाद", "देखने के लिए धन्यवाद।", 
        "कृपया सब्सक्राइब करें"
    ]
    if lower_test in hallucinations:
        logger.warning(f"Discarding Whisper hallucination: '{text}'")
        text = ""

    if os.path.exists(wav_path) and wav_path != audio_path:
        os.unlink(wav_path)

    logger.info(f"Transcription result: '{text}'")
    return text


def text_to_speech(text: str, hindi: bool = False) -> str:
    out_path = f"/tmp/va_{os.urandom(4).hex()}.wav"

    # Sanitize text — preserve Devanagari (U+0900–U+097F) including matras/combining marks
    if hindi:
        # For Hindi: keep Devanagari, basic Latin, punctuation, digits
        safe_text = re.sub(r'[^\u0900-\u097F\w\s।,.!?\-:\'"()₹0-9]', '', text)
    else:
        # For English: strip non-ASCII (emojis etc.)
        safe_text = re.sub(r'[^\x20-\x7E\n]', '', text)
    if not safe_text.strip():
        safe_text = "माफ़ कीजिए" if hindi else "Sorry, I could not generate a response."

    if hindi:
        # Use edge-tts for Hindi — much better quality than Piper
        mp3_path = out_path.replace(".wav", ".mp3")
        logger.info(f"TTS (edge-tts hi-IN-MadhurNeural): {safe_text[:80]}...")

        try:
            subprocess.run([
                sys.executable, "-m", "edge_tts",
                "--text", safe_text,
                "--voice", "hi-IN-MadhurNeural",
                "--write-media", mp3_path,
            ], check=True, capture_output=True, text=True, timeout=30)

            # Convert mp3 to wav for consistent browser playback
            subprocess.run([
                "ffmpeg", "-y", "-nostdin", "-i", mp3_path,
                "-ar", "22050", "-ac", "1", "-f", "wav", out_path,
            ], check=True, capture_output=True, text=True, timeout=15)

            if os.path.exists(mp3_path):
                os.unlink(mp3_path)
        except Exception as e:
            logger.warning(f"edge-tts failed, falling back to Piper: {e}")
            # Fallback to Piper if edge-tts fails (e.g. no internet)
            _piper_tts(safe_text, f"{MODELS_PATH}/hi_IN-pratham-medium.onnx", out_path)
    else:
        # Use Piper for English — works great
        model = f"{MODELS_PATH}/en_US-lessac-medium.onnx"
        logger.info(f"TTS (piper {model.split('/')[-1]}): {safe_text[:80]}...")
        _piper_tts(safe_text, model, out_path)

    return out_path


def _piper_tts(text: str, model: str, out_path: str):
    """Run Piper TTS via subprocess."""
    txt_file = f"/tmp/va_txt_{os.urandom(4).hex()}.txt"
    Path(txt_file).write_text(text)
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
