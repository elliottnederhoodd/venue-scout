"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getDeviceId } from "@/lib/deviceId";
import { logEvent } from "@/lib/analytics";

type CrowdStatus = "Low" | "Medium" | "High" | "Insane";

function toNumber(status: CrowdStatus) {
  return status === "Low" ? 1 : status === "Medium" ? 2 : status === "High" ? 3 : 4;
}

function ReportModal({
  open,
  venueName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  venueName: string;
  onClose: () => void;
  onSubmit: (status: CrowdStatus, lineOutside: boolean) => Promise<void>;
}) {
  const [status, setStatus] = useState<CrowdStatus>("Medium");
  const [lineOutside, setLineOutside] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  const options: CrowdStatus[] = ["Low", "Medium", "High", "Insane"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-semibold tracking-wide uppercase opacity-60">Report Line Status</div>
        <div className="mt-1 text-xl font-semibold tracking-tight">{venueName}</div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-2">
          {options.map((opt) => {
            const selected = opt === status;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setStatus(opt)}
                className={`rounded-xl border px-4 py-4 text-sm font-semibold transition-colors ${
                  selected ? "border-black bg-black/5" : "border-black/20 bg-white"
                }`}
                disabled={busy}
              >
                {opt}
              </button>
            );
          })}
        </div>

        <label className="mt-3 flex items-center justify-between rounded-xl border border-black/20 px-4 py-4 text-sm bg-white min-h-[44px]">
          <span className="font-medium">Line outside?</span>
          <input
            type="checkbox"
            checked={lineOutside}
            onChange={(e) => setLineOutside(e.target.checked)}
            className="h-5 w-5"
            disabled={busy}
          />
        </label>

        {err ? (
          <div className="mt-3 text-sm text-red-700 font-medium">{err}</div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            className="w-full rounded-xl border border-black/20 px-4 py-3 text-sm font-semibold bg-white transition-opacity hover:opacity-70"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="w-full rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onSubmit(status, lineOutside);
              } catch (e: any) {
                setErr(e?.message ?? "Failed to submit");
                setBusy(false);
              }
            }}
          >
            {busy ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}


export default function VenueClient({
  venueId,
  venueName,
  isSticky = false,
}: {
  venueId: string;
  venueName: string;
  isSticky?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const submit = useMemo(
    () => async (status: CrowdStatus, lineOutside: boolean) => {
      const device_id = getDeviceId();

      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_id: venueId,
          status: toNumber(status),
          line_outside: lineOutside,
          device_id,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error ?? "Submit failed");
      }

      // Log report submission event
      logEvent("report_submitted", device_id, venueId, {
        status: toNumber(status),
        line_outside: lineOutside,
      });

      setOpen(false);
      setShowConfirmation(true);
      setTimeout(() => setShowConfirmation(false), 5000);
      router.refresh(); // re-fetch server data (reports) and recompute status
    },
    [venueId, router]
  );

  if (isSticky) {
    return (
      <>
        <button
          className="w-full rounded-xl bg-black px-4 py-4 text-sm font-semibold text-white transition-opacity active:opacity-90"
          type="button"
          onClick={() => setOpen(true)}
        >
          Report Line Status
        </button>
        <ReportModal
          open={open}
          venueName={venueName}
          onClose={() => setOpen(false)}
          onSubmit={submit}
        />
      </>
    );
  }

  return (
    <>
      {showConfirmation ? (
        <div className="w-full rounded-xl bg-black/5 border border-black/10 px-4 py-3 text-sm text-center">
          Report submitted • thanks
        </div>
      ) : (
        <button
          className="w-full rounded-xl bg-black px-4 py-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 active:opacity-90"
          type="button"
          onClick={() => setOpen(true)}
        >
          Report Line Status
        </button>
      )}

      <ReportModal
        open={open}
        venueName={venueName}
        onClose={() => setOpen(false)}
        onSubmit={submit}
      />
    </>
  );
}