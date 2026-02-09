import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { venue_id, device_id, threshold } = body ?? {};

    if (!venue_id || !device_id || !threshold) {
      return NextResponse.json(
        { ok: false, error: "Missing venue_id, device_id, or threshold" },
        { status: 400 }
      );
    }

    const thresh = Number(threshold);
    if (![1, 2].includes(thresh)) {
      return NextResponse.json(
        { ok: false, error: "Threshold must be 1 (Low) or 2 (Medium-or-lower)" },
        { status: 400 }
      );
    }

    // Debug logging (server-side only)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const urlPreview = supabaseUrl ? supabaseUrl.substring(0, 25) : "undefined";
    const tableName = "alert_subscriptions";
    
    console.log("[alerts/subscribe] Debug:", {
      hasSupabaseUrl: !!supabaseUrl,
      urlPreview,
      tableName,
    });

    const deviceIdStr = String(device_id);

    // Select-then-update-or-insert strategy (works without unique constraint)
    // First, check if a subscription already exists
    const { data: existing, error: selectErr } = await supabase
      .from(tableName)
      .select("id")
      .eq("venue_id", venue_id)
      .eq("device_id", deviceIdStr)
      .eq("threshold", thresh)
      .eq("active", true)
      .maybeSingle();

    if (selectErr) {
      const errorMsg = selectErr.message || String(selectErr);
      
      // Check for schema cache errors
      if (
        errorMsg.includes("schema cache") ||
        errorMsg.includes("Could not find the table")
      ) {
        console.error("[alerts/subscribe] Schema cache error:", errorMsg);
        return NextResponse.json(
          {
            ok: false,
            error:
              "Supabase schema cache is stale or project mismatch. In Supabase: Settings → API → Reload schema cache. Also confirm env vars point to the correct project.",
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { ok: false, error: errorMsg },
        { status: 500 }
      );
    }

    // If exists, update it; otherwise insert
    if (existing) {
      const { error: updateErr } = await supabase
        .from(tableName)
        .update({
          active: true,
        })
        .eq("id", existing.id);

      if (updateErr) {
        return NextResponse.json(
          { ok: false, error: updateErr.message || String(updateErr) },
          { status: 500 }
        );
      }
    } else {
      const { error: insertErr } = await supabase
        .from(tableName)
        .insert({
          venue_id,
          device_id: deviceIdStr,
          threshold: thresh,
          active: true,
        });

      if (insertErr) {
        return NextResponse.json(
          { ok: false, error: insertErr.message || String(insertErr) },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[alerts/subscribe] Unexpected error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Bad JSON" },
      { status: 400 }
    );
  }
}
