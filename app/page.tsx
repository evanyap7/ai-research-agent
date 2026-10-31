"use client";

import { useState, useEffect, type FormEvent, useRef } from "react";
import ReactMarkdown from "react-markdown";
import {
  Search,
  Sparkles,
  ShieldCheck,
  BookOpen,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Key,
  RefreshCw,
  FileText,
  Globe,
  Database,
  Layers,
  X,
  Building2,
  Zap,
  Leaf,
  Sliders,
  Ship,
  Wind,
  Gauge,
} from "lucide-react";

type Finding = {
  claim: string;
  sourceIds: string[];
  confidence?: "high" | "medium" | "low";
};

type EvidenceItem = {
  claim: string;
  sourceIds: string[];
  confidence?: "high" | "medium" | "low";
};

type TopicResult = {
  mode: "topic";
  answer: string;
  findings: Finding[];
  limitations?: string[];
  sourcesUsed?: string[];
};

type ClaimResult = {
  mode: "claim";
  claim: string;
  verdict: "VERIFIED" | "REFUTED" | "UNVERIFIED";
  truthRating: number;
  reasoning: string;
  supportingEvidence: EvidenceItem[];
  contradictingEvidence: EvidenceItem[];
  limitations?: string[];
  sourcesUsed?: string[];
};

type SourceMetadata = {
  id: string;
  title: string;
  url: string;
  text: string;
};

type ResearchResponse = {
  result: TopicResult | ClaimResult;
  sources: SourceMetadata[];
};

type UniversCategory = "ports" | "hvac" | "buildings" | "sbti" | "renewables";

const UNIVERS_DOMAINS: { id: UniversCategory; label: string; icon: typeof Ship }[] = [
  { id: "ports", label: "Ports & Terminals", icon: Ship },
  { id: "hvac", label: "HVAC & Chiller Plants", icon: Wind },
  { id: "buildings", label: "Commercial Real Estate", icon: Building2 },
  { id: "sbti", label: "SBTi & Decarbonization", icon: Leaf },
  { id: "renewables", label: "Renewables & Microgrids", icon: Zap },
];

const UNIVERS_SAMPLE_PROMPTS: Record<
  UniversCategory,
  {
    topic: { label: string; question: string };
    claim: { label: string; question: string };
  }
> = {
  ports: {
    topic: {
      label: "MTL (Modern Terminals) Energy & HVAC",
      question:
        "Research Modern Terminals Limited (MTL)'s sustainability reports, terminal energy consumption, HVAC efficiency, and 2030 net-zero targets",
    },
    claim: {
      label: "HACTL SBTi Commitment",
      question:
        "Hong Kong Air Cargo Terminals Limited (HACTL) has committed to Science Based Targets initiative (SBTi) with approved greenhouse gas reduction targets",
    },
  },
  hvac: {
    topic: {
      label: "Chiller COP & Chilled Water Optimization",
      question:
        "What are the baseline coefficient of performance (COP) ranges and chilled water delta-T benchmarks for commercial water-cooled centrifugal chillers in subtropical climates?",
    },
    claim: {
      label: "VFD HVAC Energy Savings",
      question:
        "Variable Frequency Drive (VFD) retrofits on primary chilled water pumps can reduce motor energy consumption by 20% to 50% under partial load conditions",
    },
  },
  buildings: {
    topic: {
      label: "Swire Properties Decarbonization Pathway",
      question:
        "Analyze Swire Properties' latest sustainability disclosures on commercial building energy intensity, tenant electricity usage, and Scope 1 & 2 reduction targets",
    },
    claim: {
      label: "Airport Authority Net Zero 2050",
      question:
        "Airport Authority Hong Kong (AAHK) and HKIA have pledged to achieve Net Zero Carbon operations across their terminal buildings and airfield by 2050",
    },
  },
  sbti: {
    topic: {
      label: "Scope 3 Port Logistics Baselines",
      question:
        "How do major port operators (e.g. Modern Terminals, PSA, DP World) account for Scope 3 emissions from visiting container vessels and tenant drayage trucks?",
    },
    claim: {
      label: "MTR SBTi 1.5°C Alignment",
      question:
        "MTR Corporation has set science-based carbon reduction targets validated by SBTi aligned with a 1.5°C trajectory for rail and property operations",
    },
  },
  renewables: {
    topic: {
      label: "HK Feed-in Tariff & Rooftop Solar PV",
      question:
        "What are the current CLP and HK Electric Feed-in Tariff (FiT) rates and average payback periods for commercial rooftop solar PV installations in Hong Kong?",
    },
    claim: {
      label: "BESS Industrial Peak Shaving",
      question:
        "Battery Energy Storage Systems (BESS) installed at industrial facilities can reduce peak demand charges on commercial maximum demand tariffs by over 15%",
    },
  },
};

