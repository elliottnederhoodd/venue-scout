"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getDeviceId } from "@/lib/deviceId";
import { logEvent } from "@/lib/analytics";

export default function AnalyticsLogger({ venueId }: { venueId?: string }) {
  const pathname = usePathname();

  useEffect(() => {
    const device_id = getDeviceId();
    
    if (pathname === "/") {
      logEvent("page_view_home", device_id);
    } else if (pathname.startsWith("/v/") && venueId) {
      logEvent("page_view_venue", device_id, venueId);
    }
  }, [pathname, venueId]);

  return null;
}
