import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

function minutesBetween(aIso: string, bIso: string) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.abs(a - b) / 60000;
}

// Get day-of-week (0=Sun..6=Sat) and hour (0..23) in America/Detroit
function getDowHourDetroit(date = new Date()) {
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { venue_id, status, line_outside, device_id } = body ?? {};

    if (!venue_id || !status || !device_id) {
      return NextResponse.json(
        { error: "Missing venue_id, status, or device_id" },
        { status: 400 }
      );
    }

    const s = Number(status);
    if (![1, 2, 3, 4].includes(s)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const device = String(device_id);

    // --- Guardrail A: 1 report per venue per device per 10 minutes ---
    const { data: last, error: lastErr } = await supabase
      .from("reports")
      .select("created_at")
      .eq("venue_id", venue_id)
      .eq("device_id", device)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastErr) {
      return NextResponse.json({ error: lastErr.message }, { status: 500 });
    }

    if (last?.created_at) {
      const ageMin = minutesBetween(new Date().toISOString(), last.created_at);
      if (ageMin < 10) {
        const wait = Math.max(1, Math.ceil(10 - ageMin));
        return NextResponse.json(
          { error: `Slow down — you can report again in ~${wait} min.` },
          { status: 429 }
        );
      }
    }

    // --- Guardrail B: daily cap per device ---
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { count, error: countErr } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("device_id", device)
      .gte("created_at", startOfDay.toISOString());

    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 500 });
    }

    if ((count ?? 0) >= 20) {
      return NextResponse.json(
        { error: "Daily limit reached. Try again tomorrow." },
        { status: 429 }
      );
    }

    // 1) Insert the report
    const { error: insertErr } = await supabase.from("reports").insert({
      venue_id,
      status: s,
      line_outside: Boolean(line_outside),
      device_id: device,
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // 2) Update baseline bucket (running mean) for this venue + (dow,hour)
    const { dow, hour } = getDowHourDetroit(new Date());

    const { data: baseline, error: baseErr } = await supabase
      .from("venue_baselines")
      .select("mean_score,n")
      .eq("venue_id", venue_id)
      .eq("dow", dow)
      .eq("hour", hour)
      .maybeSingle();

    if (baseErr) {
      return NextResponse.json({ error: baseErr.message }, { status: 500 });
    }

    const prevMean = baseline?.mean_score ?? 2.0;
    const prevN = baseline?.n ?? 0;
    const nextN = prevN + 1;
    const nextMean = (prevMean * prevN + s) / nextN;

    const { error: upsertErr } = await supabase.from("venue_baselines").upsert(
      {
        venue_id,
        dow,
        hour,
        mean_score: nextMean,
        n: nextN,
      },
      { onConflict: "venue_id,dow,hour" }
    );

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
}