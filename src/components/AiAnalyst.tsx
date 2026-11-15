"use client";

import { useState } from "react";
import { Sparkles, Send, Loader2, AlertTriangle } from "lucide-react";

// Renders the analyst's short bullet answers: "- " lines become bullets and
// **text** becomes bold. Anything else is shown as a plain paragraph.
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong> : part,
  );
}

export function Answer({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-white/80">
      {lines.map((line, i) =>
        /^[-*•]\s+/.test(line) ? (
          <p key={i} className="flex gap-2">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            <span>{renderInline(line.replace(/^[-*•]\s+/, ""))}</span>
          </p>
        ) : (
          <p key={i}>{renderInline(line.replace(/^#+\s*/, ""))}</p>
        ),
      )}
    </div>
  );
}

const SUGGESTIONS = ["Which region needs action first?", "What happens by 2035 if nothing changes?", "Are the fires a sign of clearing?"];

export default function AiAnalyst() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function ask(q: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAnswer(data.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Folded to one slim bar until someone wants it, to keep the page calm.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-2.5 text-left text-[13px] text-white/80 transition-colors hover:bg-emerald-500/10"
      >
        <Sparkles size={15} className="text-emerald-400" />
        <span className="flex-1">Ask the AI analyst about deforestation in Ghana</span>
        <span className="text-[11px] text-emerald-300">Open</span>
      </button>
    );
  }

  return (
    <section className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.07] to-[#0f172a]/80 px-4 py-3.5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2 lg:w-48 lg:shrink-0">
          <Sparkles size={16} className="text-emerald-400" />
          <div>
            <p className="text-[13px] font-medium text-white">AI analyst</p>
            <p className="text-[11px] text-white/55">Gemini, using the live data below</p>
          </div>
        </div>
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) ask(question.trim());
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about deforestation in Ghana…"
            maxLength={500}
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-gray-900/80 px-3 py-2 text-sm text-white placeholder-white/50 focus:border-emerald-400/60 focus:outline-none"
          />
          <button type="submit" disabled={loading || !question.trim()} className="rounded-lg border border-white/15 px-3 text-white/70 transition hover:text-white disabled:opacity-40" aria-label="Ask">
            <Send size={15} />
          </button>
          <button
            type="button"
            onClick={() => ask("")}
            disabled={loading}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Brief me
          </button>
        </form>
      </div>

      {!answer && !loading && !error && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setQuestion(s); ask(s); }}
              className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition hover:border-white/25 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {loading && <p className="mt-3 flex items-center gap-1.5 text-[12px] text-white/55"><Loader2 size={12} className="animate-spin" /> Reading the live data…</p>}
      {error && <p className="mt-3 flex items-start gap-1.5 text-[12px] text-amber-200/85"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}</p>}
      {answer && !loading && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <Answer text={answer} />
          <p className="mt-2 text-[11px] text-white/50">AI-written from the dashboard&apos;s data. Check key figures before quoting them.</p>
        </div>
      )}
    </section>
  );
}
