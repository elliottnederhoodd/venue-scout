import { supabase } from "@/lib/supabaseClient";

/**
 * Admin Metrics Page
 * 
 * Shows analytics from analytics_events table for the last 7 days.
 * Protected by ADMIN_METRICS_KEY environment variable.
 * 
 * Access: /admin/metrics?key=YOUR_KEY
 * 
 * Metrics shown:
 * - Unique visitors (unique device_id count)
 * - Total pageviews (page_view_* events)
 * - Pageviews by day (last 7 days)
 * - Top venues by venue pageviews
 * - Pageviews by hour-of-day (America/Detroit timezone)
 * - % venue pageviews vs homepage views
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

// Format date for display
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
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

  // Format for display
  const pageviewsByDayFormatted = Object.entries(pageviewsByDay)
    .map(([dateStr, count]) => ({
      date: new Date(dateStr),
      count,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

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

export default async function AdminMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const params = await searchParams;
  const providedKey = params.key;
  const expectedKey = process.env.ADMIN_METRICS_KEY;

  // Check authorization
  if (!expectedKey || providedKey !== expectedKey) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-xl">
          <div className="vs-card px-5 py-4">
            <h1 className="text-2xl font-semibold tracking-tight mb-2">Not Authorized</h1>
            <p className="text-sm opacity-70">
              Access to this page requires a valid key. Please provide the correct key in the URL.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Fetch metrics
  const metrics = await getMetrics();

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Admin Metrics</h1>
          <p className="text-sm opacity-70">Analytics for the last 7 days</p>
        </header>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="vs-card px-5 py-4">
            <div className="text-xs font-semibold tracking-wide uppercase opacity-60 mb-1">
              Unique Visitors
            </div>
            <div className="text-2xl font-semibold">{metrics.uniqueVisitors.toLocaleString()}</div>
            <div className="text-xs opacity-60 mt-1">Unique device_id count</div>
          </div>

          <div className="vs-card px-5 py-4">
            <div className="text-xs font-semibold tracking-wide uppercase opacity-60 mb-1">
              Total Pageviews
            </div>
            <div className="text-2xl font-semibold">{metrics.totalPageviews.toLocaleString()}</div>
            <div className="text-xs opacity-60 mt-1">All page_view_* events</div>
          </div>

          <div className="vs-card px-5 py-4">
            <div className="text-xs font-semibold tracking-wide uppercase opacity-60 mb-1">
              Pageview Split
            </div>
            <div className="text-2xl font-semibold">{metrics.venuePageviewPercent}%</div>
            <div className="text-xs opacity-60 mt-1">
              Venue pages ({metrics.venueViews}) vs Homepage ({metrics.homepageViews})
            </div>
          </div>
        </div>

        {/* Pageviews by Day */}
        <div className="vs-card px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight mb-4">Pageviews by Day</h2>
          <div className="space-y-2">
            {metrics.pageviewsByDay.map((day) => (
              <div key={day.date.toISOString()} className="flex items-center justify-between">
                <span className="text-sm">{formatDate(day.date)}</span>
                <span className="text-sm font-medium">{day.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Venues */}
        <div className="vs-card px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight mb-4">Top Venues by Pageviews</h2>
          {metrics.topVenues.length > 0 ? (
            <div className="space-y-2">
              {metrics.topVenues.map((venue, idx) => (
                <div key={venue.venueId} className="flex items-center justify-between">
                  <span className="text-sm">
                    {idx + 1}. {venue.venueName}
                  </span>
                  <span className="text-sm font-medium">{venue.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm opacity-60">No venue pageviews in the last 7 days</p>
          )}
        </div>

        {/* Pageviews by Hour */}
        <div className="vs-card px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight mb-4">
            Pageviews by Hour (America/Detroit)
          </h2>
          <p className="text-xs opacity-60 mb-4">
            Shows peak usage times. Typically higher on Thu–Sat evenings.
          </p>
          <div className="space-y-2">
            {metrics.pageviewsByHour.map((hour) => {
              const maxCount = Math.max(...metrics.pageviewsByHour.map((h) => h.count));
              const barWidth = maxCount > 0 ? (hour.count / maxCount) * 100 : 0;
              return (
                <div key={hour.hour} className="flex items-center gap-3">
                  <span className="text-xs w-12 opacity-60">
                    {hour.hour.toString().padStart(2, "0")}:00
                  </span>
                  <div className="flex-1 bg-black/5 rounded-full h-4 overflow-hidden">
                    <div
                      className="bg-black/20 h-full rounded-full transition-all"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className="text-xs w-12 text-right font-medium">{hour.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
