import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type CrowdLabel = "Low" | "Medium" | "High" | "Insane";
type Confidence = "Low" | "Medium" | "High";

function labelFromScore(score: number): CrowdLabel {
  if (score < 1.6) return "Low";
  if (score < 2.4) return "Medium";
  if (score < 3.2) return "High";
  return "Insane";
}

function statusClass(label: CrowdLabel) {
  if (label === "Low") return "vs-pill vs-green";
  if (label === "Medium") return "vs-pill vs-yellow";
  return "vs-pill vs-red"; // High + Insane
}

function confidenceClass(c: Confidence) {
  if (c === "High") return "vs-pill-sm vs-green";
  if (c === "Medium") return "vs-pill-sm vs-yellow";
  return "vs-pill-sm vs-muted";
}

function confidenceFrom(latestCreatedAt: string | null, reportCount: number): Confidence {
  if (!latestCreatedAt) return "Low";
  const ageMin = Math.max(
    0,
    Math.round((Date.now() - new Date(latestCreatedAt).getTime()) / 60000)
  );
  if (ageMin <= 10 && reportCount >= 3) return "High";
  if (ageMin <= 25 && reportCount >= 2) return "Medium";
  return "Low";
}

function computeDecayedScore(reports: { status: number; created_at: string }[]) {
  const now = Date.now();
  let weightSum = 0;
  let scoreSum = 0;

  // Defensive robustness: compute consensus first to dampen outliers
  // This prevents single malicious or noisy reports from swinging the signal
  // without rejecting data or punishing users
  let consensusNum = 2; // default to Medium
  if (reports.length > 0) {
    // Quick consensus: simple average of recent reports (last 30 min weighted)
    let quickWeightSum = 0;
    let quickScoreSum = 0;
    for (const r of reports) {
      const ageMin = (now - new Date(r.created_at).getTime()) / 60000;
      if (ageMin <= 30) {
        const w = Math.exp(-ageMin / 30);
        quickWeightSum += w;
        quickScoreSum += w * r.status;
      }
    }
    if (quickWeightSum > 0) {
      const quickScore = quickScoreSum / quickWeightSum;
      consensusNum = Math.round(quickScore);
    }
  }

  // Apply outlier damping: reports that differ by 2+ levels get 0.25x weight
  for (const r of reports) {
    const ageMin = (now - new Date(r.created_at).getTime()) / 60000;
    const baseWeight = Math.exp(-ageMin / 30);
    
    // If report differs from consensus by 2+ levels, dampen it
    const diff = Math.abs(r.status - consensusNum);
    const outlierMultiplier = diff >= 2 ? 0.25 : 1.0;
    
    const w = baseWeight * outlierMultiplier;
    weightSum += w;
    scoreSum += w * r.status;
  }

  return weightSum > 0 ? scoreSum / weightSum : 2;
}

// Compute trend: compare current (last 30 min) vs previous (90-30 min ago)
function computeTrend(reports: { status: number; created_at: string }[]): "up" | "down" | "flat" | "unknown" {
  const now = Date.now();
  const currentWindow = reports.filter((r) => {
    const ageMin = (now - new Date(r.created_at).getTime()) / 60000;
    return ageMin <= 30;
  });
  
  const previousWindow = reports.filter((r) => {
    const ageMin = (now - new Date(r.created_at).getTime()) / 60000;
    return ageMin > 30 && ageMin <= 90;
  });

  // Minimum data rule: need at least 2 reports in each window
  if (currentWindow.length < 2 || previousWindow.length < 2) {
    return "unknown";
  }

  const currentScore = computeDecayedScore(currentWindow);
  const previousScore = computeDecayedScore(previousWindow);

  const diff = currentScore - previousScore;
  if (diff >= 0.25) return "up";
  if (diff <= -0.25) return "down";
  return "flat";
}

