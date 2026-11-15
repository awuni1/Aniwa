"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, MapPin, Loader2, AlertTriangle, Square, ShieldCheck, Send, KeyRound, Smartphone, ChevronLeft, Clock } from "lucide-react";
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
  const busy = listening || status === "loading";
  const score = lastClip?.chainsawScore ?? 0;
  const detected = listening && lastClip !== null && score >= DETECTION_THRESHOLD;
  // Peak mic level (0-1) drives the rings around the button.
  const pulse = 1 + Math.min(0.45, level * 1.6);
  const scorePct = Math.min(100, score * 100 * 2); // the meter tops out at 50% so the 15% threshold isn't squeezed into a corner
  const thresholdPct = DETECTION_THRESHOLD * 100 * 2;

  const accent = detected ? "#f87171" : "#34d399";
  const statusLine =
    status === "loading"
      ? `Downloading the AI model… ${Math.round(loadPct)}%`
      : detected
        ? "Chainsaw detected"
        : listening
          ? lastClip
            ? `Listening · last clip: ${lastClip.topLabel}`
            : `Listening · first result in ${CLIP_SECONDS} s`
          : "Ready to listen";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05080f] text-white">
      {/* Soft glow behind the button; turns red on a detection */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-24 h-[420px] w-[420px] -translate-x-1/2 rounded-full blur-3xl transition-colors duration-700"
        style={{ background: `radial-gradient(circle, ${detected ? "rgba(248,113,113,0.22)" : "rgba(52,211,153,0.16)"} 0%, transparent 65%)` }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-4 pb-8 pt-5">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-sm font-semibold tracking-tight">
            <ChevronLeft size={16} className="text-white/50" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" width={26} height={26} className="rounded-md" />
            Aniwa
          </Link>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-white/60">
            Listening device
          </span>
        </header>

        <section className="mt-8 text-center">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Hear illegal logging as it happens</h1>
          <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-white/55">
            This phone listens for chainsaws and pins each one on the Aniwa map for rangers.
          </p>
        </section>

        {/* Main control */}
        <div className="relative mx-auto mt-8 flex h-64 w-64 items-center justify-center">
          {listening && (
            <>
              <span
                aria-hidden="true"
                className="absolute inset-6 rounded-full border transition-transform duration-150"
                style={{ borderColor: `${accent}55`, transform: `scale(${pulse})` }}
              />
              <span
                aria-hidden="true"
                className="absolute inset-12 rounded-full border transition-transform duration-200"
                style={{ borderColor: `${accent}80`, transform: `scale(${1 + (pulse - 1) * 0.6})` }}
              />
              <span aria-hidden="true" className="absolute inset-14 animate-ping rounded-full opacity-20" style={{ background: accent }} />
            </>
          )}
          {status === "loading" && (
            <span
              aria-hidden="true"
              className="absolute inset-12 rounded-full"
              style={{ background: `conic-gradient(#34d399 ${loadPct * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
            />
          )}
          <button
            type="button"
            onClick={busy ? stop : start}
            aria-label={busy ? "Stop listening" : "Start listening"}
            className={`relative z-10 flex h-36 w-36 flex-col items-center justify-center gap-1.5 rounded-full text-sm font-semibold shadow-2xl transition-all duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/50 active:scale-95 ${
              detected
                ? "bg-gradient-to-br from-red-400 to-red-600 shadow-red-900/50"
                : busy
                  ? "bg-[#0d1626] ring-1 ring-white/15"
                  : "bg-gradient-to-br from-emerald-400 to-emerald-600 text-[#03140d] shadow-emerald-900/50 hover:from-emerald-300"
            }`}
          >
            {status === "loading" ? (
              <>
                <Loader2 size={30} className="animate-spin text-emerald-300" aria-hidden="true" />
                <span className="text-white/80">{Math.round(loadPct)}%</span>
              </>
            ) : busy ? (
              <>
                <Square size={26} className="fill-current" aria-hidden="true" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Mic size={34} aria-hidden="true" />
                <span>Start listening</span>
              </>
            )}
          </button>
        </div>

        <p
          className={`mt-1 text-center text-sm font-medium ${detected ? "text-red-300" : busy ? "text-emerald-300" : "text-white/60"}`}
          aria-live="polite"
        >
          {statusLine}
        </p>
        {status === "loading" && <p className="mt-1 text-center text-[11px] text-white/40">About 86 MB, first time only</p>}

        {error && (
          <div role="alert" className="mt-5 flex gap-2.5 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-3.5 text-[13px] leading-relaxed text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        {listening && (
          <section className="mt-6 space-y-3">
            {/* Chainsaw score meter */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wider text-white/45">Chainsaw score</p>
                <p className={`text-2xl font-semibold tabular-nums ${detected ? "text-red-300" : "text-white"}`}>
                  {lastClip ? `${Math.round(score * 100)}%` : "—"}
                </p>
              </div>
              <div className="relative mt-3 h-2.5 rounded-full bg-white/[0.08]">
                <div
                  className="h-2.5 rounded-full transition-[width] duration-500"
                  style={{ width: `${scorePct}%`, background: detected ? "linear-gradient(90deg,#fb923c,#ef4444)" : "linear-gradient(90deg,#10b981,#34d399)" }}
                />
                <span
                  aria-hidden="true"
                  className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-white/70"
                  style={{ left: `${thresholdPct}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-white/40">
                Alerts at {Math.round(DETECTION_THRESHOLD * 100)}% (white line) · checks every {CLIP_SECONDS} seconds
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/45">
                  <MapPin size={12} aria-hidden="true" /> Location
                </p>
                {position ? (
                  <>
                    <p className="mt-2 text-[13px] font-medium tabular-nums">
                      {position.coords.latitude.toFixed(4)}, {position.coords.longitude.toFixed(4)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/40">±{Math.round(position.coords.accuracy)} m</p>
                  </>
                ) : (
                  <p className="mt-2 flex items-center gap-1.5 text-[13px] text-white/55">
                    <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Finding GPS…
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/45">
                  <Send size={12} aria-hidden="true" /> Reports
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{sentCount}</p>
                <p className={`mt-0.5 text-[11px] ${pendingCount > 0 ? "text-amber-300" : "text-white/40"}`}>
                  {pendingCount > 0 ? `${pendingCount} waiting for signal` : "sent to the map"}
                </p>
              </div>
            </div>

            {!wakeLockOn && (
              <p className="flex gap-2 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-[12px] leading-relaxed text-amber-200">
                <Clock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                Keep this screen on. If the phone locks, it stops listening. Set Auto-Lock to Never and keep it charging.
              </p>
            )}
          </section>
        )}

        {/* Setup: editable before listening, a summary while listening */}
        {busy ? (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-white/45">
            <Smartphone size={12} aria-hidden="true" /> {deviceName || "Unnamed phone"}
            {deviceKey && <> · <KeyRound size={12} aria-hidden="true" /> key set</>}
          </p>
        ) : (
          <section className="mt-7 space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div>
              <label htmlFor="deviceName" className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/45">
                <Smartphone size={12} aria-hidden="true" /> Phone name
              </label>
              <input
                id="deviceName"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="e.g. Kakum north ridge"
                className="w-full rounded-xl border border-white/10 bg-[#0a101d] px-3.5 py-3 text-base placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="deviceKey" className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/45">
                <KeyRound size={12} aria-hidden="true" /> Device key
              </label>
              <input
                id="deviceKey"
                type="password"
                value={deviceKey}
                onChange={(e) => setDeviceKey(e.target.value)}
                placeholder="From your Aniwa admin"
                className="w-full rounded-xl border border-white/10 bg-[#0a101d] px-3.5 py-3 text-base placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none"
              />
            </div>
          </section>
        )}

        <footer className="mt-auto pt-8">
          <p className="flex items-start justify-center gap-2 text-center text-[11px] leading-relaxed text-white/40">
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald-400/70" aria-hidden="true" />
            Sound is checked on this phone by an AI model and never uploaded. Only the time, location and score are sent.
          </p>
        </footer>
      </div>
    </main>
  );
}
