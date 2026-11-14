"use client";

// "From orbit to the forest floor": the scroll walkthrough under the hero.
// A sticky 3D scene (StoryScene) sits behind seven chapter cards; scrolling
// through the cards drives the camera from a globe down onto Ghana's map.

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, useScroll, useMotionValueEvent } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { CHAPTER_COUNT, chapterPosition } from "@/lib/story";
import type { StoryData } from "@/components/StoryScene";
import type { RegionLoss } from "@/lib/deforestation";
import { FOREST_BELT_REGIONS } from "@/lib/forestBelt";
import { recommendSites } from "@/lib/reforestation";
import { fetchFires } from "@/lib/fires";
import { placeLabel, useNearestPlace } from "@/lib/places";

const StoryScene = dynamic(() => import("@/components/StoryScene"), { ssr: false, loading: () => null });

type Chapter = {
  label: string;
  title: string;
  body: string;
  note?: string;
};

const CHAPTERS: Chapter[] = [
  {
    label: "The problem",
    title: "Ghana is losing its forests faster than anyone can watch.",
    body: "Between 2001 and 2025 Ghana lost 1.9 million hectares of tree cover, 27% of what it had in 2000, releasing about 1.1 billion tonnes of CO2e. Most of it is permanent: farms, mines and settlements, not forest that grows back.",
  },
  {
    label: "Every region",
    title: "All 16 regions, not just the five best documented.",
    body: "Public summaries break out only five regions, which leaves the rest of the country as a blind spot. Aniwa pulls live tree-cover loss for every region from Global Forest Watch and shows what is driving it.",
  },
  {
    label: "Predict",
    title: "See where clearing is likely to happen next.",
    body: "Aniwa ranks the ten likeliest clearing hotspots and scores the risk at any point you click. It combines loss history and remaining forest with live evidence: chainsaw detections, fires and satellite clearing alerts.",
  },
  {
    label: "Listen",
    title: "Turn any phone into a chainsaw listener.",
    body: "Leave a phone in the forest with the listening page open. It recognises chainsaw sound on the phone itself and sends only the location, score and time. Audio never leaves the phone, and detections reach the dashboard within 15 seconds.",
  },
  {
    label: "Watch from space",
    title: "Satellites, fires, and a look ahead to 2035.",
    body: "NASA fire detections in the forest belt, satellite clearing alerts, yesterday's satellite imagery and over 30 years of NASA heat records. A trend line shows what continued loss would mean by 2035, and how much CO2e it would release.",
  },
  {
    label: "What's at stake",
    title: "Carbon, and the animals with nowhere else to go.",
    body: "Every place comes with its carbon stock and the threatened species recorded nearby (from GBIF). Aniwa tracks three critically endangered species and points to the nearest intact-forest refuges: Ankasa, Bia and Kakum.",
  },
  {
    label: "Restore",
    title: "Then put the forest back in the right places.",
    body: "The reforestation recommender scores candidate sites by how much their region has lost and how well a new patch would connect to intact forest, and gives each one a planting plan.",
  },
];

const STATS = [
  { value: "1.9M", unit: "ha", label: "tree cover lost since 2001" },
  { value: "27%", unit: "", label: "of 2000 cover gone" },
  { value: "1.1B", unit: "t", label: "CO2e released" },
];

// Everything the 3D story shows, from live Global Forest Watch and NASA data.
// (In this public version the pins mark the regions with the most clearing
// right now; the private version uses the full risk model.)
async function buildStory(regions: RegionLoss[]): Promise<StoryData> {
  const fires = await fetchFires().catch(() => null);
  const fireList = fires?.available ? fires.fires : [];
  const hotspots = [...regions]
    .filter((r) => r.recentAlertAreaHa > 0)
    .sort((a, b) => b.recentAlertAreaHa - a.recentAlertAreaHa)
    .slice(0, 5);
  const maxLoss = Math.max(...regions.map((r) => r.totalLossKha2001to2024), 1);
  const sites = [...regions]
    .sort((a, b) => b.totalLossKha2001to2024 - a.totalLossKha2001to2024)
    .slice(0, 5)
    .flatMap((r) => recommendSites(r, { lat: r.lat, lng: r.lng }, maxLoss));
  return {
    hotspots: hotspots.map((h) => ({ lat: h.lat, lng: h.lng })),
    fires: fireList.filter((f) => FOREST_BELT_REGIONS.has(f.region)).map((f) => ({ lat: f.lat, lng: f.lng })),
    listener: null,
    sites: sites.map((s) => ({ lat: s.lat, lng: s.lng })),
  };
}

