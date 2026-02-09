import { supabase } from "@/lib/supabaseClient";
import VenueClient from "./venueClient";
import AlertSubscription from "./alertSubscription";
import AccuracyFeedback from "./accuracyFeedback";
import AnalyticsLogger from "../../components/AnalyticsLogger";

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
  let wSum = 0;
  let sSum = 0;

  // Defensive robustness: compute consensus first to dampen outliers
  // This prevents single malicious or noisy reports from swinging the signal
  // without rejecting data or punishing users
  let consensusNum = 2; // default to Medium
  if (reports.length > 0) {
    // Quick consensus: simple average of recent reports (last 30 min weighted)
    let quickWeightSum = 0;
    let quickScoreSum = 0;
    for (const r of reports) {
      const t = new Date(r.created_at).getTime();
      const ageMin = (now - t) / 60000;
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
    const t = new Date(r.created_at).getTime();
    const ageMin = (now - t) / 60000;
    const baseWeight = Math.exp(-ageMin / 30); // 30-min decay constant
    
    // If report differs from consensus by 2+ levels, dampen it
    const diff = Math.abs(r.status - consensusNum);
    const outlierMultiplier = diff >= 2 ? 0.25 : 1.0;
    
    const w = baseWeight * outlierMultiplier;
    wSum += w;
    sSum += w * r.status;
  }

  // default to "Medium-ish" if no reports
  return wSum > 0 ? sSum / wSum : 2;
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

// Detroit time (0=Sun..6=Sat, hour=0..23)
function getDowHourDetroit(date: Date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";

  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return { dow: dowMap[weekday] ?? 0, hour: Number(hourStr) };
}

function predictLabel(currentScore: number, baselineScore: number | null): CrowdLabel {
  const blended =
    baselineScore === null
      ? currentScore
      : 0.55 * baselineScore + 0.45 * currentScore;

  return labelFromScore(blended);
}

export default async function VenuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // 1) Load venue
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id,slug,name")
    .eq("slug", slug)
    .maybeSingle();

  if (venueErr) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-xl">
          <div className="vs-card px-5 py-4 text-sm text-red-800">
            Error loading venue: {venueErr.message}
          </div>
        </div>
      </main>
    );
  }

  if (!venue) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-xl">
          <div className="text-sm opacity-70">Venue not found.</div>
        </div>
      </main>
    );
  }

  // 2) Load last 3 hours of reports
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  const { data: reports, error: reportsErr } = await supabase
    .from("reports")
    .select("status,line_outside,created_at")
    .eq("venue_id", venue.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  if (reportsErr) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-xl">
          <div className="vs-card px-5 py-4 text-sm text-red-800">
            Error loading reports: {reportsErr.message}
          </div>
        </div>
      </main>
    );
  }

  // 3) Compute current decayed score + label
  const reportData = (reports ?? []).map((r) => ({ status: r.status, created_at: r.created_at }));
  const score = computeDecayedScore(reportData);
  const label = labelFromScore(score);
  const trend = computeTrend(reportData);

  const latest = reports?.[0];
  const confidence = confidenceFrom(latest?.created_at ?? null, (reports ?? []).length);
  const updatedText = latest
    ? `Updated ${Math.max(
        0,
        Math.round((Date.now() - new Date(latest.created_at).getTime()) / 60000)
      )} min ago`
    : "No recent reports";

  const lineOutsideText = latest?.line_outside ? " · Line outside" : "";

  // Check badge type
  const isVerified = venue.slug.toLowerCase().includes("rick") || venue.name.toLowerCase().includes("rick");
  const isCrowdsourced = (venue.slug.toLowerCase().includes("skeep") || venue.name.toLowerCase().includes("skeep")) ||
                        (venue.slug.toLowerCase().includes("charley") || venue.name.toLowerCase().includes("charley"));

  // 4) Prediction row (30/60/90) using baselines in Detroit time
  const horizons = [30, 60, 90];
  const now = new Date();

  const buckets = horizons.map((min) => {
    const d = new Date(now.getTime() + min * 60000);
    const { dow, hour } = getDowHourDetroit(d);
    return { min, dow, hour };
  });

  // pull baselines for the relevant dow/hour combos
  const dows = Array.from(new Set(buckets.map((b) => b.dow)));
  const hours = Array.from(new Set(buckets.map((b) => b.hour)));

  const { data: baselines, error: baseErr } = await supabase
    .from("venue_baselines")
    .select("dow,hour,mean_score,n")
    .eq("venue_id", venue.id)
    .in("dow", dows)
    .in("hour", hours);

  // If baselines fail, we still show something (fallback to current score)
  const predictions = baseErr
    ? null
    : horizons.map((min) => {
        const b = buckets.find((x) => x.min === min)!;
        const base =
          baselines?.find((x) => x.dow === b.dow && x.hour === b.hour)?.mean_score ??
          null;

        const lbl = predictLabel(score, base);
        return { minutes: min, label: lbl };
      });

  return (
    <main className="min-h-screen px-4 py-10 pb-24 md:pb-10">
      <AnalyticsLogger venueId={venue.id} />
      <div className="mx-auto max-w-xl space-y-5">
        {/* Decision signal - most important */}
        <header className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight">{venue.name}</h1>
            {isVerified && (
              <span className="vs-pill-sm vs-blue flex items-center gap-1 opacity-70">
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Verified
              </span>
            )}
            {isCrowdsourced && (
              <span className="vs-pill-sm vs-yellow-warning flex items-center gap-1 opacity-70">
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                Crowdsourced
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <span className={statusClass(label)}>
              {label}
            </span>
            <span
              className="text-xs opacity-50"
              title={trend === "unknown" ? "Not enough data" : "Trend indicator"}
            >
              {trend === "up" ? "↑" : trend === "down" ? "↓" : trend === "unknown" ? "—" : "→"}
            </span>
            <span className={confidenceClass(confidence)}>
              {confidence}
            </span>
            <span className="text-xs opacity-60">
              {confidence === "High" && "Multiple recent reports"}
              {confidence === "Medium" && "Some recent reports"}
              {confidence === "Low" && "Few or stale reports"}
            </span>
          </div>
          
          <div className="text-xs opacity-60">
            {updatedText}
            {lineOutsideText}
          </div>
        </header>

        {/* Predictions - compact */}
        {predictions && (
          <section>
            <div className="vs-card px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                {predictions.map((pred, idx) => (
                  <div key={pred.minutes} className="flex items-center gap-1.5">
                    <span className="opacity-60">{pred.minutes}m</span>
                    <span className={statusClass(pred.label)}>
                      {pred.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Accuracy feedback */}
        <div className="vs-card px-4 py-3">
          <AccuracyFeedback venueId={venue.id} />
        </div>

        {/* Details - collapsible/secondary */}
        <details className="group">
          <summary className="text-xs opacity-50 cursor-pointer list-none hover:opacity-70 transition-opacity">
            Details
          </summary>
          <div className="mt-2 vs-card px-4 py-3 space-y-2 opacity-60">
            <div className="flex items-center justify-between text-xs">
              <span>Signal</span>
              <span className="font-medium">{score.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>Reports (last 3h)</span>
              <span className="font-medium">{(reports ?? []).length}</span>
            </div>
          </div>
        </details>

        {/* Actions - clear separation */}
        <div className="hidden md:block space-y-3">
          <VenueClient venueId={venue.id} venueName={venue.name} />
          <AlertSubscription venueId={venue.id} />
        </div>
      </div>

      {/* Sticky mobile report bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 safe-area-bottom bg-white border-t border-black/10 shadow-lg">
        <div className="px-4 py-3">
          <VenueClient venueId={venue.id} venueName={venue.name} isSticky={true} />
        </div>
      </div>
    </main>
  );
}