const LOADING_STAGES = [
  {
    title: "Client & Acronym Resolution",
    desc: "Resolving Univers client entities (MTL, HACTL, AAHK) into official corporate profiles...",
  },
  {
    title: "Multi-Engine Disclosures Gathering",
    desc: "Scanning sustainability report repositories, open-access PDFs, and corporate portals...",
  },
  {
    title: "SPA & PDF Document Ingestion",
    desc: "Rendering client-side Single Page Applications & parsing attached annual ESG disclosures...",
  },
  {
    title: "Decarbonization Synthesis",
    desc: "Grounding energy statistics, kWh consumption, COP ratings, and baseline years with citations...",
  },
];

export default function Home() {
  const [mode, setMode] = useState<"topic" | "claim">("topic");
  const [selectedDomain, setSelectedDomain] = useState<UniversCategory>("ports");
  const [question, setQuestion] = useState("");
  const [customUrlInput, setCustomUrlInput] = useState("");
  const [showCustomUrls, setShowCustomUrls] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [error, setError] = useState("");
  const [selectedSource, setSelectedSource] = useState<SourceMetadata | null>(null);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const savedKey =
      localStorage.getItem("groq_api_key") ||
      localStorage.getItem("gemini_api_key");
    // Read after mount: a lazy useState initializer would cause an SSR hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedKey) setApiKey(savedKey);
  }, []);

  // Multi-step loading progression effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restart the stage ticker on each run
      setLoadingStep(0);
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev < LOADING_STAGES.length - 1 ? prev + 1 : prev));
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [loading]);

  function handleApiKeyChange(val: string) {
    setApiKey(val);
    if (val.trim()) {
      localStorage.setItem("groq_api_key", val.trim());
      localStorage.setItem("gemini_api_key", val.trim());
    } else {
      localStorage.removeItem("groq_api_key");
      localStorage.removeItem("gemini_api_key");
    }
  }

  async function runResearch(event?: FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    if (!question.trim() || loading) return;

    setLoading(true);
    setData(null);
    setError("");
    setSelectedSource(null);

    const customUrls = customUrlInput
      .split(/[\n,]/)
      .map((url) => url.trim())
      .filter((url) => url.length > 0);

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: question.trim(),
          mode,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(customUrls.length > 0 ? { customUrls } : {}),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Research request failed.");
      }

      setData(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg);
      if (msg.includes("API key")) {
        setShowSettingsModal(true);
      }
    } finally {
      setLoading(false);
    }
  }

  function sourceFor(id: string) {
    return data?.sources.find((source) => source.id === id);
  }

  function copyMarkdownReport() {
    if (!data) return;
    let report = `# UNIVERS Research Brief: ${question}\n\n`;
    report += `**Prepared for**: Univers Decarbonization Engineers & ESG Consultants\n`;
    report += `**Generated**: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}\n\n`;

    if (data.result.mode === "topic") {
      report += `## Executive Synthesis\n\n${data.result.answer}\n\n`;
      if (data.result.findings.length > 0) {
        report += `## Key Facility & Decarbonization Findings\n\n`;
        for (const f of data.result.findings) {
          report += `- ${f.claim} (Sources: ${f.sourceIds.join(", ")})\n`;
        }
      }
    } else {
      report += `## Evaluated Claim\n\n**Claim**: ${data.result.claim}\n`;
      report += `**Verdict**: ${data.result.verdict} (Truth Rating: ${data.result.truthRating}%)\n\n`;
      report += `### Verification Rationale\n\n${data.result.reasoning}\n\n`;
      if (data.result.supportingEvidence.length > 0) {
        report += `### Direct Supporting Evidence\n`;
        for (const e of data.result.supportingEvidence) {
          report += `- ${e.claim} [${e.sourceIds.join(", ")}]\n`;
        }
      }
      if (data.result.contradictingEvidence.length > 0) {
        report += `\n### Contradicting Evidence\n`;
        for (const e of data.result.contradictingEvidence) {
          report += `- ${e.claim} [${e.sourceIds.join(", ")}]\n`;
        }
      }
    }

    if (data.result.limitations && data.result.limitations.length > 0) {
      report += `\n## Data Gaps & Telemetry Limitations\n\n`;
      for (const lim of data.result.limitations) {
        report += `- ${lim}\n`;
      }
    }

    if (data.sources.length > 0) {
      report += `\n## Verified Client Disclosures & Sources\n`;
      for (const s of data.sources) {
        report += `- [${s.id}] ${s.title} (${s.url})\n`;
      }
    }

    navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const activeSample = UNIVERS_SAMPLE_PROMPTS[selectedDomain][mode];

  return (
    <div className="relative min-h-screen bg-[#06080e] text-slate-100 flex flex-col justify-between overflow-x-hidden ambient-glow">
      {/* Background Decorative Energy Auroras */}
      <div className="pointer-events-none absolute -top-44 left-1/2 -translate-x-1/2 w-[1100px] h-[450px] bg-gradient-to-b from-emerald-500/15 via-cyan-500/10 to-transparent blur-3xl opacity-75" />
      <div className="pointer-events-none absolute top-96 -left-64 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl" />
      <div className="pointer-events-none absolute top-96 -right-64 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />

      {/* Top Univers Navigation Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-white/[0.08] bg-[#06080e]/85 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center space-x-3.5">
            {/* Univers Energy Logo Symbol */}
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-400 via-teal-500 to-cyan-400 p-[1.5px] shadow-lg shadow-emerald-500/20">
              <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-[#070b14]">
                <Zap className="h-4 w-4 text-emerald-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-base font-extrabold tracking-tight text-white font-mono">
                  UNIVERS
                </span>
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-300">
                  DECAB INTELLIGENCE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Client Decarbonization & Facility Energy Research Agent
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Univers Live Knowledge Badge */}
            <div className="hidden md:flex items-center space-x-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              <span>EnOS Entity Graph • Client Reports Active</span>
            </div>

            {/* Developed by Evan Yap Link */}
            <a
              href="https://www.linkedin.com/in/evanyapzhikai/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-1.5 text-xs font-medium text-emerald-300 transition-all hover:bg-emerald-500/20 hover:border-emerald-400/50 hover:text-white shadow-sm cursor-pointer group"
            >
              <span className="text-slate-400 group-hover:text-slate-200 hidden xs:inline">Developed by</span>
              <span className="font-semibold text-emerald-400 group-hover:text-emerald-300">Evan Yap</span>
              <ExternalLink className="h-3 w-3 text-emerald-400/80 group-hover:text-emerald-300 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>

            {/* API Key Modal Button */}
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center space-x-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:bg-white/[0.08] hover:text-white cursor-pointer"
            >
              <Key className="h-3.5 w-3.5 text-emerald-400" />
              <span className="hidden sm:inline">
                {apiKey ? "API Key Configured" : "Custom Key"}
              </span>
              {apiKey && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        {/* Univers Hero Section */}
        <section className="mb-7 text-center sm:mb-9">
          <div className="inline-flex flex-wrap items-center justify-center gap-2.5 mb-3.5">
            <div className="inline-flex items-center space-x-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs text-emerald-300 backdrop-blur-md shadow-inner">
              <Gauge className="h-3.5 w-3.5 text-emerald-400" />
              <span>Built for Univers Energy Engineers & Decarbonization Consultants</span>
            </div>
            <a
              href="https://www.linkedin.com/in/evanyapzhikai/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300 hover:border-emerald-400/50 hover:bg-emerald-500/10 hover:text-emerald-300 transition-all backdrop-blur-md cursor-pointer group"
            >
              <span>Developed by</span>
              <span className="font-semibold text-white group-hover:text-emerald-300 underline decoration-emerald-500/40 underline-offset-2">Evan Yap</span>
              <ExternalLink className="h-3 w-3 text-emerald-400" />
            </a>
          </div>

          <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">
            Client Facility &{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              Energy Research Engine
            </span>
          </h1>

          <p className="mx-auto mt-3 max-w-2xl text-xs text-slate-400 sm:text-base leading-relaxed">
            Audit client sustainability disclosures, benchmark commercial HVAC/chiller plants, investigate port terminal operations (MTL, HACTL), and verify SBTi carbon targets with cryptographic evidence.
          </p>

          {/* Mode Switcher */}
          <div className="mx-auto mt-6 flex max-w-md rounded-2xl border border-white/10 bg-[#0a0f1c]/90 p-1.5 shadow-2xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => {
                setMode("topic");
                setData(null);
                setError("");
              }}
              className={`flex flex-1 items-center justify-center space-x-2 rounded-xl py-2.5 text-xs font-semibold transition-all sm:text-sm cursor-pointer ${
                mode === "topic"
                  ? "bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-600/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <BookOpen className="h-4 w-4" />
              <span>Facility Due Diligence</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("claim");
                setData(null);
                setError("");
              }}
              className={`flex flex-1 items-center justify-center space-x-2 rounded-xl py-2.5 text-xs font-semibold transition-all sm:text-sm cursor-pointer ${
                mode === "claim"
                  ? "bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-600/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>ESG Claim Verification</span>
            </button>
          </div>
        </section>

        {/* Univers Domain Filter Tabs */}
        <section className="mb-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <Layers className="h-3.5 w-3.5 text-emerald-400" />
              <span>Univers Practice Areas & Client Segments:</span>
            </span>
          </div>

          <div className="flex overflow-x-auto pb-1 gap-2 scrollbar-none">
            {UNIVERS_DOMAINS.map((domain) => {
              const Icon = domain.icon;
              const isSelected = selectedDomain === domain.id;
              return (
                <button
                  key={domain.id}
                  type="button"
                  onClick={() => setSelectedDomain(domain.id)}
                  className={`flex shrink-0 items-center space-x-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    isSelected
                      ? "border border-emerald-500/50 bg-emerald-500/15 text-emerald-200 shadow-md shadow-emerald-500/10"
                      : "border border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/15 hover:bg-white/[0.06] hover:text-slate-200"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isSelected ? "text-emerald-400" : "text-slate-400"}`} />
                  <span>{domain.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Search Command Center */}
        <section className="relative rounded-2xl border border-white/[0.12] bg-[#090d18]/95 p-4 shadow-2xl backdrop-blur-2xl transition-all sm:p-6 focus-within:border-emerald-500/60 focus-within:ring-1 focus-within:ring-emerald-500/40">
          <form onSubmit={runResearch} className="space-y-4">
            <div className="relative">
              <label htmlFor="univers-query" className="sr-only">
                Facility Research Query
              </label>
              <textarea
                id="univers-query"
                ref={textareaRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    runResearch();
                  }
                }}
                placeholder={
                  mode === "topic"
                    ? "Enter any client or facility query (e.g. 'MTL's hvac consumption & 2030 targets' or 'HACTL terminal electricity savings')..."
                    : "Enter an ESG claim or target to verify against disclosures (e.g. 'MTL has committed to achieve no direct GHG emissions by 2030')..."
                }
                rows={3}
                className="w-full resize-none rounded-xl border border-transparent bg-transparent p-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition-all sm:text-base leading-relaxed"
              />
            </div>

            {/* Custom URLs Section (Collapsible) */}
            {showCustomUrls && (
              <div className="rounded-xl border border-white/10 bg-[#070a12]/80 p-3 text-xs transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-slate-300 flex items-center space-x-1.5">
                    <Database className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Target Client URLs / PDF Disclosures (Optional override)</span>
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Paste specific sustainability report or client webpage links
                  </span>
                </div>
                <textarea
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  placeholder="https://www.modernterminals.com/en/sustainability/&#10;https://www.hactl.com/en/sustainability/"
                  rows={2}
                  className="w-full rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-emerald-500/50"
                />
              </div>
            )}

            {/* Form Action Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowCustomUrls(!showCustomUrls)}
                  className={`inline-flex items-center space-x-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                    showCustomUrls || customUrlInput.trim()
                      ? "border border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                  }`}
                >
                  <Sliders className="h-3.5 w-3.5" />
                  <span>Manual Disclosures</span>
                  {customUrlInput.trim() && (
                    <span className="ml-1 rounded-full bg-cyan-500/30 px-1.5 text-[10px] font-bold text-cyan-200">
                      {customUrlInput.split(/[\n,]/).filter((u) => u.trim()).length}
                    </span>
                  )}
                </button>

                {question && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuestion("");
                      setData(null);
                      setError("");
                    }}
                    className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex items-center space-x-3">
                <span className="hidden text-[11px] text-slate-500 sm:inline">
                  Press <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">⌘</kbd> + <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
                </span>

                <button
                  type="submit"
                  disabled={!question.trim() || loading}
                  className="inline-flex items-center space-x-2 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-600 to-cyan-500 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-lg shadow-emerald-600/25 transition-all hover:scale-[1.02] hover:shadow-emerald-500/40 active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin text-white" />
                      <span>Auditing Sources...</span>
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" />
                      <span>{mode === "topic" ? "Run Client Audit" : "Verify Target"}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </section>

        {/* Univers Preset Query Card */}
        <section className="mt-4 flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs backdrop-blur-md">
          <div className="flex items-center space-x-2">
            <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="text-slate-300 font-medium">
              Suggested {UNIVERS_DOMAINS.find((d) => d.id === selectedDomain)?.label} Query:
            </span>
            <span className="text-emerald-300 font-semibold hidden md:inline">
              &ldquo;{activeSample.label}&rdquo;
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setQuestion(activeSample.question);
              if (textareaRef.current) textareaRef.current.focus();
            }}
            className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors cursor-pointer"
          >
            Insert Preset →
          </button>
        </section>

        {/* Error Notification */}
        {error && (
          <div className="mt-6 flex items-start space-x-3 rounded-2xl border border-red-500/30 bg-red-950/40 p-4 text-red-200 backdrop-blur-md">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-red-300">Research Pipeline Error</p>
              <p className="mt-1 text-xs text-red-300/80 leading-relaxed">{error}</p>
              {error.includes("API key") && (
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  className="mt-2 text-xs font-semibold text-white underline hover:no-underline"
                >
                  Configure AI Engine API Key →
                </button>
              )}
            </div>
          </div>
        )}

        {/* Multi-Step Pipeline Visualizer (When Loading) */}
        {loading && (
          <div className="mt-8 rounded-2xl border border-emerald-500/25 bg-[#090f1d]/90 p-6 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <RefreshCw className="h-4 w-4 animate-spin text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">
                  Univers Decarbonization Intelligence Engine in Progress
                </h3>
              </div>
              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                Phase {loadingStep + 1} of 4
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              {LOADING_STAGES.map((stage, idx) => {
                const isActive = idx === loadingStep;
                const isDone = idx < loadingStep;
                return (
                  <div
                    key={idx}
                    className={`rounded-xl border p-3 transition-all ${
                      isActive
                        ? "border-emerald-500/60 bg-emerald-500/10 shadow-lg shadow-emerald-500/10 animate-pulse"
                        : isDone
                        ? "border-teal-500/30 bg-teal-500/5 text-slate-300"
                        : "border-white/[0.05] bg-white/[0.02] text-slate-500"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                            isActive
                              ? "bg-emerald-500 text-white"
                              : "bg-white/10 text-slate-400"
                          }`}
                        >
                          {idx + 1}
                        </span>
                      )}
                      <h4
                        className={`text-xs font-semibold ${
                          isActive
                            ? "text-emerald-300"
                            : isDone
                            ? "text-slate-200"
                            : "text-slate-400"
                        }`}
                      >
                        {stage.title}
                      </h4>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400 line-clamp-2">
                      {stage.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Results Section */}
        {data && (
          <section className="mt-8 space-y-6 animate-in fade-in-50 duration-500">
            {/* Report Actions Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0a0f1c]/80 p-3.5 backdrop-blur-xl">
              <div className="flex items-center space-x-2.5">
                <span className="rounded-lg bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold text-emerald-300 uppercase tracking-wider font-mono">
                  {data.result.mode === "topic" ? "Univers Research Brief" : "Claim Audit Verdict"}
                </span>
                <span className="text-xs text-slate-400">
                  {data.sources.length} Disclosures Ingested
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={copyMarkdownReport}
                  className="inline-flex items-center space-x-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:bg-white/[0.08] hover:text-white cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Brief Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Export Univers Brief</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* TOPIC MODE SYNTHESIS */}
            {data.result.mode === "topic" && (
              <>
                {/* Executive Answer Card */}
                <div className="rounded-2xl border border-white/10 bg-[#090e1a]/95 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
                  <div className="flex items-center justify-between border-b border-white/[0.07] pb-4">
                    <div className="flex items-center space-x-2">
                      <FileText className="h-5 w-5 text-emerald-400" />
                      <h2 className="text-lg font-bold text-white tracking-tight">
                        Executive Decarbonization & Facility Synthesis
                      </h2>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      Target Entity Verified
                    </span>
                  </div>

                  <div className="prose-custom mt-5 leading-relaxed">
                    <ReactMarkdown>{data.result.answer}</ReactMarkdown>
                  </div>
                </div>

                {/* Key Grounded Findings Grid */}
                {data.result.findings && data.result.findings.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-[#090e1a]/95 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
                    <div className="flex items-center justify-between border-b border-white/[0.07] pb-4">
                      <div className="flex items-center space-x-2">
                        <Layers className="h-5 w-5 text-cyan-400" />
                        <h3 className="text-base font-bold text-white">
                          Verified Decarbonization & Operational Telemetry ({data.result.findings.length})
                        </h3>
                      </div>
                      <span className="text-xs text-slate-500 hidden sm:inline">
                        Click citation pills to inspect source text
                      </span>
                    </div>

                    <div className="mt-5 grid gap-3.5 md:grid-cols-2">
                      {data.result.findings.map((finding, idx) => (
                        <div
                          key={idx}
                          className="flex flex-col justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-4.5 transition-all hover:border-emerald-500/30 hover:bg-white/[0.04]"
                        >
                          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                            {finding.claim}
                          </p>

                          <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-white/[0.04] pt-2.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                              Disclosed In:
                            </span>
                            {finding.sourceIds.map((id) => {
                              const s = sourceFor(id);
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => s && setSelectedSource(s)}
                                  className="inline-flex items-center space-x-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-mono font-medium text-emerald-300 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                                >
                                  <span>[{id}]</span>
                                  <span className="max-w-[120px] truncate text-[10px]">
                                    {s?.title ?? id}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* CLAIM VERIFICATION MODE */}
            {data.result.mode === "claim" && (
              <>
                {/* Hero Verdict Plaque */}
                <div
                  className={`relative overflow-hidden rounded-2xl border p-6 sm:p-8 backdrop-blur-2xl shadow-2xl ${
                    data.result.verdict === "VERIFIED"
                      ? "border-emerald-500/40 bg-gradient-to-b from-emerald-950/60 to-[#090e1a]"
                      : data.result.verdict === "REFUTED"
                      ? "border-rose-500/40 bg-gradient-to-b from-rose-950/60 to-[#090e1a]"
                      : "border-amber-500/40 bg-gradient-to-b from-amber-950/60 to-[#090e1a]"
                  }`}
                >
                  <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center space-x-3">
                        <span
                          className={`inline-flex items-center space-x-1.5 rounded-full px-3 py-1 text-xs font-extrabold tracking-wider uppercase ${
                            data.result.verdict === "VERIFIED"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : data.result.verdict === "REFUTED"
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                              : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          }`}
                        >
                          {data.result.verdict === "VERIFIED" && (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {data.result.verdict === "REFUTED" && (
                            <XCircle className="h-4 w-4" />
                          )}
                          {data.result.verdict === "UNVERIFIED" && (
                            <HelpCircle className="h-4 w-4" />
                          )}
                          <span>{data.result.verdict}</span>
                        </span>
                      </div>

                      <h3 className="mt-3 text-lg font-bold text-white sm:text-2xl leading-snug">
                        &ldquo;{data.result.claim}&rdquo;
                      </h3>
                    </div>

                    {/* Truth Gauge Meter */}
                    <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-black/40 p-4 min-w-[150px]">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Evidence Confidence
                      </span>
                      <span className="mt-1 text-3xl font-extrabold font-mono text-white">
                        {data.result.truthRating}%
                      </span>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full transition-all duration-1000 ${
                            data.result.truthRating >= 75
                              ? "bg-emerald-500"
                              : data.result.truthRating <= 25
                              ? "bg-rose-500"
                              : "bg-amber-500"
                          }`}
                          style={{ width: `${data.result.truthRating}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Verification Rationale */}
                  <div className="mt-6 border-t border-white/[0.08] pt-5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Step-by-Step Engineering Rationale
                    </h4>
                    <div className="prose-custom mt-2 text-sm text-slate-300 leading-relaxed">
                      <ReactMarkdown>{data.result.reasoning}</ReactMarkdown>
                    </div>
                  </div>
                </div>

                {/* Evidence Dual Column Grid */}
                <div className="grid gap-6 md:grid-cols-2">
                  {/* Supporting Evidence */}
                  <div className="rounded-2xl border border-emerald-500/20 bg-[#071216]/80 p-6 backdrop-blur-xl">
                    <div className="flex items-center space-x-2 border-b border-emerald-500/20 pb-3">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <h4 className="text-sm font-bold text-emerald-200">
                        Direct Supporting Disclosures ({data.result.supportingEvidence.length})
                      </h4>
                    </div>

                    {data.result.supportingEvidence.length === 0 ? (
                      <p className="mt-4 text-xs text-slate-400 italic">
                        No direct supporting disclosures identified in the client reports.
                      </p>
                    ) : (
                      <ul className="mt-4 space-y-3">
                        {data.result.supportingEvidence.map((item, idx) => (
                          <li
                            key={idx}
                            className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.03] p-3 text-xs leading-relaxed text-slate-300"
                          >
                            <p>{item.claim}</p>
                            <div className="mt-2 flex items-center space-x-1">
                              {item.sourceIds.map((id) => {
                                const s = sourceFor(id);
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    onClick={() => s && setSelectedSource(s)}
                                    className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/30"
                                  >
                                    [{id}] {s?.title ? s.title.slice(0, 20) + "..." : id}
                                  </button>
                                );
                              })}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Contradicting Evidence */}
                  <div className="rounded-2xl border border-rose-500/20 bg-[#140a10]/80 p-6 backdrop-blur-xl">
                    <div className="flex items-center space-x-2 border-b border-rose-500/20 pb-3">
                      <XCircle className="h-4 w-4 text-rose-400" />
                      <h4 className="text-sm font-bold text-rose-200">
                        Contradicting Disclosures ({data.result.contradictingEvidence.length})
                      </h4>
                    </div>

                    {data.result.contradictingEvidence.length === 0 ? (
                      <p className="mt-4 text-xs text-slate-400 italic">
                        No contradicting evidence or target discrepancies identified.
                      </p>
                    ) : (
                      <ul className="mt-4 space-y-3">
                        {data.result.contradictingEvidence.map((item, idx) => (
                          <li
                            key={idx}
                            className="rounded-xl border border-rose-500/10 bg-rose-500/[0.03] p-3 text-xs leading-relaxed text-slate-300"
                          >
                            <p>{item.claim}</p>
                            <div className="mt-2 flex items-center space-x-1">
                              {item.sourceIds.map((id) => {
                                const s = sourceFor(id);
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    onClick={() => s && setSelectedSource(s)}
                                    className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-300 hover:bg-rose-500/30"
                                  >
                                    [{id}] {s?.title ? s.title.slice(0, 20) + "..." : id}
                                  </button>
                                );
                              })}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Limitations & Data Gaps Section */}
            {data.result.limitations && data.result.limitations.length > 0 && (
              <div className="rounded-2xl border border-amber-500/20 bg-[#120e06]/80 p-5 backdrop-blur-xl">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-amber-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                    Data Gaps & Missing Operational Telemetry
                  </h4>
                </div>
                <ul className="mt-2.5 list-disc list-inside text-xs text-amber-200/80 space-y-1 leading-relaxed">
                  {data.result.limitations.map((lim, idx) => (
                    <li key={idx}>{lim}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Retrieved Disclosures & Sources Grid */}
            {data.sources && data.sources.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-[#090e1a]/95 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-white/[0.07] pb-4">
                  <div className="flex items-center space-x-2">
                    <Globe className="h-5 w-5 text-emerald-400" />
                    <h3 className="text-base font-bold text-white">
                      Verified Client Disclosures & Reports ({data.sources.length})
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500">
                    Ingested via Official Reports, PDFs & Jina SPA Reader
                  </span>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {data.sources.map((source) => {
                    let hostname = "";
                    try {
                      hostname = new URL(source.url).hostname;
                    } catch {
                      hostname = "report-source";
                    }

                    return (
                      <div
                        key={source.id}
                        className="group flex flex-col justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] p-4.5 transition-all hover:border-emerald-500/40 hover:bg-white/[0.04]"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="rounded-md bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 font-mono text-xs font-bold text-emerald-300">
                              {source.id}
                            </span>
                            <span className="rounded bg-white/[0.06] px-2 py-0.5 text-[10px] font-mono text-slate-400">
                              {hostname}
                            </span>
                          </div>

                          <h4 className="mt-2.5 text-xs sm:text-sm font-semibold text-white line-clamp-2 leading-snug">
                            {source.title}
                          </h4>

                          <p className="mt-2 text-xs text-slate-400 line-clamp-3 leading-relaxed">
                            {source.text}
                          </p>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-white/[0.05] pt-3 text-xs">
                          <button
                            type="button"
                            onClick={() => setSelectedSource(source)}
                            className="text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                          >
                            Inspect Extracted Telemetry →
                          </button>

                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center space-x-1 text-slate-400 hover:text-white"
                          >
                            <span>Visit Source</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Univers Footer */}
      <footer className="mt-16 border-t border-white/[0.07] py-6 text-center text-xs text-slate-500">
        <div className="mx-auto max-w-5xl px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>© 2026 Univers Intelligence Hub. Dedicated to client decarbonization & energy efficiency.</p>
          <div className="flex items-center space-x-2 text-slate-400">
            <span>Developed by</span>
            <a
              href="https://www.linkedin.com/in/evanyapzhikai/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-300 transition-all hover:border-emerald-400 hover:bg-emerald-500/20 hover:text-white cursor-pointer"
            >
              <span>Evan Yap</span>
              <ExternalLink className="h-3 w-3 text-emerald-400" />
            </a>
          </div>
        </div>
      </footer>

      {/* Interactive Source Inspector Modal */}
      {selectedSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in-50">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/15 bg-[#090e1a] shadow-2xl flex flex-col">
            <div className="flex items-start justify-between border-b border-white/10 p-5">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="rounded-md bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-300">
                    Source {selectedSource.id}
                  </span>
                  <span className="text-xs text-slate-400">
                    {selectedSource.text.length.toLocaleString()} characters extracted
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mt-1 line-clamp-1">
                  {selectedSource.title}
                </h3>
                <a
                  href={selectedSource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center space-x-1 text-xs text-emerald-400 hover:underline break-all"
                >
                  <span>{selectedSource.url}</span>
                  <ExternalLink className="h-3 w-3 inline" />
                </a>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSource(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Extracted Context Text (Supplied to Univers AI Engine)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedSource.text);
                  }}
                  className="text-xs text-emerald-400 hover:underline inline-flex items-center space-x-1 cursor-pointer"
                >
                  <Copy className="h-3 w-3" />
                  <span>Copy Source Text</span>
                </button>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/50 p-4 font-mono text-xs leading-relaxed text-slate-300 whitespace-pre-wrap max-h-[50vh] overflow-y-auto">
                {selectedSource.text}
              </div>
            </div>

            <div className="border-t border-white/10 p-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedSource(null)}
                className="rounded-xl bg-white/10 px-5 py-2 text-xs font-semibold text-white hover:bg-white/15 transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings / API Key Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in-50">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#090e1a] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center space-x-2">
                <Key className="h-5 w-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">Univers Engine Configuration</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="api-key-input"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
                >
                  Groq / Open-Source or Gemini API Key (Optional)
                </label>
                <input
                  id="api-key-input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder="gsk_... (Groq Free) or AIzaSy... (Gemini)"
                  className="w-full rounded-xl border border-white/10 bg-black/50 p-2.5 font-mono text-xs text-white placeholder-slate-600 outline-none focus:border-emerald-500/60"
                />
                <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
                  Saved securely in local storage. Powered by ultra-fast Groq LPU open-source inference (100% free credits) with Gemini fallback.
                </p>
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs text-slate-400 space-y-1.5">
                <div className="flex items-center space-x-2 text-slate-300 font-semibold">
                  <Database className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Configured Client Telemetry Pipeline</span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  • Univers Client Acronym Disambiguation (MTL, HACTL, HIT, AAHK)
                  <br />
                  • Direct Port & Facility Sustainability PDF Ingestion
                  <br />
                  • Headless SPA DOM Rendering (Jina AI)
                  <br />
                  • OpenAlex Decarbonization & Engineering Works
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2 text-xs font-semibold text-white hover:from-emerald-600 hover:to-teal-700 shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}