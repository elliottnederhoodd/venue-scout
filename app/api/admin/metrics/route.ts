import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

/**
 * Admin Metrics API Endpoint
 * 
 * Returns analytics metrics as JSON for the last 7 days.
 * Protected by ADMIN_METRICS_KEY environment variable.
 * 
 * Access: GET /api/admin/metrics?key=YOUR_KEY
 *        or GET /api/admin/metrics with header x-admin-key: YOUR_KEY
 * 
 * Returns the same metrics as the /admin/metrics page in JSON format.
 */

// Helper to get day-of-week and hour in America/Detroit timezone
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

async function getMetrics() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all analytics events from last 7 days
  const { data: events, error } = await supabase
    .from("analytics_events")
    .select("event, venue_id, device_id, created_at")
    .gte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch analytics: ${error.message}`);
  }

  const eventsList = events ?? [];

  // 1. Unique visitors (unique device_id)
  const uniqueVisitors = new Set(eventsList.map((e) => e.device_id)).size;

  // 2. Total pageviews (page_view_* events)
  const pageViews = eventsList.filter((e) => e.event.startsWith("page_view_")).length;

  // 3. Pageviews by day (last 7 days)
  const pageviewsByDay: Record<string, number> = {};
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    pageviewsByDay[dateStr] = 0;
  }

  eventsList
    .filter((e) => e.event.startsWith("page_view_"))
    .forEach((e) => {
      const dateStr = new Date(e.created_at).toISOString().split("T")[0];
      if (pageviewsByDay[dateStr] !== undefined) {
        pageviewsByDay[dateStr]++;
      }
    });

  // Format for JSON
  const pageviewsByDayFormatted = Object.entries(pageviewsByDay)
    .map(([dateStr, count]) => ({
      date: dateStr,
      count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 4. Top venues by venue pageviews
  const venuePageviews: Record<string, number> = {};
  eventsList
    .filter((e) => e.event === "page_view_venue" && e.venue_id)
    .forEach((e) => {
      const vid = e.venue_id as string;
      venuePageviews[vid] = (venuePageviews[vid] || 0) + 1;
    });

  // Get venue names
  const venueIds = Object.keys(venuePageviews);
  const venueMap: Record<string, string> = {};
  if (venueIds.length > 0) {
    const { data: venues } = await supabase
      .from("venues")
      .select("id, name")
      .in("id", venueIds);

    venues?.forEach((v) => {
      venueMap[v.id] = v.name;
    });
  }

  const topVenues = Object.entries(venuePageviews)
    .map(([venueId, count]) => ({
      venueId,
      venueName: venueMap[venueId] || "Unknown",
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 5. Pageviews by hour-of-day (America/Detroit)
  const pageviewsByHour: Record<number, number> = {};
  for (let h = 0; h < 24; h++) {
    pageviewsByHour[h] = 0;
  }

  eventsList
    .filter((e) => e.event.startsWith("page_view_"))
    .forEach((e) => {
      const { hour } = getDowHourDetroit(new Date(e.created_at));
      pageviewsByHour[hour]++;
    });

  const pageviewsByHourFormatted = Object.entries(pageviewsByHour)
    .map(([hour, count]) => ({
      hour: Number(hour),
      count,
    }))
    .sort((a, b) => a.hour - b.hour);

  // 6. % venue pageviews vs homepage views
  const homepageViews = eventsList.filter((e) => e.event === "page_view_home").length;
  const venueViews = eventsList.filter((e) => e.event === "page_view_venue").length;
  const totalPageViews = homepageViews + venueViews;
  const venuePageviewPercent =
    totalPageViews > 0 ? Math.round((venueViews / totalPageViews) * 100) : 0;
  const homepagePageviewPercent =
    totalPageViews > 0 ? Math.round((homepageViews / totalPageViews) * 100) : 0;

  return {
    uniqueVisitors,
    totalPageviews: pageViews,
    pageviewsByDay: pageviewsByDayFormatted,
    topVenues,
    pageviewsByHour: pageviewsByHourFormatted,
    venuePageviewPercent,
    homepagePageviewPercent,
    homepageViews,
    venueViews,
  };
}

export async function GET(req: Request) {
  try {
    // Check authorization - support both query param and header
    const url = new URL(req.url);
    const queryKey = url.searchParams.get("key");
    const headerKey = req.headers.get("x-admin-key");
    const providedKey = queryKey || headerKey;
    const expectedKey = process.env.ADMIN_METRICS_KEY;

    if (!expectedKey || providedKey !== expectedKey) {
      return NextResponse.json(
        { error: "Not authorized. Provide valid key via ?key= or x-admin-key header." },
        { status: 401 }
      );
    }

    // Fetch metrics
    const metrics = await getMetrics();

    return NextResponse.json({
      ok: true,
      period: "last_7_days",
      metrics,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}
