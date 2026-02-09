import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

function labelFromScore(score: number): "Low" | "Medium" | "High" | "Insane" {
  if (score < 1.6) return "Low";
  if (score < 2.4) return "Medium";
  if (score < 3.2) return "High";
  return "Insane";
}

function labelToNumber(label: "Low" | "Medium" | "High" | "Insane"): number {
  if (label === "Low") return 1;
  if (label === "Medium") return 2;
  if (label === "High") return 3;
  return 4;
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


export async function POST(req: Request) {
  try {
    // Debug logging (server-side only)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const urlPreview = supabaseUrl ? supabaseUrl.substring(0, 25) : "undefined";
    const tableName = "alert_subscriptions";
    
    console.log("[alerts/run] Debug:", {
      hasSupabaseUrl: !!supabaseUrl,
      urlPreview,
      tableName,
    });

    // Get all active subscriptions
    const { data: subscriptions, error: subErr } = await supabase
      .from(tableName)
      .select("id, venue_id, device_id, threshold, last_triggered_at")
      .eq("active", true);

    if (subErr) {
      const errorMsg = subErr.message || String(subErr);
      
      // Check for schema cache errors
      if (
        errorMsg.includes("schema cache") ||
        errorMsg.includes("Could not find the table")
      ) {
        console.error("[alerts/run] Schema cache error:", errorMsg);
        return NextResponse.json(
          {
            error:
              "Supabase schema cache is stale or project mismatch. In Supabase: Settings → API → Reload schema cache. Also confirm env vars point to the correct project.",
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { error: errorMsg },
        { status: 500 }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ processed: 0, triggered: 0 });
    }

    // Get unique venue IDs
    const venueIds = Array.from(new Set(subscriptions.map((s) => s.venue_id)));

    // Load venues
    const { data: venues, error: venueErr } = await supabase
      .from("venues")
      .select("id, name")
      .in("id", venueIds);

    if (venueErr) {
      return NextResponse.json(
        { error: venueErr.message },
        { status: 500 }
      );
    }

    const venueMap = new Map((venues ?? []).map((v) => [v.id, v.name]));

    // Load reports for last 3 hours
    const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const { data: reports, error: reportsErr } = await supabase
      .from("reports")
      .select("venue_id, status, created_at")
      .in("venue_id", venueIds)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (reportsErr) {
      return NextResponse.json(
        { error: reportsErr.message },
        { status: 500 }
      );
    }

    // Group reports by venue
    const reportsByVenue = new Map<
      string,
      { status: number; created_at: string }[]
    >();

    for (const r of reports ?? []) {
      const arr = reportsByVenue.get(r.venue_id) ?? [];
      arr.push({ status: r.status, created_at: r.created_at });
      reportsByVenue.set(r.venue_id, arr);
    }

    let triggered = 0;
    const now = Date.now();

    // Process each subscription
    for (const sub of subscriptions) {
      // Check cooldown (60 minutes)
      if (sub.last_triggered_at) {
        const lastTriggered = new Date(sub.last_triggered_at).getTime();
        const minutesSinceTriggered = (now - lastTriggered) / 60000;
        if (minutesSinceTriggered < 60) {
          continue;
        }
      }

      const venueReports = reportsByVenue.get(sub.venue_id) ?? [];
      const score = computeDecayedScore(venueReports);
      const label = labelFromScore(score);
      const labelNum = labelToNumber(label);

      // Check if threshold is met
      let shouldTrigger = false;
      if (sub.threshold === 2) {
        // Medium-or-lower: trigger when label <= 2
        shouldTrigger = labelNum <= 2;
      } else if (sub.threshold === 1) {
        // Low: trigger when label == 1
        shouldTrigger = labelNum === 1;
      }

      if (!shouldTrigger) {
        continue;
      }

      // Get venue name
      const venueName = venueMap.get(sub.venue_id) ?? "Unknown venue";

      // Log alert
      console.log(
        `ALERT: ${venueName} reached ${label} for device ${sub.device_id}`
      );

      // Update last_triggered_at
      await supabase
        .from("alert_subscriptions")
        .update({ last_triggered_at: new Date().toISOString() })
        .eq("id", sub.id);

      triggered++;
    }

    return NextResponse.json({
      processed: subscriptions.length,
      triggered,
    });
  } catch (error: any) {
    console.error("[alerts/run] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
