# TTS — Piper Reference

## Available Voice Models

### English

| Model | Size | Quality | Speed |
|---|---|---|---|
| `en_US-lessac-medium` | ~60MB | ✅ Good | Fast |
| `en_US-ryan-medium` | ~60MB | ✅ Good | Fast |
| `en_GB-alan-medium` | ~60MB | ✅ British | Fast |

### Hindi

| Model | Size | Quality | Speed |
|---|---|---|---|
| `hi_IN-male-medium` | ~60MB | ✅ Good | Fast |
| `hi_IN-female-medium` | ~60MB | ✅ Good | Fast |

## Download Voice Models

```bash
BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"

# English (US - Lessac)
curl -L -o models/en_US-lessac-medium.onnx \
  $BASE_URL/en/en_US/lessac/medium/en_US-lessac-medium.onnx
curl -L -o models/en_US-lessac-medium.onnx.json \
  $BASE_URL/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

# Hindi (Male)
curl -L -o models/hi_IN-male-medium.onnx \
  $BASE_URL/hi/hi_IN/male/medium/hi_IN-male-medium.onnx
curl -L -o models/hi_IN-male-medium.onnx.json \
  $BASE_URL/hi/hi_IN/male/medium/hi_IN-male-medium.onnx.json
```

**Both `.onnx` AND `.onnx.json` files are required.** Missing the JSON breaks Piper.

## Running Piper

```bash
# Basic usage
echo "Hello, this is VoiceAid." | piper \
  --model models/en_US-lessac-medium.onnx \
  --output_file output.wav

# Play immediately (macOS)
echo "Namaste" | piper \
  --model models/hi_IN-male-medium.onnx \
  --output_file /tmp/out.wav && afplay /tmp/out.wav
```

## Backend Integration

```python
def text_to_speech(text: str, is_hindi_text: bool = False) -> str:
    """Returns path to generated .wav file."""
    if is_hindi_text:
        model = f"{MODELS_PATH}/hi_IN-male-medium.onnx"
    else:
        model = f"{MODELS_PATH}/en_US-lessac-medium.onnx"

    out_path = f"/tmp/response_{os.urandom(4).hex()}.wav"

    # Escape quotes in text to avoid shell injection
    safe_text = text.replace('"', '\\"').replace("'", "\\'")

    subprocess.run(
        f'echo "{safe_text}" | piper --model {model} --output_file {out_path}',
        shell=True, check=True
    )
    return out_path
```

**Important:** Always clean up temp `.wav` files after sending:
```python
os.unlink(audio_path)  # Already in main.py
```

## Hindi Language Detection

```python
def is_hindi(text: str) -> bool:
    """True if >20% of chars are Devanagari Unicode."""
    devanagari = sum(1 for c in text if '\u0900' <= c <= '\u097F')
    return devanagari / max(len(text), 1) > 0.2
```

**Limitations:**
- Roman Hindi ("mujhe paisa chahiye") → returns `False` → English voice used
- This is acceptable — English voice reads Roman Hindi reasonably well
- To improve: use LLM to detect language intent instead of Unicode check

**Better detection (optional upgrade):**
```python
# Add this to query_engine.py prompt:
# "Always start your response with [LANG:hi] or [LANG:en]"
# Then parse the tag in main.py before TTS

import re
def extract_lang(answer: str):
    match = re.match(r'\[LANG:(hi|en)\]\s*', answer)
    if match:
        lang = match.group(1)
        clean = answer[match.end():]
        return clean, lang == "hi"
    return answer, is_hindi(answer)
```

## Output Format

Piper always outputs `.wav` (PCM). The backend encodes to base64 for transport:

```python
with open(audio_path, "rb") as f:
    audio_b64 = base64.b64encode(f.read()).decode()
```

Frontend plays with:
```js
const audio = new Audio(`data:audio/wav;base64,${audio_b64}`);
audio.play();
```

## Debugging Piper

**Problem: `piper: command not found`**
```bash
pip install piper-tts
which piper
```

**Problem: `.onnx` model file not found**
```bash
ls -la voiceaid/models/
# Check PIPER_MODELS_PATH in .env matches this directory
```

**Problem: `.onnx.json` missing**
→ Download both files — Piper needs the JSON config alongside the model.

**Problem: Audio is choppy / distorted**
→ Text has special characters — sanitize before passing to Piper:
```python
import re
safe_text = re.sub(r'[^\w\s।,.!?-]', '', text)
```

**Problem: Hindi voice sounds wrong / English voice used for Hindi text**
→ Check `is_hindi()` — the input may be Roman Hindi
→ Manually test: `echo "नमस्ते" | piper --model models/hi_IN-male-medium.onnx --output_file /tmp/t.wav && afplay /tmp/t.wav`

## Energy Profile

Piper runs entirely on CPU — no GPU needed.
On M4 Air, a 100-word response generates in <500ms.
No fan spin. Minimal battery impact.
