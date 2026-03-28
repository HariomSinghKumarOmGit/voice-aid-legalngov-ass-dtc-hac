# STT — whisper.cpp Reference

## Model Selection

| Model | Size | Speed (M4) | Accuracy | Hindi |
|---|---|---|---|---|
| `tiny.en` | 75MB | ~0.5s | Low | ❌ |
| `base.en` | 142MB | ~1–2s | Good | ❌ |
| `base` | 142MB | ~1–2s | Good | ✅ |
| `small` | 466MB | ~3–5s | Better | ✅ |
| `medium` | 1.5GB | ~8–12s | Best | ✅ |

**Default: `base.en`** for English-only apps.
**Use `base` (multilingual)** if users speak Hindi — critical difference.

```bash
# Download multilingual base model
whisper-cpp-download-ggml-model base

# Update .env
WHISPER_MODEL=base
```

## Audio Format Requirements

whisper.cpp requires: **16kHz, mono, PCM WAV**

The backend handles this conversion via ffmpeg:

```python
subprocess.run([
    "ffmpeg", "-i", audio_path,
    "-ar", "16000",       # 16kHz sample rate
    "-ac", "1",           # Mono
    "-c:a", "pcm_s16le",  # PCM 16-bit little endian
    wav_path, "-y", "-loglevel", "quiet"
], check=True)
```

**ffmpeg must be installed:** `brew install ffmpeg`

## Running whisper.cpp

```bash
# Basic transcription
whisper-cpp audio.wav --model base

# With language hint (faster, more accurate)
whisper-cpp audio.wav --model base --language hi   # Hindi
whisper-cpp audio.wav --model base --language en   # English

# Output to text file
whisper-cpp audio.wav --model base --output-txt

# No console prints (for use in scripts)
whisper-cpp audio.wav --model base --output-txt --no-prints
```

## Language Auto-Detection

The backend uses `auto` detection by default. To force Hindi:

```python
# In main.py transcribe_audio() — add language hint
result = subprocess.run(
    ["whisper-cpp", wav_path,
     "--model", WHISPER_MODEL,
     "--language", "auto",   # or "hi" to force Hindi
     "--output-txt", "--no-prints"],
    capture_output=True, text=True
)
```

**Problem with auto:** If user speaks Hindi but whisper detects English,
the transcript comes out in Romanized Hindi (e.g., "mujhe paise nahi mile").
The LLM will still try to respond in Hindi if the intent is detected.

**Fix:** Add a language selector to the frontend:
```tsx
// Frontend: let user pick language before recording
const [lang, setLang] = useState<"auto"|"hi"|"en">("auto");
// Pass lang in FormData to backend
formData.append("language", lang);
```

## Debugging Transcription

**Problem: Empty transcription output**
```bash
# Test whisper directly
ffmpeg -i /tmp/test.webm -ar 16000 -ac 1 -c:a pcm_s16le /tmp/test.wav
whisper-cpp /tmp/test.wav --model base
```

**Problem: `whisper-cpp: command not found`**
```bash
brew reinstall whisper-cpp
echo $PATH   # make sure /usr/local/bin or /opt/homebrew/bin is in PATH
```

**Problem: Whisper model not found**
```bash
# Find where models are stored
find /opt/homebrew -name "*.bin" 2>/dev/null
# Re-download
whisper-cpp-download-ggml-model base
```

**Problem: Transcription is garbled / wrong language**
→ Switch from `base.en` to `base` (multilingual)
→ Add explicit `--language hi` flag

**Problem: Slow transcription (>10s)**
→ whisper.cpp uses Metal by default on Apple Silicon — should be fast
→ Check: `whisper-cpp --help | grep metal`
→ Re-install: `brew reinstall whisper-cpp`

## Apple Metal Acceleration

whisper.cpp compiled via Homebrew automatically uses Metal on M4.
No extra setup needed. Verify with:

```bash
whisper-cpp --help 2>&1 | grep -i metal
# Should show: metal = 1 or similar
```

## Audio Quality Tips

Better audio = better transcription:
- Record at 16kHz or higher (browser MediaRecorder default is fine)
- Reduce background noise
- Speak closer to mic for Hindi (accented speech benefits from proximity)
- Min recording length: ~1 second (very short clips often fail)
