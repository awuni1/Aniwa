"use client";

import { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, useInView, useScroll, useTransform, useSpring, AnimatePresence } from "framer-motion";
import { Menu, X, Moon, Sun } from "lucide-react";
import PlatformStory from "@/components/PlatformStory";

// Start fetching the hero GLB in parallel with the JS bundle instead of after
// Three.js parses. React 19 hoists this to <head> during SSR.
ReactDOM.preload("/sentinel.glb", { as: "fetch", crossOrigin: "anonymous" });

// Defer the 3D hero scene, it imports Three.js (~500KB) and blocks first paint
// if bundled in the initial chunk. Loads as soon as the main thread is idle.
const HeroScene = dynamic(() => import("@/components/HeroScene"), {
  ssr: false,
  loading: () => null,
});

// Scroll Progress Bar
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });

  return (
    <motion.div
      style={{ scaleX }}
      className="fixed top-0 left-0 right-0 h-[2px] bg-orange-500 origin-left z-[60]"
    />
  );
}

// Custom Cursor - CSS-based for performance
function CustomCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Skip on touch devices
    if (window.matchMedia("(pointer: coarse)").matches) {
      return;
    }

    const cursor = cursorRef.current;
    if (!cursor) return;

    const onMouseMove = (e: MouseEvent) => {
      cursor.style.setProperty("--x", `${e.clientX}px`);
      cursor.style.setProperty("--y", `${e.clientY}px`);
    };

    const onMouseEnter = () => cursor.style.opacity = "1";
    const onMouseLeave = () => cursor.style.opacity = "0";

    window.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseenter", onMouseEnter);
    document.addEventListener("mouseleave", onMouseLeave);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseenter", onMouseEnter);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  // Hide on touch devices via CSS
  return (
    <div
      ref={cursorRef}
      className="fixed pointer-events-none z-[100] mix-blend-difference hidden md:block"
      style={{
        left: "var(--x, -100px)",
        top: "var(--y, -100px)",
        transform: "translate(-50%, -50%)",
        opacity: 0,
      }}
    >
      <div className="w-3 h-3 bg-white rounded-full" />
    </div>
  );
}

// Dark Mode Toggle
function DarkModeToggle() {
  const [isDark, setIsDark] = useState(true); // Default to dark

  useEffect(() => {
    // Set dark mode as default on mount
    document.documentElement.classList.add("dark");
    setIsDark(true);
  }, []);

  const toggleDarkMode = () => {
    document.documentElement.classList.toggle("dark");
    setIsDark(!isDark);
  };

  return (
    <button
      onClick={toggleDarkMode}
      className="p-2 text-black/40 hover:text-black dark:text-white/40 dark:hover:text-white transition-colors"
      aria-label="Toggle dark mode"
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

// Parallax Image wrapper
function ParallaxImage({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], ["-5%", "5%"]);

  return (
    <div ref={ref} className="overflow-hidden w-full h-full">
      <motion.img
        src={src}
        alt={alt}
        style={{ y }}
        className={`w-full h-[110%] object-cover ${className}`}
      />
    </div>
  );
}

// Tick mark section divider
function TickDivider() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const tickCount = 80;

  // Generate random heights and delays with seeded randomness for consistency
  const ticks = Array.from({ length: tickCount }).map((_, i) => {
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const random = seed - Math.floor(seed);
    const height = 10 + random * 20; // 10-30px height variation
    const delayOffset = (Math.sin(i * 0.5) * 0.5 + 0.5) * 0.3; // Wave-like stagger
    return { height, delayOffset };
  });

  return (
    <div ref={ref} className="w-full py-16 overflow-hidden">
      <div className="relative h-8 flex items-center justify-between">
        {ticks.map((tick, i) => (
          <motion.div
            key={i}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={isInView ? { scaleY: 1, opacity: 0.15 } : { scaleY: 0, opacity: 0 }}
            transition={{
              duration: 0.4,
              delay: (i / tickCount) * 0.6 + tick.delayOffset,
              ease: [0.25, 0.1, 0.25, 1],
            }}
            style={{ height: tick.height }}
            className="w-px bg-orange-500 origin-center"
          />
        ))}
      </div>
    </div>
  );
}

// Staggered text animation - reveals words one by one
function AnimatedText({
  children,
  className = "",
  delay = 0,
  stagger = 0.03
}: {
  children: string;
  className?: string;
  delay?: number;
  stagger?: number;
}) {
  const words = children.split(" ");

  return (
    <span className={className}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.4,
            delay: delay + (i * stagger),
            ease: [0.25, 0.1, 0.25, 1]
          }}
          className="inline-block mr-[0.25em]"
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

