"use client";

import { useState } from "react";
import { getDeviceId } from "@/lib/deviceId";
import { logEvent } from "@/lib/analytics";

export default function AccuracyFeedback({ venueId }: { venueId: string }) {
  const [submitted, setSubmitted] = useState(false);

  const handleFeedback = async (accurate: boolean) => {
    if (submitted) return;

    const device_id = getDeviceId();
    await logEvent("accuracy_feedback", device_id, venueId, { accurate });

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="text-xs opacity-60 text-center py-2">
        Thanks for the feedback
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs opacity-70">Was this accurate?</div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleFeedback(true)}
          className="flex-1 rounded-xl border border-black/20 px-3 py-2 text-xs font-medium bg-white hover:bg-black/5 transition-colors"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => handleFeedback(false)}
          className="flex-1 rounded-xl border border-black/20 px-3 py-2 text-xs font-medium bg-white hover:bg-black/5 transition-colors"
        >
          No
        </button>
      </div>
    </div>
  );
}
