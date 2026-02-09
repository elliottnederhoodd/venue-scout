# Alert System Upgrade Guide

## Current Implementation

The alert system currently logs triggers to the console. When `/api/alerts/run` is called, it:
1. Checks all active subscriptions
2. Computes current crowd levels using existing scoring logic
3. Triggers alerts when thresholds are met (respecting 60-minute cooldown)
4. Logs: `ALERT: {venueName} reached {label} for device {device_id}`
5. Updates `last_triggered_at` in the database

## Upgrading to SMS Notifications

To add SMS support later, follow these steps:

### 1. Add Phone Field to Database

```sql
ALTER TABLE alert_subscriptions 
ADD COLUMN phone text NULL;

-- Optional: Add index for phone lookups
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_phone 
ON alert_subscriptions(phone) WHERE phone IS NOT NULL;
```

### 2. Update Subscribe API (`app/api/alerts/subscribe/route.ts`)

Add phone validation and storage:

```typescript
const { venue_id, device_id, threshold, phone } = body ?? {};

// Validate phone format if provided (E.164: + followed by digits)
if (phone && typeof phone === "string" && phone.trim()) {
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phone.trim())) {
    return NextResponse.json(
      { error: "Phone must be in E.164 format (e.g., +17345551234)" },
      { status: 400 }
    );
  }
}

// Include phone in upsert
.upsert({
  venue_id,
  device_id: String(device_id),
  threshold: thresh,
  phone: phone && phone.trim() ? phone.trim() : null,
  active: true,
}, ...)
```

### 3. Update Run API (`app/api/alerts/run/route.ts`)

Add SMS sending function and integrate:

```typescript
async function sendSMS(phone: string, message: string): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.error("[SMS] Missing Twilio credentials");
    return false;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
      },
      body: new URLSearchParams({
        From: fromNumber,
        To: phone,
        Body: message,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[SMS] Failed: ${res.status} ${text}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[SMS] Error:", error);
    return false;
  }
}
```

Then in the trigger logic:

```typescript
// Replace console.log with:
if (sub.phone) {
  const message = `Venue Scout: ${venueName} is now ${label}.`;
  const sent = await sendSMS(sub.phone, message);
  
  if (sent) {
    // Update last_triggered_at only on successful send
    await supabase
      .from("alert_subscriptions")
      .update({ last_triggered_at: new Date().toISOString() })
      .eq("id", sub.id);
    triggered++;
  }
} else {
  // Still log if no phone
  console.log(`ALERT: ${venueName} reached ${label} for device ${sub.device_id}`);
}
```

### 4. Update UI (`app/v/[slug]/alertSubscription.tsx`)

Add phone input field:

```typescript
const [phone, setPhone] = useState("");

// Add to JSX:
<div>
  <label className="block text-xs opacity-70 mb-1">
    Phone (optional, E.164 format: +17345551234)
  </label>
  <input
    type="tel"
    value={phone}
    onChange={(e) => setPhone(e.target.value)}
    placeholder="+17345551234"
    disabled={busy}
    className="w-full rounded-xl border border-black/20 px-3 py-2 text-sm bg-white focus:outline-none focus:border-black"
  />
</div>

// Include in API call:
body: JSON.stringify({
  venue_id: venueId,
  device_id,
  threshold: selectedThreshold,
  phone: phone.trim() || null,
}),
```

### 5. Environment Variables

Add to `.env.local`:

```
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1234567890
```

### 6. Alternative: Push Notifications

For web push notifications instead of SMS:

1. **Add service worker** for push registration
2. **Store push subscription** in database (endpoint, keys)
3. **Send via Web Push API** using `web-push` library
4. **Request notification permission** in UI

Example structure:

```typescript
// Store push subscription
interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// Send push notification
import webpush from 'web-push';

webpush.sendNotification(
  subscription,
  JSON.stringify({
    title: 'Venue Scout Alert',
    body: `${venueName} is now ${label}`,
    icon: '/icon.png',
  })
);
```

## Migration Path

1. **Phase 1 (Current)**: Log-only alerts ✅
2. **Phase 2**: Add phone field, keep logging as fallback
3. **Phase 3**: Add SMS sending, log on failure
4. **Phase 4**: Add push notifications as alternative
5. **Phase 5**: User preference for SMS vs Push vs Email

The current implementation is designed to make this upgrade straightforward without breaking existing functionality.
