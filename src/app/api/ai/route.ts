import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/security";
import fs from "node:fs/promises";
import path from "node:path";
import { getGhanaLossData } from "@/lib/server/gfwClient";
import { getActiveFires } from "@/lib/server/firmsClient";
import { projectLoss, PROJECT_TO_YEAR } from "@/lib/projection";
import { FOREST_BELT_REGIONS } from "@/lib/deforestationModel";
import type { ChainsawDetection } from "@/lib/acoustic";
import { getClimateHistory } from "@/lib/server/powerClient";
import { getTreeCrops } from "@/lib/server/faoClient";
import { APPROACHES, computePlan, PLAN_YEARS, type PlantingApproach } from "@/lib/planting";

export const dynamic = "force-dynamic";

// Google Gemini, free tier (key from aistudio.google.com/apikey). Verified
// 2026-11-13: gemini-2.5-flash answers; gemini-2.0-flash has been retired
// (404) and gemini-flash-latest was returning 503 "high demand", so it's
// only the fallback.
const MODELS = ["gemini-2.5-flash", "gemini-flash-latest"];
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_QUESTION_CHARS = 500;

const SYSTEM_PROMPT = `You are the analyst for Aniwa, a deforestation monitoring dashboard for Ghana.
Answer using ONLY the facts in the DATA block. Quote numbers exactly as given, with their units.
If the data can't answer the question, say so plainly and say what data would be needed. Never invent figures, places or causes.
Be careful with causation: fires in forest-belt regions often mean land clearing but not always; savanna fires are mostly seasonal burning; the projection is a straight-line trend, not a forecast.
Write for government officials and grant reviewers: plain English, short. Use at most 6 bullet points, starting each with "- ", and at most 150 words. Use **bold** only for the key number in a bullet.`;

// Planting advice needs general forestry knowledge (which species suit a
// zone), which isn't in our data — so species advice is allowed, but every
// number must still come from DATA, and species must be flagged as guidance.
const PLANT_PROMPT = `You are a reforestation adviser for Aniwa, a deforestation dashboard for Ghana.
Numbers: use ONLY the figures in the DATA block, quoted exactly with units. Never invent tree counts, CO2 figures or temperatures.
Species: recommend 5 to 8 tree species suited to the region's ecological zone in Ghana, preferring native species (give common and scientific names). You may use general forestry knowledge for this; say the list is general guidance to confirm with the Forestry Commission or a local forester.
Heat: explain qualitatively how canopy cools the ground (shade, evaporation from leaves). Do not give a temperature figure unless it is in DATA.
Format: plain English for officials and farmers. Short sections with these headings in bold: **Recommended species**, **CO2 benefit**, **Heat and climate**, **Practical steps**. Use "- " bullets. At most 250 words.`;

const CROPS_PROMPT = `You are the analyst for Aniwa, a deforestation dashboard for Ghana, summarising Ghana's tree crops.
Use ONLY the facts in the DATA block and quote numbers exactly with units. FAOSTAT figures are national annual statistics.
Be careful with causation: crop expansion can drive forest clearing, but the data alone does not prove where new farms came from; say so where relevant.
Plain English, at most 6 bullets starting with "- ", at most 170 words, **bold** only for key numbers.`;

