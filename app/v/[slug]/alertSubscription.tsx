"use client";

import { useState } from "react";
import { getDeviceId } from "@/lib/deviceId";

type Threshold = 1 | 2; // 1=Low, 2=Medium-or-lower

// Toggle this to false to enable the feature
const IS_COMING_SOON = true;

export default function AlertSubscription({
  venueId,
}: {
  venueId: string;
}) {
  const [selectedThreshold, setSelectedThreshold] = useState<Threshold | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubscribe = async () => {
    if (!selectedThreshold) {
      setError("Please select a threshold");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(false);

    try {
      const device_id = getDeviceId();
      const res = await fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_id: venueId,
          device_id,
          threshold: selectedThreshold,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to subscribe");
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Failed to subscribe");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="vs-card px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold opacity-70">Notify me</div>
          {IS_COMING_SOON && <span className="vs-pill-sm vs-muted">Coming soon</span>}
        </div>
        
        <div>
          <label className="block text-xs opacity-70 mb-1">
            Phone number
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => !IS_COMING_SOON && setPhone(e.target.value)}
            placeholder="+1 (734) 555-1234"
            disabled={IS_COMING_SOON}
            className="w-full rounded-xl border border-black/20 px-3 py-2 text-sm bg-white focus:outline-none focus:border-black disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="mt-1 text-xs opacity-60">
            We'll text you when your threshold is reached.
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => !IS_COMING_SOON && setSelectedThreshold(2)}
            disabled={IS_COMING_SOON}
            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
              IS_COMING_SOON
                ? "border-black/20 bg-white opacity-50 cursor-not-allowed"
                : selectedThreshold === 2
                ? "border-black bg-black/5"
                : "border-black/20 bg-white"
            }`}
          >
            Medium or lower
          </button>
          <button
            type="button"
            onClick={() => !IS_COMING_SOON && setSelectedThreshold(1)}
            disabled={IS_COMING_SOON}
            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
              IS_COMING_SOON
                ? "border-black/20 bg-white opacity-50 cursor-not-allowed"
                : selectedThreshold === 1
                ? "border-black bg-black/5"
                : "border-black/20 bg-white"
            }`}
          >
            Low
          </button>
        </div>

        <button
          type="button"
          disabled={IS_COMING_SOON || !selectedThreshold}
          onClick={() => !IS_COMING_SOON && handleSubscribe()}
          className={`w-full rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white transition-opacity ${
            IS_COMING_SOON
              ? "opacity-40 cursor-not-allowed"
              : "hover:opacity-90 disabled:opacity-60"
          }`}
        >
          Save
        </button>
      </div>
    </section>
  );
}