// One line of live facts under the chapters whose 3D view shows live data.
function liveNote(i: number, story: StoryData | null, nearest: ReturnType<typeof useNearestPlace>): string | null {
  if (!story) return null;
  const near = (p: { lat: number; lng: number }) => (nearest ? placeLabel(nearest(p)) : null);
  if (i === 2 && story.hotspots.length) {
    const top = story.hotspots.slice(0, 3).map(near).filter(Boolean);
    return `Pins mark the ${story.hotspots.length} regions with the most clearing in the last 30 days.${top.length ? ` Highest: ${top.join("; ")}.` : ""}`;
  }
  if (i === 3 && story.listener) {
    return story.listener
      ? `The phone marks the latest real detection${near(story.listener) ? `, ${near(story.listener)}` : ""}.`
      : "No phones have reported a chainsaw yet, so no phone is shown on the map.";
  }
  if (i === 4) return `${story.fires.length} NASA fire${story.fires.length === 1 ? "" : "s"} in forest regions in the last 5 days, shown at their real positions.`;
  if (i === 6 && story.sites.length) return `Groves mark ${story.sites.length} real recommended restoration sites in the five highest-loss regions.`;
  return null;
}

const SPECIES = ["Roloway monkey", "White-naped mangabey", "African forest elephant"];

type RegionLossResponse = {
  available: boolean;
  regions?: RegionLoss[];
};