// Scroll-triggered staggered text
function AnimatedTextOnScroll({
  children,
  className = "",
  stagger = 0.02
}: {
  children: string;
  className?: string;
  stagger?: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const words = children.split(" ");

  return (
    <span ref={ref} className={className}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{
            duration: 0.35,
            delay: i * stagger,
            ease: [0.25, 0.1, 0.25, 1]
          }}
          className="inline-block mr-[0.25em]"
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

// Counter animation for numbers
function Counter({
  value,
  className = ""
}: {
  value: string;
  className?: string;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const [displayValue, setDisplayValue] = useState("00");
  const targetNum = parseInt(value, 10);

  useEffect(() => {
    if (!isInView) return;

    let current = 0;
    const duration = 600; // ms
    const steps = 15;
    const increment = targetNum / steps;
    const stepDuration = duration / steps;

    const timer = setInterval(() => {
      current += increment;
      if (current >= targetNum) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(String(Math.floor(current)).padStart(2, "0"));
      }
    }, stepDuration);

    return () => clearInterval(timer);
  }, [isInView, targetNum, value]);

  return (
    <span ref={ref} className={className}>
      {displayValue}
    </span>
  );
}

// Typewriter/Scramble effect for section labels (scroll-triggered)
function ScrambleText({
  children,
  className = "",
  delay = 0
}: {
  children: string;
  className?: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const [displayText, setDisplayText] = useState("");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  useEffect(() => {
    if (!isInView) return;

    const text = children;
    let iteration = 0;
    const totalIterations = text.length * 3; // 3 scramble cycles per character

    const timeout = setTimeout(() => {
      const interval = setInterval(() => {
        setDisplayText(
          text
            .split("")
            .map((char, index) => {
              if (char === " ") return " ";
              if (index < iteration / 3) {
                return text[index];
              }
              return chars[Math.floor(Math.random() * chars.length)];
            })
            .join("")
        );

        iteration++;

        if (iteration > totalIterations) {
          setDisplayText(text);
          clearInterval(interval);
        }
      }, 30);

      return () => clearInterval(interval);
    }, delay * 1000);

    return () => clearTimeout(timeout);
  }, [isInView, children, delay]);

  return (
    <span ref={ref} className={className}>
      {displayText || children.split("").map(() => " ").join("")}
    </span>
  );
}

// Scan reveal button - hover triggered
function GlitchButton({
  children,
  href,
  className = ""
}: {
  children: React.ReactNode;
  href: string;
  className?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.1, duration: 0.5 }}
      className="relative inline-block overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Scan line effect on hover */}
      <motion.div
        initial={{ x: "-100%" }}
        animate={{ x: isHovered ? "100%" : "-100%" }}
        transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent z-10 pointer-events-none"
      />
      <a
        href={href}
        className={`relative inline-flex items-center gap-2 ${className}`}
      >
        {children}
      </a>
    </motion.div>
  );
}

type ModalKey = "problem" | "solution";

export default function LandingPage() {
  const [activeModal, setActiveModal] = useState<ModalKey | null>(null);

  // ESC closes the modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  return (
    <div className="min-h-screen bg-white dark:bg-[#1F2124] text-black dark:text-white transition-colors duration-300">
      {/* Scroll Progress */}

      {/* Noise Overlay */}
      <div className="fixed inset-0 pointer-events-none z-[1] opacity-[0.015] dark:opacity-[0.03]">
        <div className="absolute inset-0 bg-noise" />
      </div>

      {/* Grid Background */}
      <div className="fixed inset-0 pointer-events-none z-[0] opacity-[0.03] dark:opacity-[0.05]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* Minimal nav */}
      <nav className="fixed top-6 left-0 right-0 z-50 px-4 md:px-10 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
          <img src="/logo.png" alt="" width={32} height={32} className="h-8 w-8" />
          Aniwa
        </Link>
        <div className="flex items-center gap-3 md:gap-6">
          {(["problem", "solution"] as ModalKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setActiveModal(key)}
              className="relative text-xs uppercase tracking-wider text-white/60 hover:text-white transition-colors capitalize after:content-[''] after:absolute after:left-0 after:-bottom-1 after:h-[2px] after:w-0 hover:after:w-full after:transition-all after:duration-300 after:bg-gradient-to-r after:from-[#FFE88C] after:via-[#F5C518] after:to-[#B8860B]"
            >
              {key}
            </button>
          ))}
        </div>
      </nav>

      {/* Hero */}
      <section className="min-h-screen relative overflow-hidden pt-14">
        {/* Background image with slow zoom (Ken Burns) */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          <motion.img
            src="https://images.unsplash.com/photo-1534996858221-380b92700493?q=80&w=2662&auto=format&fit=crop"
            alt="Earth from space"
            className="absolute inset-0 w-full h-full object-cover"
            initial={{ scale: 1 }}
            animate={{ scale: 1.15 }}
            transition={{ duration: 30, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
          />
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/60" />
        </div>

        {/* Full-bleed 3D satellite */}
        <div className="absolute inset-0 z-[1]">
          <HeroScene />
        </div>

        {/* Headline anchored to very bottom-left */}
        <div className="absolute bottom-28 md:bottom-8 left-4 md:left-8 right-4 md:right-auto z-10 max-w-4xl">
          <h1 className="text-[clamp(2.25rem,6vw,4.5rem)] font-medium tracking-tight leading-[1.05] text-white mb-6">
            <AnimatedText delay={0.2} stagger={0.06}>
              Deforestation, tracked
            </AnimatedText>
            <br />
            <AnimatedText delay={0.5} stagger={0.06}>
              before it&apos;s irreversible
            </AnimatedText>
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2, duration: 0.6 }}
            className="text-sm md:text-base text-white/70 leading-relaxed max-w-2xl"
          >
            Real published forest-loss data across all 16 regions, a basic predictive model for clearing risk
            anywhere in the country, live endangered-species tracking, and a reforestation site recommender.
          </motion.p>
        </div>

      </section>

      {/* Scroll walkthrough: what Aniwa is, chapter by chapter */}
      <PlatformStory />

      <Modal activeKey={activeModal} onClose={() => setActiveModal(null)} />
    </div>
  );
}

