"use client";

import { useMemo, useState } from "react";
import { PawPrint, Info, ArrowRight, Eye, EyeOff } from "lucide-react";
import type { SpeciesResult } from "@/lib/species";
import { nearestIntactForest } from "@/lib/reforestation";
import { distanceKm } from "@/lib/geo";
import type { RegionLoss } from "@/lib/deforestation";

interface SpeciesPanelProps {
  selectedRegion: string | null;
  results: SpeciesResult[];
  loading: boolean;
  hiddenSpecies: Set<string>;
  regions: RegionLoss[];
  onToggleSpecies: (scientificName: string) => void;
}

const SPECIES_COLORS = ["#f97316", "#a855f7", "#06b6d4"];
const NEARBY_RADIUS_KM = 80;

export default function SpeciesPanel({ selectedRegion, results, loading, hiddenSpecies, regions, onToggleSpecies }: SpeciesPanelProps) {
  const [showMethodology, setShowMethodology] = useState(false);

  const region = regions.find((r) => r.region === selectedRegion);
  const regionCentroid = useMemo(() => (region ? { lat: region.lat, lng: region.lng } : null), [region]);

  const target = useMemo(() => (regionCentroid ? nearestIntactForest(regionCentroid) : null), [regionCentroid]);

  const nearbyPerSpecies = useMemo(() => {
    if (!regionCentroid) return null;
    return results.map((r) => ({
      ...r,
      nearbyCount: r.occurrences.filter((o) => distanceKm(regionCentroid, o) <= NEARBY_RADIUS_KM).length,
    }));
  }, [results, regionCentroid]);

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <PawPrint size={14} className="text-orange-400" />
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/50">Endangered species</p>
      </div>

      {loading ? (
        <p className="text-xs text-white/40">Loading species occurrence data…</p>
      ) : (
        <div className="space-y-2">
          {results.map((r, i) => {
            const nearby = nearbyPerSpecies?.[i]?.nearbyCount;
            const hidden = hiddenSpecies.has(r.species.scientificName);
            return (
              <div key={r.species.scientificName} className={`border border-white/10 px-3 py-2.5 ${hidden ? "opacity-40" : ""}`}>
                <div className="flex gap-3">
                  {r.photo && (
                    <img
                      src={r.photo.url}
                      alt={r.species.commonName}
                      className="w-16 h-16 object-cover border border-white/10 shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SPECIES_COLORS[i] }} />
                        <span className="text-sm text-white font-medium">{r.species.commonName}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] uppercase tracking-wider text-red-300/80 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded-sm">
                          {r.species.iucnStatus}
                        </span>
                        <button
                          onClick={() => onToggleSpecies(r.species.scientificName)}
                          title={hidden ? "Show on map" : "Hide from map"}
                          className="text-white/40 hover:text-white transition-colors"
                        >
                          {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-white/50 mt-1">
                      {r.totalCount} sighting{r.totalCount === 1 ? "" : "s"} in Ghana
                      {selectedRegion && typeof nearby === "number" && <> · {nearby} within {NEARBY_RADIUS_KM} km</>}
                    </p>
                  </div>
                </div>
                {r.photo && (
                  <p className="text-[10px] text-white/30 mt-1.5">
                    {r.photo.year ?? ""} {r.photo.basisOfRecord === "PRESERVED_SPECIMEN" ? "· museum specimen, not live" : ""}
                    {!r.photo.fromGhana && r.photo.country ? ` · ${r.photo.country}, not Ghana` : ""}
                  </p>
                )}
                {!r.photo && <p className="text-[10px] text-white/30 mt-1.5">No photo exists anywhere — this rare.</p>}
              </div>
            );
          })}
        </div>
      )}

      {region && regionCentroid && target && (
        <div className="mt-3 border border-green-500/20 bg-green-500/5 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.22em] text-green-300/80 mb-1.5 flex items-center gap-1">
            <ArrowRight size={11} /> Nearest refuge
          </p>
          <p className="text-xs text-white/70">
            <span className="text-white font-medium">{target.name}</span>, ~{target.distanceKm.toFixed(0)} km from {region.region}
          </p>
        </div>
      )}

      {!selectedRegion && (
        <p className="text-[11px] text-white/30 mt-3">Select a region in the Deforestation tab for nearby sightings.</p>
      )}

      <button
        onClick={() => setShowMethodology((v) => !v)}
        className="mt-4 flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white transition-colors"
      >
        <Info size={12} />
        {showMethodology ? "Hide" : "Show"} methodology
      </button>
      {showMethodology && (
        <ul className="mt-2 space-y-1.5 text-[11px] text-white/50 leading-relaxed list-disc list-inside">
          <li>Live GBIF data (api.gbif.org), capped at 50 records/species for map performance — the total count is uncapped.</li>
          <li>&quot;Nearby&quot; = straight-line distance from the region&apos;s center, a proxy, not a habitat-range model.</li>
          <li>Refuge = nearest of 4 named protected areas (Kakum, Ankasa, Bia, Digya), not a modeled migration path.</li>
          <li>Photos are real GBIF-linked media, preferring a Ghana record and falling back to the nearest documented one elsewhere — never a stock photo.</li>
        </ul>
      )}
    </div>
  );
}
