"use client";
import { useState, useRef, useEffect } from "react";
import axios from "axios";

type Status = "idle" | "recording" | "processing" | "done" | "error";

interface Result {
  question: string;
  answer: string;
  audioBase64?: string;
  language?: string;
}

function float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataLength = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const idx = Math.round(i * ratio);
    result[i] = buffer[Math.min(idx, buffer.length - 1)];
  }
  return result;
}

export default function Home() {
  const [status, setStatus]       = useState<Status>("idle");
  const [result, setResult]       = useState<Result | null>(null);
  const [textInput, setTextInput] = useState("");
  const [errorMsg, setErrorMsg]   = useState("");

  const audioCtxRef    = useRef<AudioContext | null>(null);
  const processorRef   = useRef<ScriptProcessorNode | null>(null);
  const sourceRef      = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const pcmChunksRef   = useRef<Float32Array[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopAudio = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
  };

  const startRecording = async () => {
    stopAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      pcmChunksRef.current = [];
      processor.onaudioprocess = (e) => {
        pcmChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);
      setStatus("recording");
      setResult(null);
      setErrorMsg("");
    } catch {
      setErrorMsg("Microphone access denied.");
      setStatus("error");
    }
  };

  const cancelRecording = () => {
    if (status !== "recording") return;
    setStatus("idle");
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
  };

  const stopRecording = async () => {
    if (status !== "recording") return;
    setStatus("processing");
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    const sampleRate = audioCtxRef.current?.sampleRate || 44100;
    audioCtxRef.current?.close();
    const chunks = pcmChunksRef.current;
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    if (totalLength < sampleRate * 0.8) {
      setErrorMsg("Recording too short — hold the button longer.");
      setStatus("error");
      return;
    }
    const merged = new Float32Array(totalLength);
    let off = 0;
    for (const chunk of chunks) { merged.set(chunk, off); off += chunk.length; }
    const pcm16k = downsample(merged, sampleRate, 16000);
    const wavBlob = float32ToWavBlob(pcm16k, 16000);
    await sendVoice(wavBlob);
  };

  const sendVoice = async (blob: Blob) => {
    try {
      const formData = new FormData();
      formData.append("audio", blob, "recording.wav");
      const res = await axios.post("http://localhost:8000/api/voice-query", formData, {
        headers: { "Content-Type": "multipart/form-data" }, timeout: 120000,
      });
      setResult({
        question: res.data.question, answer: res.data.answer,
        audioBase64: res.data.audio_base64, language: res.data.language,
      });
      if (res.data.audio_base64) {
        stopAudio();
        const audio = new Audio(`data:audio/wav;base64,${res.data.audio_base64}`);
        currentAudioRef.current = audio;
        audio.onended = () => { currentAudioRef.current = null; };
        audio.play();
      }
      setStatus("done");
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || "Something went wrong.");
      setStatus("error");
    }
  };

  const sendText = async () => {
    if (!textInput.trim()) return;
    stopAudio();
    setStatus("processing");
    setResult(null);
    setErrorMsg("");
    try {
      const res = await axios.post("http://localhost:8000/api/query", { text: textInput });
      setResult({ question: res.data.question, answer: res.data.answer });
      setStatus("done");
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || "Something went wrong.");
      setStatus("error");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") sendText();
  };

  // ── Spacebar Hold to Record ──
  const cbRefs = useRef({ start: startRecording, stop: stopRecording, cancel: cancelRecording, status: status });
  cbRefs.current = { start: startRecording, stop: stopRecording, cancel: cancelRecording, status };

  useEffect(() => {
    let spaceDownTime = 0;
    let isDown = false;

    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        const active = document.activeElement?.tagName;
        if (active === "INPUT" || active === "TEXTAREA") return;
        e.preventDefault(); // Stop page scrolling
        
        const currentStatus = cbRefs.current.status;
        if (currentStatus === "idle" || currentStatus === "done" || currentStatus === "error") {
          isDown = true;
          spaceDownTime = Date.now();
          cbRefs.current.start();
        }
      }
    };

    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        const active = document.activeElement?.tagName;
        if (active === "INPUT" || active === "TEXTAREA") return;

        if (!isDown) return;
        isDown = false;

        const currentStatus = cbRefs.current.status;
        if (currentStatus === "recording") {
          // Require at least >1 second
          if (Date.now() - spaceDownTime < 1000) {
            cbRefs.current.cancel();
          } else {
            cbRefs.current.stop();
          }
        }
      }
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Generate some realistic looking dynamic wavebars
  const waveBars = [6, 10, 14, 8, 22, 16, 12, 18, 24, 14, 10, 8, 16, 20, 12, 6].map((h, i) => (
    <div key={i} className="wave-bar" style={{
      animationDelay: `${i * 0.1}s`,
      // Provide a default varied height for idle state, but we can override via CSS anim
      height: status === "idle" ? `${h / 2}px` : undefined,
      animationPlayState: status === "recording" ? "running" : "paused"
    }} />
  ));

  return (
    <>
      {/* ═══ Background Deep Orbs ═══ */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
      <div className="orb orb-4" />
      <div className="orb orb-5" />

      {/* ═══ Decorative Corner Star ═══ */}
      {/* <svg className="sparkle-star" width="48" height="48" viewBox="0 0 24 24" fill="none">
        <path d="M12 2C12 7.5 16.5 12 22 12C16.5 12 12 16.5 12 22C12 16.5 7.5 12 2 12C7.5 12 12 7.5 12 2Z" fill="#c4b5fd" />
      </svg> */}

      <main style={{
        position: "relative", zIndex: 10,
        height: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>

        {/* ═══ Top Branding & Text ═══ */}
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <h1 style={{
            fontSize: "36px", fontWeight: 700, color: "#f8fafc",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "12px",
            letterSpacing: "-0.01em", margin: 0
          }}>
            <svg width="28" height="36" viewBox="0 0 24 36" fill="none" style={{ opacity: 0.9 }}>
              <rect x="7" y="0" width="10" height="22" rx="5" fill="#5f7be8"/>
              <path d="M4 16v4a8 8 0 0016 0v-4" stroke="#5f7be8" strokeWidth="2.5" fill="none"/>
              <line x1="12" y1="28" x2="12" y2="34" stroke="#5f7be8" strokeWidth="2.5"/>
              <line x1="7" y1="34" x2="17" y2="34" stroke="#5f7be8" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            VoiceAid
          </h1>
          <p style={{
            color: "#94a3b8", fontSize: "14px",
            marginTop: "6px", fontWeight: 400
          }}>
            Calm, trustworthy, slightly futuristic
          </p>
          <div style={{
            width: "280px", height: "1px", margin: "16px auto",
            background: "linear-gradient(90deg, transparent, rgba(160, 180, 255, 0.4), transparent)"
          }} />
        </div>

        {/* ═══ Run Status Pill ═══ */}
        <div style={{
          background: "rgba(30, 45, 90, 0.4)", backdropFilter: "blur(10px)",
          border: "1px solid rgba(130, 150, 255, 0.2)", borderRadius: "999px",
          padding: "6px 20px", display: "flex", alignItems: "center", gap: "10px",
          fontSize: "14px", color: "#e2e8f0", marginBottom: "40px"
        }}>
          <span style={{
            width: "10px", height: "10px", borderRadius: "50%",
            background: "#4ade80", boxShadow: "0 0 10px rgba(74, 222, 128, 0.6)"
          }} />
          &ldquo;Running locally&rdquo;
        </div>

        {/* ═══ Circular Glowing Mic Button ═══ */}
        <div className="mic-btn-container" style={{ marginBottom: "24px" }}>
          {/* Outer diffuse glow */}
          <div className="mic-btn-outer-glow" style={{
            background: status === "recording" 
              ? "radial-gradient(circle, rgba(239, 68, 68, 0.4) 0%, rgba(239, 68, 68, 0) 70%)" 
              : undefined
          }} />
          
          {/* Inner glass ring */}
          <div 
            className={`mic-btn-inner-ring ${status === "recording" ? "recording" : ""}`}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
            onTouchEnd={(e)  => { e.preventDefault(); stopRecording();  }}
          >
            <svg width="32" height="40" viewBox="0 0 24 36" fill="none" style={{ marginBottom: "6px" }}>
              <rect x="7" y="2" width="10" height="18" rx="5"
                    fill={status === "recording" ? "#fca5a5" : "#1e293b"} stroke={status === "recording" ? "#fee2e2" : "#c4b5fd"} strokeWidth="1.5"/>
              <path d="M5 14v4a7 7 0 0014 0v-4" stroke={status === "recording" ? "#fee2e2" : "#c4b5fd"} strokeWidth="1.5" fill="none"/>
              <line x1="12" y1="25" x2="12" y2="30" stroke={status === "recording" ? "#fee2e2" : "#c4b5fd"} strokeWidth="1.5"/>
            </svg>
            <span style={{
              fontSize: "13px", fontWeight: 500, color: status === "recording" ? "#fee2e2" : "#e2e8f0",
              filter: "brightness(1.2)"
            }}>
              {status === "recording" ? "Release" : 
               status === "processing" ? "Wait..." : "Hold to speak"}
            </span>
          </div>
        </div>

        {/* ═══ Waveform Visualizer ═══ */}
        <div className={`waveform-container ${status === "recording" ? "active" : ""}`} style={{ marginBottom: "40px" }}>
          {/* Tiny subtle line in center */}
          <div style={{ width: "6px", height: "1px", background: "rgba(180, 200, 255, 0.3)", opacity: status === "recording" ? 0 : 1 }} />
          {waveBars}
          <div style={{ width: "6px", height: "1px", background: "rgba(180, 200, 255, 0.3)", opacity: status === "recording" ? 0 : 1 }} />
        </div>

        {/* ═══ Bottom Input Pill ═══ */}
        <div style={{ position: "relative", width: "100%", maxWidth: "540px" }}>
          <div className="input-glass" style={{
            display: "flex", alignItems: "center",
            padding: "8px 12px", borderRadius: "999px",
            background: "rgba(25, 35, 75, 0.4)",
          }}>
            <input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Lorem ipsum dolor sit amet"
              style={{
                flex: 1, padding: "10px 16px",
                background: "transparent", border: "none", outline: "none",
                color: "#e2e8f0", fontSize: "15px",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={sendText}
              disabled={status === "processing" || !textInput.trim()}
              style={{
                width: "40px", height: "40px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", cursor: "pointer",
                opacity: !textInput.trim() ? 0.4 : 1, transition: "opacity 0.2s",
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                {/* Paper plane icon drawn with lines like reference */}
                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="#8b9cf7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Processing Indicator */}
        {status === "processing" && (
          <div style={{ marginTop: "24px", display: "flex", gap: "10px", color: "#a5b4fc", fontSize: "14px" }}>
            <div style={{ width: "16px", height: "16px", border: "2px solid #a5b4fc", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
            Thinking locally...
            <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Result & Cards */}
        {errorMsg && (
          <div className="input-glass" style={{ marginTop: "20px", color: "#fca5a5", padding: "12px 20px", borderRadius: "16px" }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {result && status === "done" && (
          <div className="input-glass" style={{
            marginTop: "24px", width: "100%", maxWidth: "540px",
            padding: "24px", borderRadius: "20px",
            animation: "fadeIn 0.3s ease-out"
          }}>
            <p style={{ color: "#8b9cf7", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>You asked</p>
            <p style={{ color: "#f8fafc", marginBottom: "20px", fontSize: "15px" }}>&ldquo;{result.question}&rdquo;</p>
            <p style={{ color: "#8b9cf7", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "4px" }}>VoiceAid says</p>
            <p style={{ color: "#ade2fa", lineHeight: 1.6, fontSize: "14px" }}>{result.answer}</p>
            {result.audioBase64 && (
              <button onClick={() => {
                  stopAudio();
                  const audio = new Audio(`data:audio/wav;base64,${result.audioBase64}`);
                  currentAudioRef.current = audio;
                  audio.onended = () => { currentAudioRef.current = null; };
                  audio.play();
                }}
                style={{
                  marginTop: "16px", background: "none", border: "none", color: "#8b9cf7", fontSize: "12px",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: "6px"
                }}>
                🔊 Replay response
              </button>
            )}
            <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          </div>
        )}

      </main>
    </>
  );
}