async function buildPlantFacts(plan: { region: string; hectares: number; approach: PlantingApproach; treesPerHa: number }): Promise<string> {
  const loss = await getGhanaLossData();
  const region = loss.regions.find((r) => r.region === plan.region);
  if (!region) throw new Error("unknown region");
  const climate = await getClimateHistory(region.region, region.lat, region.lng).catch(() => null);
  const result = computePlan(plan.hectares, plan.approach, plan.treesPerHa);
  const a = APPROACHES[plan.approach];
  const r0 = (n: number) => Math.round(n).toLocaleString("en-GH");
  const lines = [
    `Region: ${region.region}, Ghana. Tree cover loss 2001-${loss.dataThroughYear}: ${region.totalLossKha2001to2024.toFixed(1)} kha; in ${loss.dataThroughYear}: ${region.lossKha2024.toFixed(1)} kha; satellite clearing alerts last 30 days: ${region.recentAlertAreaHa.toFixed(1)} ha.`,
    `Forest-belt region: ${FOREST_BELT_REGIONS.has(region.region) ? "yes (high-forest zone)" : "no (transition or savanna zone)"}.`,
    `Planting plan: ${plan.hectares} ha, approach "${a.label}" (${a.note}), ${plan.treesPerHa} trees per hectare = ${r0(result.trees)} trees.`,
    `Estimated CO2 removal (assumed ${a.carbonTPerHaYr.low}-${a.carbonTPerHaYr.high} t carbon/ha/yr, indicative): ${r0(result.co2PerYearT.low)}-${r0(result.co2PerYearT.high)} t CO2 per year; ${r0(result.co2OverPlanT.low)}-${r0(result.co2OverPlanT.high)} t CO2 over ${PLAN_YEARS} years.`,
  ];
  if (climate && climate.length >= 20) {
    const first = climate.slice(0, 10);
    const last = climate.slice(-10);
    const avg = (arr: typeof climate) => arr.reduce((s, y) => s + y.hotDays, 0) / arr.length;
    lines.push(
      `NASA POWER, ${region.region}: days per year at or above 35 °C averaged ${avg(first).toFixed(0)} in ${first[0].year}-${first[first.length - 1].year} and ${avg(last).toFixed(0)} in ${last[0].year}-${last[last.length - 1].year}; latest year ${climate[climate.length - 1].year}: ${climate[climate.length - 1].hotDays} days, average daily high ${climate[climate.length - 1].meanMaxTempC.toFixed(1)} °C.`,
    );
  }
  return lines.join("\n");
}

async function buildCropFacts(): Promise<string> {
  const [crops, loss] = await Promise.all([getTreeCrops(), getGhanaLossData()]);
  const r0 = (n: number | null | undefined) => (n == null ? "n/a" : Math.round(n).toLocaleString("en-GH"));
  const lines = crops.crops.map((c) => {
    const n = c.years.length;
    const pick = [n - 11, n - 6, n - 1].filter((i) => i >= 0);
    return `${c.name}: production ${pick.map((i) => `${c.years[i]} ${r0(c.productionT[i])} t`).join(", ")}; area harvested ${pick.map((i) => `${c.years[i]} ${r0(c.areaHa[i])} ha`).join(", ")}.`;
  });
  lines.push(`Tree cover loss drivers 2001-${loss.dataThroughYear} (GFW): ${loss.drivers.map((d) => `${d.name} ${d.areaKha.toFixed(1)} kha`).join(", ")}.`);
  return `Source: ${crops.source}\n${lines.join("\n")}`;
}

async function buildFacts(): Promise<string> {
  const [loss, fires, detections] = await Promise.all([
    getGhanaLossData(),
    getActiveFires().catch(() => null),
    fs
      .readFile(path.join(process.cwd(), "data", "acoustic_detections.json"), "utf8")
      .then((raw) => JSON.parse(raw) as ChainsawDetection[])
      .catch(() => [] as ChainsawDetection[]),
  ]);

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const byLoss = [...loss.regions].sort((a, b) => b.totalLossKha2001to2024 - a.totalLossKha2001to2024);
  const byAlerts = [...loss.regions].filter((r) => r.recentAlertAreaHa >= 0.1).sort((a, b) => b.recentAlertAreaHa - a.recentAlertAreaHa);
  const projection = projectLoss(loss.nationalYearlyLossKha);

  const lines = [
    `Tree cover loss (Global Forest Watch, Hansen/UMD, 30% canopy): ${r1(loss.nationalTotalLossKha2001to2024)} kha in 2001-${loss.dataThroughYear}; ${r1(loss.nationalTotalLossKha2024)} kha in ${loss.dataThroughYear}.`,
    `Yearly loss, kha: ${loss.nationalYearlyLossKha.map((y) => `${y.year} ${r1(y.lossKha)}`).join(", ")}.`,
    `Regions by total loss 2001-${loss.dataThroughYear}, kha: ${byLoss.slice(0, 8).map((r) => `${r.region} ${r1(r.totalLossKha2001to2024)}`).join(", ")}.`,
    `Satellite clearing alerts, last 30 days to ${loss.alertsAsOfLatest} (natural forest only): ${r1(loss.nationalRecentAlertAreaHa)} ha nationally; by region: ${byAlerts.slice(0, 8).map((r) => `${r.region} ${r1(r.recentAlertAreaHa)} ha`).join(", ") || "none"}.`,
    `Drivers of loss 2001-${loss.dataThroughYear}, kha: ${loss.drivers.map((d) => `${d.name} ${r1(d.areaKha)}`).join(", ")}.`,
  ];
  if (projection) {
    lines.push(
      `Projection if the last-10-year trend continues to ${PROJECT_TO_YEAR}: ${r1(projection.cumulativeKha)} kha more loss, about ${Math.round(projection.co2eMt.mid)} Mt CO2e (range ${Math.round(projection.co2eMt.low)}-${Math.round(projection.co2eMt.high)}); recent average ${r1(projection.recentAvgKha)} kha/yr, trend ${r1(projection.trendPerYearKha)} kha/yr each year.`,
    );
  }
  if (fires?.available) {
    const forest = fires.fires.filter((f) => FOREST_BELT_REGIONS.has(f.region));
    const count = (list: typeof forest) => {
      const by: Record<string, number> = {};
      for (const f of list) by[f.region] = (by[f.region] ?? 0) + 1;
      return Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
    };
    lines.push(
      `NASA FIRMS active fires, last ${fires.days} days: ${fires.fires.length} in Ghana; ${forest.length} in forest-belt regions (${count(forest) || "none"}); the rest in savanna regions.`,
    );
  } else {
    lines.push("NASA FIRMS fires: unavailable right now.");
  }
  const recent = detections.slice(0, 5);
  lines.push(
    detections.length === 0
      ? "Chainsaw detections from listening phones: none recorded."
      : `Chainsaw detections from listening phones: ${detections.length} total; latest: ${recent.map((d) => `${d.detectedAt} at ${d.lat.toFixed(3)},${d.lng.toFixed(3)} (${Math.round(d.score * 100)}%)`).join("; ")}.`,
  );
  return lines.join("\n");
}