function minutesAgo(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

// Venue ordering: Rick's first, Skeeps second, Charley's third, then others alphabetically
function getVenueSortPriority(name: string, slug: string): number {
  const lowerName = name.toLowerCase();
  const lowerSlug = slug.toLowerCase();
  
  if (lowerName.includes("rick") || lowerSlug.includes("rick")) return 1;
  if (lowerName.includes("skeep") || lowerSlug.includes("skeep")) return 2;
  if (lowerName.includes("charley") || lowerSlug.includes("charley")) return 3;
  return 4; // Others will be sorted alphabetically
}

function getConfidenceExplanation(
  confidence: Confidence,
  reportCount: number,
  latestReportAge: number | null
): string {
  const ageText = latestReportAge !== null 
    ? `${latestReportAge} min ago`
    : "no recent reports";
  
  if (confidence === "High") {
    return `${reportCount} report${reportCount !== 1 ? "s" : ""} (latest ${ageText}). Multiple recent reports.`;
  }
  if (confidence === "Medium") {
    return `${reportCount} report${reportCount !== 1 ? "s" : ""} (latest ${ageText}). Some recent reports.`;
  }
  return `${reportCount} report${reportCount !== 1 ? "s" : ""} (latest ${ageText}). Few or stale reports.`;
}

export default async function Home() {
  const { data: venues } = await supabase
    .from("venues")
    .select("id, slug, name")
    .order("name", { ascending: true });

  const venueList = venues ?? [];
  const venueIds = venueList.map((v) => v.id);

  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  const { data: reports } = await supabase
    .from("reports")
    .select("venue_id, status, line_outside, created_at")
    .in("venue_id", venueIds.length ? venueIds : ["00000000-0000-0000-0000-000000000000"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  const reportsByVenue = new Map<
    string,
    { status: number; line_outside: boolean; created_at: string }[]
  >();

  for (const r of reports ?? []) {
    const arr = reportsByVenue.get(r.venue_id) ?? [];
    arr.push(r);
    reportsByVenue.set(r.venue_id, arr);
  }

  const rows = venueList.map((v) => {
    const rs = reportsByVenue.get(v.id) ?? [];
    const score = computeDecayedScore(rs);
    const label = labelFromScore(score);
    const latest = rs[0];
    const isVerified = v.slug.toLowerCase().includes("rick") || v.name.toLowerCase().includes("rick");
    const isCrowdsourced = (v.slug.toLowerCase().includes("skeep") || v.name.toLowerCase().includes("skeep")) ||
                          (v.slug.toLowerCase().includes("charley") || v.name.toLowerCase().includes("charley"));
    const confidence = confidenceFrom(latest?.created_at ?? null, rs.length);
    const latestReportAge = latest ? minutesAgo(latest.created_at) : null;
    const trend = computeTrend(rs);

    return {
      ...v,
      label,
      confidence,
      isVerified,
      isCrowdsourced,
      trend,
      reportCount: rs.length,
      latestReportAge,
      confidenceExplanation: getConfidenceExplanation(confidence, rs.length, latestReportAge),
      updatedText: latest
        ? `Updated ${latestReportAge} min ago`
        : "No recent reports",
      meta:
        rs.length > 0
          ? `${rs.length} report${rs.length === 1 ? "" : "s"}${
              latest?.line_outside ? " · Line outside" : ""
            }`
          : "No recent reports",
    };
  });

  // Sort: Rick's first, Skeeps second, Charley's third, then others alphabetically
  rows.sort((a, b) => {
    const priorityA = getVenueSortPriority(a.name, a.slug);
    const priorityB = getVenueSortPriority(b.name, b.slug);
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // Within same priority (others), sort alphabetically
    if (priorityA === 4) {
      return a.name.localeCompare(b.name);
    }
    
    // For priority venues, maintain their order
    return 0;
  });

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="space-y-2">
          <div className="text-xs font-semibold tracking-wide uppercase opacity-60">
            Venue Scout
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Live Updates
          </h1>
          <p className="text-sm opacity-70">
            Real-time line updates with confidence and short-term predictions.
          </p>
        </header>

        <div className="space-y-3">
          {rows.map((v) => (
            <Link key={v.slug} href={`/v/${v.slug}`} className="block">
              <div className="vs-card vs-card-hover px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-base font-semibold truncate">
                        {v.name}
                      </div>
                      {v.isVerified && (
                        <span className="vs-pill-sm vs-blue flex items-center gap-1 opacity-70">
                          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          Verified
                        </span>
                      )}
                      {v.isCrowdsourced && (
                        <span className="vs-pill-sm vs-yellow-warning flex items-center gap-1 opacity-70">
                          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          Crowdsourced
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs opacity-60">
                      {v.updatedText}
                      {v.meta !== "No recent reports" && ` · ${v.meta}`}
                      {v.confidence === "Low" && ` · ${v.confidence} confidence = few or stale reports`}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className={statusClass(v.label)}>
                        {v.label}
                      </span>
                      <span
                        className="text-xs opacity-50"
                        title={v.trend === "unknown" ? "Not enough data" : "Trend indicator"}
                      >
                        {v.trend === "up" ? "↑" : v.trend === "down" ? "↓" : v.trend === "unknown" ? "—" : "→"}
                      </span>
                    </div>
                    <details className="relative group">
                      <summary className="flex items-center gap-2 cursor-pointer list-none focus:outline-none">
                        <span className="text-xs opacity-60">Confidence:</span>
                        <span className={confidenceClass(v.confidence)}>
                          {v.confidence}
                        </span>
                      </summary>
                      <div className="absolute right-0 top-full mt-1 z-10 w-64 p-2 bg-white border border-black/10 rounded-lg shadow-lg text-xs opacity-70 pointer-events-auto">
                        {v.confidenceExplanation}
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <footer className="pt-2 text-xs opacity-50">
          Estimates based on user reports. Accuracy may vary.
        </footer>
      </div>
    </main>
  );
}