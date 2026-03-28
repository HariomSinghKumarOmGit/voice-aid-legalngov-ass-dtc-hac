# Frontend — Next.js PWA Reference

## Dev Setup

```bash
cd voiceaid/frontend
npm install
npm run dev         # http://localhost:3000
npm run build       # Production build
npm run start       # Serve production build
```

## Key State Machine

```
idle → recording → processing → done
                             → error
```

```tsx
type Status = "idle" | "recording" | "processing" | "done" | "error";
```

All UI elements branch on `status`. Keep this as the single source of truth.

## Voice Recording — How It Works

```tsx
// 1. Request mic permission + create MediaRecorder
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

// 2. Collect audio chunks as they arrive
recorder.ondataavailable = (e) => chunksRef.current.push(e.data);

// 3. On stop: assemble blob and send
recorder.onstop = async () => {
  const blob = new Blob(chunksRef.current, { type: "audio/webm" });
  await sendVoice(blob);
};

// 4. Hold-to-speak UX
// onMouseDown / onTouchStart → recorder.start(100)
// onMouseUp / onTouchEnd   → recorder.stop()
```

**Critical for mobile:** Always use both `onTouchStart` + `onTouchEnd` with `e.preventDefault()`:
```tsx
onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
onTouchEnd={(e)  => { e.preventDefault(); stopRecording();  }}
```
Without `preventDefault()`, mobile browsers fire `onMouseDown` AND `onTouchStart` (double-fire bug).

## Sending Voice to Backend

```tsx
const sendVoice = async (blob: Blob) => {
  const formData = new FormData();
  formData.append("audio", blob, "recording.webm");

  const res = await axios.post(
    "http://localhost:8000/api/voice-query",
    formData,
    { headers: { "Content-Type": "multipart/form-data" } }
  );

  // Play audio response
  const audio = new Audio(`data:audio/wav;base64,${res.data.audio_base64}`);
  audio.play();
};
```

## Backend URL — Environment Variable

Hardcoded `localhost:8000` only works locally. For deployment:

```tsx
// frontend/app/config.ts
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// In page.tsx
import { API_URL } from "./config";
const res = await axios.post(`${API_URL}/api/voice-query`, formData);
```

```bash
# .env.local (frontend)
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## PWA Setup

`public/manifest.json` — required for "Add to Home Screen" on mobile:

```json
{
  "name": "VoiceAid",
  "short_name": "VoiceAid",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#1e3a8a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

`app/layout.tsx`:
```tsx
export const metadata = {
  manifest: "/manifest.json",
  themeColor: "#1e3a8a",
};
```

Generate icons:
```bash
# Install sharp CLI
npm install -g sharp-cli

# Resize your icon.png to PWA sizes
npx sharp -i icon.png -o public/icon-192.png resize 192
npx sharp -i icon.png -o public/icon-512.png resize 512
```

## Language Selector (Optional Feature)

Add this above the mic button to let users force Hindi or English:

```tsx
const [forceLang, setForceLang] = useState<"auto"|"hi"|"en">("auto");

<div className="flex gap-2 mb-6">
  {(["auto", "hi", "en"] as const).map(l => (
    <button
      key={l}
      onClick={() => setForceLang(l)}
      className={`px-3 py-1 rounded-full text-sm transition-colors
        ${forceLang === l ? "bg-blue-600" : "bg-blue-900 hover:bg-blue-800"}`}
    >
      {l === "auto" ? "Auto" : l === "hi" ? "हिंदी" : "English"}
    </button>
  ))}
</div>
```

Then pass it in FormData:
```tsx
formData.append("language", forceLang);
```

And read in backend `transcribe_audio()`:
```python
async def voice_query(audio: UploadFile, language: str = Form("auto")):
    # Pass language to whisper
    subprocess.run(["whisper-cpp", wav_path, "--language", language, ...])
```

## Audio Playback Issues

**Problem: Audio doesn't play on mobile Safari**
→ Safari requires user gesture to play audio
→ The mic button release IS a user gesture — should work
→ If not: add a "Tap to play" button as fallback:

```tsx
const [audioSrc, setAudioSrc] = useState<string | null>(null);

// After receiving response:
setAudioSrc(`data:audio/wav;base64,${res.data.audio_base64}`);

// In JSX:
{audioSrc && (
  <audio controls src={audioSrc} autoPlay className="w-full mt-4" />
)}
```

**Problem: `audio/webm` not supported in Safari**
→ Safari records in `audio/mp4` not `audio/webm`

```tsx
// Detect correct MIME type
const mimeType = MediaRecorder.isTypeSupported("audio/webm")
  ? "audio/webm"
  : "audio/mp4";

const recorder = new MediaRecorder(stream, { mimeType });
formData.append("audio", blob, mimeType === "audio/webm" ? "rec.webm" : "rec.mp4");
```

Then in backend, handle both extensions in ffmpeg input.

## Debugging Frontend

**Problem: CORS error in browser console**
→ Backend CORS is set to `"*"` — should not happen
→ Check: is backend actually running on port 8000?
→ `curl http://localhost:8000/health`

**Problem: Mic permission denied**
→ Browser needs HTTPS for mic on non-localhost
→ For local dev: `localhost` is always trusted
→ For deployment: must use HTTPS

**Problem: Recording blob is empty**
→ Add `recorder.start(100)` — the `100` means collect data every 100ms
→ Without interval, `ondataavailable` may only fire on stop with some browsers