async function callGemini(key: string, prompt: string, systemPrompt: string): Promise<string> {
  let lastError = "no model answered";
  for (const model of MODELS) {
    const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        // Thinking tokens count against maxOutputTokens on 2.5 models and cut
        // answers off mid-sentence; summarizing given facts doesn't need them.
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.json().catch(() => null);
    const text: string | undefined = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
    if (res.ok && text) return text.trim();
    lastError = body?.error?.message ?? `HTTP ${res.status}`;
    if (res.status !== 503 && res.status !== 429 && res.status !== 404) break; // only overload/retired is worth trying the next model
  }
  throw new Error(lastError);
}

// Each answer costs Gemini quota: a few questions a minute per address, and a
// daily cap for the whole site so nobody can run up the bill.
const ASKS_PER_MIN = 6;
const ASKS_PER_DAY_TOTAL = 500;

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "The AI analyst isn't set up on this server." }, { status: 503 });
  if (!rateLimit(`ai:${clientIp(req)}`, ASKS_PER_MIN, 60_000)) {
    return NextResponse.json({ error: "Too many questions in a minute. Wait a moment and try again." }, { status: 429 });
  }
  if (!rateLimit("ai:all", ASKS_PER_DAY_TOTAL, 24 * 3600_000)) {
    return NextResponse.json({ error: "The AI analyst has reached today's limit. Try again tomorrow." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim().slice(0, MAX_QUESTION_CHARS) : "";

  try {
    let facts: string;
    let task: string;
    let systemPrompt = SYSTEM_PROMPT;
    if (body.mode === "plant") {
      const p = body.plan ?? {};
      const approach: PlantingApproach = p.approach === "agroforestry" ? "agroforestry" : "native";
      const hectares = Math.min(1_000_000, Math.max(1, Number(p.hectares) || 100));
      const treesPerHa = Math.min(5000, Math.max(1, Number(p.treesPerHa) || APPROACHES[approach].treesPerHa));
      facts = await buildPlantFacts({ region: String(p.region ?? ""), hectares, approach, treesPerHa });
      task = question ? `Answer this about the planting plan: ${question}` : "Write the planting plan for this region.";
      systemPrompt = PLANT_PROMPT;
    } else if (body.mode === "crops") {
      facts = await buildCropFacts();
      task = question ? `Answer this question: ${question}` : "Summarise Ghana's tree crops: what is grown most, what is growing or shrinking, and what that may mean for forests.";
      systemPrompt = CROPS_PROMPT;
    } else {
      facts = await buildFacts();
      task = question
        ? `Answer this question: ${question}`
        : "Write a briefing: where deforestation is happening now, how serious it is, what happens if it isn't stopped, and where to act first.";
    }
    const answer = await callGemini(key, `DATA:\n${facts}\n\nTASK: ${task}`, systemPrompt);
    return NextResponse.json({ answer, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("ai:", err);
    return NextResponse.json({ error: "The AI analyst is unavailable right now. Try again in a minute." }, { status: 502 });
  }
}
