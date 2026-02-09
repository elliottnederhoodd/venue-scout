// Lightweight analytics utility - fire-and-forget logging
// Fails silently to never block UI

export async function logEvent(
  event: string,
  deviceId: string,
  venueId?: string | null,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    await fetch("/api/analytics/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        device_id: deviceId,
        venue_id: venueId || null,
        metadata: metadata || null,
      }),
    });
  } catch (error) {
    // Fail silently - analytics should never block UI
    console.debug("[analytics] Failed to log event:", event);
  }
}
