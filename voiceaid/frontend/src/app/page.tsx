"use client";
import { useState, useRef } from "react";
import axios from "axios";

type Status = "idle" | "recording" | "processing" | "done" | "error";

interface Result {
  question: string;
  answer: string;
  audioBase64?: string;
  language?: string;
}

/**
 * Build a valid WAV file (16-bit PCM, mono, 16 kHz) from Float32 samples.
 * This guarantees FFmpeg will always be able to read it.
 */
function float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataLength = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // WAV header
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);            // chunk size
  view.setUint16(20, 1, true);             // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);

  // Convert float32 [-1,1] → int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Downsample from the browser's native rate to 16 kHz
 */
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

  // Raw audio capture refs
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const processorRef   = useRef<ScriptProcessorNode | null>(null);
  const sourceRef      = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const pcmChunksRef   = useRef<Float32Array[]>([]);

  // ── Voice Recording (Web Audio API — raw PCM) ────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // 4096 buffer, mono
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      pcmChunksRef.current = [];

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(input));
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

  const stopRecording = async () => {
    if (status !== "recording") return;
    setStatus("processing");

    // Stop everything
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    const sampleRate = audioCtxRef.current?.sampleRate || 44100;
    audioCtxRef.current?.close();

    // Merge all PCM chunks
    const chunks = pcmChunksRef.current;
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);

    if (totalLength < 4000) {
      setErrorMsg("Recording too short — hold the button longer while speaking.");
      setStatus("error");
      return;
    }

    const merged = new Float32Array(totalLength);
    let off = 0;
    for (const chunk of chunks) {
      merged.set(chunk, off);
      off += chunk.length;
    }

    // Downsample to 16 kHz & create WAV blob
    const pcm16k = downsample(merged, sampleRate, 16000);
    const wavBlob = float32ToWavBlob(pcm16k, 16000);

    console.log(`Sending WAV: ${wavBlob.size} bytes, sampleRate=${sampleRate}→16000`);
    await sendVoice(wavBlob);
  };

  // ── Send Voice ────────────────────────────────────────────────────
  const sendVoice = async (blob: Blob) => {
    try {
      const formData = new FormData();
      formData.append("audio", blob, "recording.wav");

      const res = await axios.post(
        "http://localhost:8000/api/voice-query",
        formData,
        { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 }
      );

      setResult({
        question:    res.data.question,
        answer:      res.data.answer,
        audioBase64: res.data.audio_base64,
        language:    res.data.language,
      });

      if (res.data.audio_base64) {
        const audio = new Audio(`data:audio/wav;base64,${res.data.audio_base64}`);
        audio.play();
      }

      setStatus("done");
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || "Something went wrong.");
      setStatus("error");
    }
  };

  // ── Send Text ─────────────────────────────────────────────────────
  const sendText = async () => {
    if (!textInput.trim()) return;
    setStatus("processing");
    setResult(null);
    setErrorMsg("");

    try {
      const res = await axios.post("http://localhost:8000/api/query", {
        text: textInput,
      });
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

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900
                     flex flex-col items-center justify-center p-6 text-white">

      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold tracking-tight mb-2">
          🎙️ VoiceAid
        </h1>
        <p className="text-blue-300 text-lg">
          Government rights assistant — fully offline
        </p>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-green-400 text-sm font-mono">running local</span>
        </div>
      </div>

      {/* Voice Button */}
      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
        onTouchEnd={(e)  => { e.preventDefault(); stopRecording();  }}
        disabled={status === "processing"}
        className={`
          w-36 h-36 rounded-full font-bold text-lg shadow-2xl
          transition-all duration-200 select-none
          ${status === "recording"
            ? "bg-red-500 scale-110 ring-4 ring-red-300 animate-pulse"
            : status === "processing"
            ? "bg-slate-600 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-500 hover:scale-105 active:scale-95"}
        `}
      >
        {status === "recording"   ? "🔴 Release"  :
         status === "processing"  ? "⏳ Wait..."  : "🎤 Hold"}
      </button>

      <p className="mt-3 text-blue-400 text-sm">
        {status === "recording" ? "Listening... release to send"
         : "Hold to speak • Release to send"}
      </p>

      {/* Text Input */}
      <div className="mt-8 w-full max-w-lg flex gap-2">
        <input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ya yahan type karein / Or type here..."
          className="flex-1 p-3 rounded-xl bg-blue-900/50 border border-blue-700
                     placeholder-blue-500 focus:outline-none focus:ring-2
                     focus:ring-blue-500 text-sm"
        />
        <button
          onClick={sendText}
          disabled={status === "processing" || !textInput.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600
                     px-5 rounded-xl font-bold transition-colors"
        >
          Send
        </button>
      </div>

      {/* Status */}
      {status === "processing" && (
        <div className="mt-8 flex items-center gap-3 text-yellow-300">
          <div className="w-4 h-4 border-2 border-yellow-300 border-t-transparent
                          rounded-full animate-spin" />
          <span>Thinking locally...</span>
        </div>
      )}

      {/* Error */}
      {status === "error" && errorMsg && (
        <div className="mt-6 w-full max-w-lg bg-red-900/50 border border-red-700
                        rounded-xl p-4 text-red-300 text-sm">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Result */}
      {result && status === "done" && (
        <div className="mt-8 w-full max-w-lg bg-blue-900/40 rounded-2xl p-6
                        border border-blue-700/50 shadow-xl">
          <p className="text-blue-400 text-xs uppercase tracking-wider mb-1">
            You asked
          </p>
          <p className="font-medium mb-5 text-white">{`"${result.question}"`}</p>

          <p className="text-blue-400 text-xs uppercase tracking-wider mb-1">
            VoiceAid says
          </p>
          <p className="text-emerald-300 leading-relaxed text-sm">
            {result.answer}
          </p>

          {result.audioBase64 && (
            <button
              onClick={() => {
                const audio = new Audio(
                  `data:audio/wav;base64,${result.audioBase64}`
                );
                audio.play();
              }}
              className="mt-4 text-xs text-blue-400 hover:text-blue-300
                         flex items-center gap-1 transition-colors"
            >
              🔊 Replay audio
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <p className="mt-12 text-slate-600 text-xs">
        100% offline · No data leaves your device · Created by team aiova
      </p>
    </main>
  );
}