export default function PlatformStory() {
  const sectionRef = useRef<HTMLElement>(null);
  const progressRef = useRef(0);
  const [active, setActive] = useState(0);
  const [year, setYear] = useState(2001);
  const [loss, setLoss] = useState<Record<string, number> | null>(null);
  const [topRegions, setTopRegions] = useState<{ region: string; kha: number }[]>([]);
  const [story, setStory] = useState<StoryData | null>(null);
  const nearest = useNearestPlace();

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    progressRef.current = v;
    const c = chapterPosition(v);
    setActive(Math.min(CHAPTER_COUNT - 1, Math.max(0, Math.floor(c))));
    setYear(2001 + Math.round(34 * Math.min(1, Math.max(0, (c - 3.6) / 1.2))));
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/region-loss")
      .then((r) => r.json())
      .then((d: RegionLossResponse) => {
        if (cancelled || !d.available || !d.regions?.length) return;
        const map: Record<string, number> = {};
        d.regions.forEach((r) => (map[r.region] = r.totalLossKha2001to2024));
        setLoss(map);
        buildStory(d.regions).then((st) => !cancelled && setStory(st)).catch(() => {});
        setTopRegions(
          [...d.regions]
            .sort((a, b) => b.totalLossKha2001to2024 - a.totalLossKha2001to2024)
            .slice(0, 3)
            .map((r) => ({ region: r.region, kha: r.totalLossKha2001to2024 })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const jumpTo = (i: number) => {
    const el = sectionRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY + i * window.innerHeight;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <>
      <section
        ref={sectionRef}
        id="how-it-works"
        aria-label="How Aniwa works"
        className="relative bg-[#0b0d10] text-white"
        style={{ height: `${CHAPTER_COUNT * 100}vh` }}
      >
        {/* Sticky 3D stage */}
        <div className="sticky top-0 h-screen overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,#16212c_0%,#0b0d10_70%)]" />
          <StoryScene progressRef={progressRef} lossByRegion={loss} story={story} />
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#0b0d10] to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0b0d10] to-transparent pointer-events-none" />

          {/* Chapter rail */}
          <nav aria-label="Story chapters" className="hidden md:flex absolute right-6 top-1/2 -translate-y-1/2 flex-col gap-3 z-10">
            {CHAPTERS.map((ch, i) => (
              <button
                key={ch.label}
                onClick={() => jumpTo(i)}
                className="group flex items-center justify-end gap-3 text-right"
                aria-current={active === i ? "step" : undefined}
              >
                <span
                  className={`text-[11px] uppercase tracking-wider transition-opacity ${
                    active === i ? "text-white opacity-100" : "text-white/60 opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {ch.label}
                </span>
                <span
                  className={`block h-px transition-all duration-300 ${
                    active === i ? "w-8 bg-[#F5C518]" : "w-4 bg-white/25 group-hover:bg-white/50"
                  }`}
                />
              </button>
            ))}
          </nav>
        </div>

        {/* Chapter cards scroll over the stage */}
        <div className="absolute inset-x-0 top-0">
          {CHAPTERS.map((ch, i) => (
            <div key={ch.label} className="h-screen flex items-end md:items-center px-4 md:px-10 pb-10 md:pb-0">
              <motion.article
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ amount: 0.6 }}
                transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
                className="relative z-10 w-full max-w-md rounded-lg border border-white/10 bg-black/55 backdrop-blur-md p-6 md:p-8"
              >
                <p className="font-mono text-xs uppercase tracking-widest text-[#F5C518] mb-3">
                  {String(i + 1).padStart(2, "0")} / {String(CHAPTER_COUNT).padStart(2, "0")} · {ch.label}
                </p>
                <h2 className="text-xl md:text-2xl font-medium tracking-tight leading-snug mb-3">{ch.title}</h2>
                <p className="text-sm leading-relaxed text-white/70">{ch.body}</p>

                {i === 0 && (
                  <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
                    {STATS.map((s) => (
                      <div key={s.label}>
                        <dt className="sr-only">{s.label}</dt>
                        <dd className="text-xl md:text-2xl font-medium tabular-nums">
                          {s.value}
                          <span className="text-sm text-white/50 ml-0.5">{s.unit}</span>
                        </dd>
                        <p className="text-[11px] leading-tight text-white/50 mt-1">{s.label}</p>
                      </div>
                    ))}
                  </dl>
                )}

                {i === 1 && (
                  <div className="mt-5 border-t border-white/10 pt-4 text-xs text-white/60">
                    {topRegions.length ? (
                      <>
                        <p className="mb-2">Column height shows live tree-cover loss since 2001. Highest:</p>
                        <ul className="space-y-1">
                          {topRegions.map((r) => (
                            <li key={r.region} className="flex justify-between tabular-nums">
                              <span className="text-white/80">{r.region}</span>
                              <span>{Math.round(r.kha).toLocaleString()} kha</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p>Column heights here are placeholders. Live figures for every region load in the dashboard.</p>
                    )}
                  </div>
                )}

                {i === 4 && (
                  <div className="mt-5 border-t border-white/10 pt-4 flex items-baseline gap-3">
                    <span className="text-4xl font-medium tabular-nums text-[#F5C518]">{year}</span>
                    <span className="text-xs text-white/50">{year > 2025 ? "trend projection" : "recorded loss"}</span>
                  </div>
                )}

                {i === 5 && (
                  <ul className="mt-5 flex flex-wrap gap-2">
                    {SPECIES.map((s) => (
                      <li key={s} className="text-[11px] rounded-full border border-emerald-400/30 text-emerald-300 px-3 py-1">
                        {s}
                      </li>
                    ))}
                  </ul>
                )}

                {i === CHAPTER_COUNT - 1 && (
                  <Link
                    href="/dashboard"
                    className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-black px-6 py-3 bg-gradient-to-br from-[#FFE88C] via-[#F5C518] to-[#B8860B] hover:from-[#FFF4B3] hover:via-[#FFD94A] hover:to-[#D4A017] transition-all"
                  >
                    Start mission
                    <ArrowRight size={14} />
                  </Link>
                )}

                {liveNote(i, story, nearest) && <p className="mt-4 text-[11px] text-white/55">{liveNote(i, story, nearest)}</p>}
                {ch.note && <p className="mt-4 text-[11px] text-white/40">{ch.note}</p>}
              </motion.article>
            </div>
          ))}
        </div>
      </section>

      <AudienceSection />
      <SourcesSection />
    </>
  );
}

const AUDIENCES = [
  {
    who: "Forest and wildlife officers",
    what: "Send patrols where risk is rising and respond to chainsaw detections while they are still happening.",
  },
  {
    who: "Conservation groups",
    what: "Decide which sites to protect first and plan restoration that connects back to intact forest.",
  },
  {
    who: "Cocoa and timber exporters",
    what: "Check the deforestation risk of a sourcing location before it becomes a compliance problem (EUDR).",
  },
  {
    who: "Communities and researchers",
    what: "Use open data for every region, and put a spare phone to work as a forest listener.",
  },
];

function AudienceSection() {
  return (
    <section className="relative z-[2] bg-[#0b0d10] text-white px-4 md:px-10 py-24 md:py-32 border-t border-white/5">
      <div className="max-w-6xl mx-auto">
        <p className="font-mono text-xs uppercase tracking-widest text-[#F5C518] mb-3">Who it&apos;s for</p>
        <h2 className="text-2xl md:text-4xl font-medium tracking-tight mb-12 max-w-2xl">
          One map for everyone who has a stake in Ghana&apos;s forests.
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-white/10 border border-white/10">
          {AUDIENCES.map((a, i) => (
            <motion.div
              key={a.who}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ delay: i * 0.08, duration: 0.45 }}
              className="bg-[#0b0d10] p-6 md:p-8"
            >
              <h3 className="text-base font-medium mb-2">{a.who}</h3>
              <p className="text-sm leading-relaxed text-white/60">{a.what}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SOURCES = ["Global Forest Watch", "NASA FIRMS", "NASA POWER", "NASA GIBS", "GBIF", "Google Gemini"];

function SourcesSection() {
  return (
    <section className="relative z-[2] bg-[#0b0d10] text-white px-4 md:px-10 pb-24 md:pb-32">
      <div className="max-w-6xl mx-auto border-t border-white/10 pt-12 flex flex-col md:flex-row md:items-end md:justify-between gap-10">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-white/40 mb-4">Built on open data</p>
          <ul className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-white/70">
            {SOURCES.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-white/40 max-w-xl leading-relaxed">
            The risk model&apos;s weights are set from published research, not trained on data, and the 2035 line
            continues the last ten years&apos; trend. Aniwa says so in the dashboard wherever it matters.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center gap-2 text-sm font-medium text-black px-8 py-4 bg-gradient-to-br from-[#FFE88C] via-[#F5C518] to-[#B8860B] hover:from-[#FFF4B3] hover:via-[#FFD94A] hover:to-[#D4A017] transition-all shadow-[0_4px_20px_rgba(245,197,24,0.35)] shrink-0"
        >
          Start mission
          <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}
