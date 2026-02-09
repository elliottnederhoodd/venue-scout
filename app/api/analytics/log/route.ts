import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { event, device_id, venue_id, metadata } = body ?? {};

    if (!event || !device_id) {
      return NextResponse.json({ ok: false, error: "Missing event or device_id" }, { status: 400 });
    }

    // Fire-and-forget insert (don't wait for response)
    supabase
      .from("analytics_events")
      .insert({
        event: String(event),
        device_id: String(device_id),
        venue_id: venue_id || null,
        metadata: metadata || null,
      })
      .then(() => {
        // Success - no action needed
      })
      .catch((err) => {
        // Fail silently
        console.debug("[analytics/log] Insert failed:", err);
      });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }
}
