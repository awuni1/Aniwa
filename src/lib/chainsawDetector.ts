"use client";

import { pipeline } from "@huggingface/transformers";

// Runs a Hugging Face audio model ON THE PHONE (transformers.js, WebAssembly)
// rather than on Hugging Face's hosted API: the hosted API currently serves no
// audio-classification models at all (checked 2026-11-07), and on-device
// inference means a phone in the forest only needs signal to send a tiny
// detection record, never audio.

export const TARGET_SAMPLE_RATE = 16000;
// AST was trained on ~10 s clips; in testing, 5 s windows of real chainsaw
// recordings scored at most 0.07 on "Chainsaw", 10 s windows up to 0.30.
export const CLIP_SECONDS = 10;

export interface ClipResult {
  chainsawScore: number; // 0-1
  topLabel: string;
}

export interface Detector {
  modelId: string;
  classify: (samples16k: Float32Array) => Promise<ClipResult>;
}

// AST beat CLAP in testing (2026-11-10, 4 Wikimedia Commons chainsaw
// recordings + noise, 10 s windows): every recording had a window scoring
// 0.18-0.30 on AST's "Chainsaw" label while non-chainsaw windows (vehicles,
// voices, noise) stayed at 0.00-0.05. CLAP's chainsaw scores overlapped more
// (0.10 on one real chainsaw vs 0.09 on a non-chainsaw window), and its q8
// model is ~154 MB against AST's ~86 MB.
type Strategy = "ast" | "clap";
const STRATEGY: Strategy = "ast";

// Score at or above which a clip counts as a chainsaw. Sits between the
// highest non-chainsaw window (0.05) and the lowest best-chainsaw window
// (0.18) in that test. That's a tiny sample, tuned on the same clips it was
// checked against, so expect to adjust it after real field recordings.
export const DETECTION_THRESHOLD = 0.15;

const AST_MODEL = "Xenova/ast-finetuned-audioset-10-10-0.4593";
const CLAP_MODEL = "Xenova/clap-htsat-unfused";

// Zero-shot labels for CLAP. The model picks whichever description fits the
// clip best, so the alternatives are the sounds most often confused with a
// chainsaw in a Ghanaian forest (motorbikes, vehicles, generators) plus the
// forest's normal background, giving it somewhere else to put its confidence.
const CHAINSAW_PROMPT = "the sound of a chainsaw cutting a tree";
const CLAP_PROMPTS = [
  CHAINSAW_PROMPT,
  "the sound of a motorcycle engine",
  "the sound of a car or truck passing",
  "the sound of a generator running",
  "the sound of a forest with birds and insects",
  "the sound of people talking",
  "the sound of music",
  "the sound of wind and rain",
];

type ProgressInfo = { status: string; file?: string; loaded?: number; total?: number };

function progressTracker(onProgress?: (pct: number) => void) {
  // Track bytes across all files so progress doesn't reset per file.
  const files = new Map<string, { loaded: number; total: number }>();
  return (info: ProgressInfo) => {
    if (info.status !== "progress" || !info.file || !info.total) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    onProgress?.(total ? (loaded / total) * 100 : 0);
  };
}

// Scale each clip to a fixed loudness before classifying. A saw heard from a
// distance reaches the mic far quieter than the recordings the model learned
// from, and quiet clips score much lower: in testing (2026-11-10), real
// chainsaw clips 25 dB quieter dropped from 0.27-0.34 to 0.02-0.15 on
// "Chainsaw", and recovered to 0.26-0.37 after scaling to RMS 0.015 (close to
// those recordings' own loudness). RMS 0.1 overshot and hurt scores. Noise
// clips stayed at 0.00 either way. The gain cap stops near-silence from being
// boosted into pure mic hiss.
const TARGET_RMS = 0.015;
const MAX_GAIN = 100; // 40 dB

function normalizeLoudness(samples: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / samples.length);
  if (rms === 0) return samples;
  const gain = Math.min(MAX_GAIN, TARGET_RMS / rms);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  return out;
}

let detectorPromise: Promise<Detector> | null = null;

export function loadDetector(onProgress?: (pct: number) => void): Promise<Detector> {
  if (!detectorPromise) {
    const load = STRATEGY === "clap" ? loadClap(onProgress) : loadAst(onProgress);
    detectorPromise = load.then((d) => ({ ...d, classify: (samples) => d.classify(normalizeLoudness(samples)) })).catch((err) => {
      detectorPromise = null; // let the user retry after a failed download
      throw err;
    });
  }
  return detectorPromise;
}

async function loadAst(onProgress?: (pct: number) => void): Promise<Detector> {
  const classifier = await pipeline("audio-classification", AST_MODEL, {
    dtype: "q8",
    progress_callback: progressTracker(onProgress),
  });
  return {
    modelId: AST_MODEL,
    classify: async (samples) => {
      const results = (await classifier(samples, { top_k: 527 })) as { label: string; score: number }[];
      return {
        chainsawScore: results.find((r) => r.label === "Chainsaw")?.score ?? 0,
        topLabel: results[0]?.label ?? "unknown",
      };
    },
  };
}

async function loadClap(onProgress?: (pct: number) => void): Promise<Detector> {
  // q8 is ~154 MB; the default full-precision file is ~590 MB, too much for a
  // phone to download over mobile data.
  const classifier = await pipeline("zero-shot-audio-classification", CLAP_MODEL, {
    dtype: "q8",
    progress_callback: progressTracker(onProgress),
  });
  return {
    modelId: CLAP_MODEL,
    classify: async (samples) => {
      // Zero-shot results come back in prompt order, not sorted by score.
      const results = ((await classifier(samples, CLAP_PROMPTS)) as { label: string; score: number }[]).sort((a, b) => b.score - a.score);
      return {
        chainsawScore: results.find((r) => r.label === CHAINSAW_PROMPT)?.score ?? 0,
        topLabel: (results[0]?.label ?? "unknown").replace(/^the sound of /, ""),
      };
    },
  };
}
