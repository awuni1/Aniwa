"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MapPin, Loader2, AlertTriangle, Square } from "lucide-react";
import { loadDetector, CLIP_SECONDS, DETECTION_THRESHOLD, TARGET_SAMPLE_RATE, type Detector, type ClipResult } from "@/lib/chainsawDetector";
import type { ChainsawReport } from "@/lib/acoustic";

// After reporting a detection, wait this long before reporting another from
// the same phone — a single felling can run for many minutes, and one pin
// per minute is enough to show it's ongoing without flooding the map.
const REPORT_COOLDOWN_MS = 60000;
const PENDING_KEY = "aniwa.pendingReports";

// Per-phone conveniences only; nothing here needs to survive reliably.
function loadSetting(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function saveSetting(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked — fine */ }
}

// Box-filter downsample to 16 kHz: averaging each output sample's source
// window doubles as a crude low-pass filter, which is enough for a model that
// only looks at a 16 kHz log-mel spectrogram.
function resample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_SAMPLE_RATE) return input;
  const ratio = fromRate / TARGET_SAMPLE_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

type Status = "idle" | "loading" | "listening" | "error";

export default function ListenPage() {
  const [deviceName, setDeviceName] = useState("");
  const [deviceKey, setDeviceKey] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [loadPct, setLoadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [lastClip, setLastClip] = useState<ClipResult | null>(null);
  const [level, setLevel] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [wakeLockOn, setWakeLockOn] = useState(false);

  const detectorRef = useRef<Detector | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const bufferRef = useRef<Float32Array[]>([]);
  const bufferedSamplesRef = useRef(0);
  const busyRef = useRef(false);
  const lastReportAtRef = useRef(0);
  const positionRef = useRef<GeolocationPosition | null>(null);
  const settingsRef = useRef({ deviceName: "", deviceKey: "" });

  useEffect(() => {
    setDeviceName(loadSetting("aniwa.deviceName"));
    setDeviceKey(loadSetting("aniwa.deviceKey"));
    setPendingCount(readPending().length);
  }, []);

  useEffect(() => {
    settingsRef.current = { deviceName, deviceKey };
  }, [deviceName, deviceKey]);

  useEffect(() => () => stop(), []);

  // iOS releases the screen wake lock whenever the page is hidden, so take it
  // again when the page comes back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && status === "listening") requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [status]);

  function readPending(): ChainsawReport[] {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]"); } catch { return []; }
  }
  function writePending(reports: ChainsawReport[]) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(reports)); } catch { /* storage blocked */ }
    setPendingCount(reports.length);
  }

  async function requestWakeLock() {
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setWakeLockOn(true);
      wakeLockRef.current.addEventListener("release", () => setWakeLockOn(false));
    } catch {
      setWakeLockOn(false);
    }
  }

  // "offline" = no response at all (no signal): worth retrying later.
  // "rejected-key" = the server answered but refused the device key: retrying
  // won't help until the key is fixed, so the user has to be told.
  async function postReport(report: ChainsawReport): Promise<"sent" | "offline" | "rejected-key" | "invalid"> {
    try {
      const res = await fetch("/api/acoustic", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(settingsRef.current.deviceKey ? { "x-device-key": settingsRef.current.deviceKey } : {}) },
        body: JSON.stringify(report),
      });
      if (res.ok) return "sent";
      if (res.status === 401) return "rejected-key";
      if (res.status === 400) return "invalid";
      return "offline";
    } catch {
      return "offline";
    }
  }

  // Sends this report plus anything queued while the phone had no signal.
  // Forest coverage is patchy, so a failed send is queued rather than lost.
  async function sendWithQueue(report: ChainsawReport | null) {
    const queue = [...readPending(), ...(report ? [report] : [])];
    const stillPending: ChainsawReport[] = [];
    let sent = 0;
    let keyRejected = false;
    for (const r of queue) {
      if (keyRejected) { stillPending.push(r); continue; }
      const outcome = await postReport(r);
      if (outcome === "sent") sent++;
      else if (outcome === "rejected-key") { keyRejected = true; stillPending.push(r); }
      else if (outcome === "offline") stillPending.push(r);
      // "invalid": the server can never accept this record, so drop it.
    }
    writePending(stillPending);
    if (sent) setSentCount((c) => c + sent);
    if (keyRejected) {
      setError("The server rejected this phone's device key, so detections are being kept on the phone. Tap Stop, enter the correct key, then Start again — they'll be sent.");
    } else if (sent) {
      setError(null);
    }
  }

  async function classifyClip(samples: Float32Array) {
    const detector = detectorRef.current;
    if (!detector || busyRef.current) return; // phone too slow for this clip — skip it rather than fall behind
    busyRef.current = true;
    try {
      const result = await detector.classify(samples);
      setLastClip(result);
      const pos = positionRef.current;
      const now = Date.now();
      if (result.chainsawScore >= DETECTION_THRESHOLD && now - lastReportAtRef.current >= REPORT_COOLDOWN_MS) {
        lastReportAtRef.current = now;
        if (navigator.vibrate) navigator.vibrate(200);
        if (pos) {
          await sendWithQueue({
            deviceName: settingsRef.current.deviceName || "Unnamed phone",
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: pos.coords.accuracy ?? null,
            score: result.chainsawScore,
            model: detector.modelId,
            detectedAt: new Date(now).toISOString(),
          });
        } else {
          setError("Chainsaw heard, but there's no GPS fix yet, so it couldn't be pinned.");
        }
      } else if (readPending().length > 0) {
        await sendWithQueue(null);
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function start() {
    setError(null);
    saveSetting("aniwa.deviceName", deviceName);
    saveSetting("aniwa.deviceKey", deviceKey);

    // Everything that needs a user gesture on iOS (audio context, mic, wake
    // lock) happens synchronously-first inside this click handler.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("The microphone needs a secure (https://) connection. Open this page through an https address.");
      return;
    }
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Raw audio: voice-call processing would suppress exactly the
        // steady engine noise we're listening for.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      await ctx.resume();
    } catch {
      setStatus("error");
      setError("Microphone permission was denied. Allow it in Settings › Safari › Microphone, then try again.");
      ctx.close();
      return;
    }
    requestWakeLock();
    sendWithQueue(null); // the key may have just been fixed — flush anything held back

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => { positionRef.current = pos; setPosition(pos); },
      () => setError("Location permission was denied, so detections can't be pinned on the map."),
      { enableHighAccuracy: true, maximumAge: 30000 },
    );

    setStatus("loading");
    try {
      detectorRef.current = await loadDetector(setLoadPct);
    } catch (err) {
      setStatus("error");
      setError(`Couldn't load the AI model: ${err instanceof Error ? err.message : String(err)}`);
      stop();
      return;
    }

    const source = ctx.createMediaStreamSource(streamRef.current!);
    // ScriptProcessor is deprecated but, unlike AudioWorklet, needs no
    // separate module file and works on every iOS version that has a mic API.
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const clipSamples = CLIP_SECONDS * ctx.sampleRate;
    processor.onaudioprocess = (e) => {
      const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
      let peak = 0;
      for (let i = 0; i < chunk.length; i++) peak = Math.max(peak, Math.abs(chunk[i]));
      setLevel(peak);
      bufferRef.current.push(chunk);
      bufferedSamplesRef.current += chunk.length;
      if (bufferedSamplesRef.current >= clipSamples) {
        const clip = new Float32Array(bufferedSamplesRef.current);
        let offset = 0;
        for (const c of bufferRef.current) { clip.set(c, offset); offset += c.length; }
        bufferRef.current = [];
        bufferedSamplesRef.current = 0;
        classifyClip(resample(clip, ctx.sampleRate));
      }
    };
    source.connect(processor);
    processor.connect(ctx.destination); // Safari only runs a ScriptProcessor that's connected to an output
    setStatus("listening");
  }

  function stop() {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    bufferRef.current = [];
    bufferedSamplesRef.current = 0;
    setStatus((s) => (s === "error" ? s : "idle"));
    setLevel(0);
  }

  const listening = status === "listening";

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-1">Aniwa listening device</h1>
      <p className="text-sm text-white/50 mb-6">
        Listens for chainsaws and pins each detection on the Aniwa map. Audio is analyzed on this phone and never uploaded.
      </p>

      <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1" htmlFor="deviceName">Device name</label>
      <input
        id="deviceName"
        value={deviceName}
        onChange={(e) => setDeviceName(e.target.value)}
        disabled={status === "listening" || status === "loading"}
        placeholder="e.g. Kakum north ridge"
        className="w-full bg-gray-900 border border-white/15 px-3 py-2 text-base mb-3 disabled:opacity-50"
      />
      <label className="block text-[11px] uppercase tracking-wider text-white/40 mb-1" htmlFor="deviceKey">Device key (if the server requires one)</label>
      <input
        id="deviceKey"
        type="password"
        value={deviceKey}
        onChange={(e) => setDeviceKey(e.target.value)}
        disabled={status === "listening" || status === "loading"}
        className="w-full bg-gray-900 border border-white/15 px-3 py-2 text-base mb-5 disabled:opacity-50"
      />

      {listening || status === "loading" ? (
        <button type="button" onClick={stop} className="w-full flex items-center justify-center gap-2 bg-white/10 border border-white/20 py-3 text-base">
          <Square size={16} /> Stop listening
        </button>
      ) : (
        <button type="button" onClick={start} className="w-full flex items-center justify-center gap-2 bg-emerald-600 py-3 text-base font-medium">
          <Mic size={18} /> Start listening
        </button>
      )}

      {error && (
        <p className="mt-4 flex gap-2 text-sm text-amber-300">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {status === "loading" && (
        <p className="mt-4 flex items-center gap-2 text-sm text-white/60">
          <Loader2 size={14} className="animate-spin" /> Downloading AI model… {Math.round(loadPct)}% (first time only)
        </p>
      )}

      {listening && (
        <div className="mt-6 space-y-4 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-white/40 mb-1">Microphone level</p>
            <div className="h-2 bg-white/10">
              <div className="h-2 bg-emerald-500 transition-[width]" style={{ width: `${Math.min(100, level * 300)}%` }} />
            </div>
          </div>

          <p className="flex items-center gap-2 text-white/70">
            <MapPin size={14} />
            {position
              ? `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)} (±${Math.round(position.coords.accuracy)} m)`
              : "Waiting for GPS…"}
          </p>

          <div className="border border-white/10 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-white/40 mb-1">Last {CLIP_SECONDS}-second clip</p>
            {lastClip ? (
              <>
                <p className={lastClip.chainsawScore >= DETECTION_THRESHOLD ? "text-red-400 font-medium" : "text-white/80"}>
                  Chainsaw: {Math.round(lastClip.chainsawScore * 100)}%
                  {lastClip.chainsawScore >= DETECTION_THRESHOLD && " — detected"}
                </p>
                <p className="text-white/40 text-xs">Most likely sound: {lastClip.topLabel}</p>
              </>
            ) : (
              <p className="text-white/40">Listening to the first clip…</p>
            )}
          </div>

          <p className="text-white/60">
            Detections sent: {sentCount}
            {pendingCount > 0 && <span className="text-amber-300"> · {pendingCount} not sent yet</span>}
          </p>

          {!wakeLockOn && (
            <p className="text-xs text-amber-300">
              Keep this screen on: if the phone locks, iOS stops the microphone. Set Auto-Lock to Never and keep the phone charging.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