// Modal + content
const MODAL_CONTENT: Record<ModalKey, { title: string; body: React.ReactNode }> = {
  problem: {
    title: "The problem",
    body: (
      <>
        <p>
          Ghana lost 1.9 million hectares of tree cover between 2001 and 2025 — 27% of its year-2000 cover, and
          1.1 billion tonnes of CO2e with it. Most of that loss is permanent: agricultural conversion, mining, and
          settlement expansion, not the kind of disturbance that grows back.
        </p>
        <p>
          The published data (Global Nature Watch, formerly Global Forest Watch) only breaks five regions out
          individually. The other eleven, and anywhere between those regions, are a blind spot in the public
          summary — exactly where early clearing is hardest to see coming.
        </p>
        <p className="text-white/90">
          We want a tool that covers the whole country, not just the five best-documented regions, and that can
          say something about risk at a specific point before the clearing shows up in next year&apos;s statistics.
        </p>
      </>
    ),
  },
  solution: {
    title: "How it works",
    body: (
      <>
        <p>
          National and regional figures are real published statistics (Global Nature Watch), bundled as cited
          reference data — not a live feed, since the underlying Hansen dataset isn&apos;t practically queryable
          without Google Earth Engine access. A carbon/CO2e calculator and an EUDR compliance-risk flag run on top
          of those real numbers.
        </p>
        <p>
          A basic predictive model — logistic regression over two real geographic features (proximity to a known
          high-loss region, proximity to remaining intact forest) — estimates deforestation risk at any point you
          click, anywhere in Ghana. The weights are literature-informed, not fitted on a training set; we say so
          directly in the model&apos;s own methodology panel.
        </p>
        <p>
          Endangered-species occurrence data comes live from GBIF (free, public, no key) for three critically
          endangered species tracked in Ghana&apos;s forest zone, with a habitat-displacement pointer to the nearest
          intact-forest refuge. A reforestation-site recommender scores candidate locations by restoration need and
          ecological connectivity to that same refuge.
        </p>
      </>
    ),
  },
};

function Modal({
  activeKey,
  onClose,
}: {
  activeKey: ModalKey | null;
  onClose: () => void;
}) {
  const content = activeKey ? MODAL_CONTENT[activeKey] : null;
  return (
    <AnimatePresence>
      {content && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="bg-[#17191c] border border-white/10 rounded-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-8 pt-8 pb-4">
              <h2 className="text-2xl font-medium tracking-tight text-white">
                {content.title}
              </h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="text-white/40 hover:text-white transition-colors p-1 -mr-1"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-8 pb-8 space-y-4 text-sm leading-relaxed text-white/75">
              {content.body}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
