# Implementation Summary

## Feature A: Trend Arrow ✅

### Changes Made:
1. **Added `computeTrend()` function** to both `app/page.tsx` and `app/v/[slug]/page.tsx`
   - Compares current score (last 15 minutes) vs previous score (45-15 minutes ago)
   - Returns "up" (↑), "down" (↓), or "flat" (→) based on ±0.25 threshold

2. **Updated homepage** (`app/page.tsx`)
   - Added trend calculation to venue rows
   - Displays trend arrow next to status badge

3. **Updated venue detail page** (`app/v/[slug]/page.tsx`)
   - Added trend calculation
   - Displays trend arrow next to status badge

### Visual Design:
- Small, muted arrow (↑↓→) next to crowd status badge
- Uses `opacity-50` for subtle appearance
- Tooltip title "Trend indicator" for accessibility

---

## Feature B: Notify Me Alerts ✅

### Database Schema:
Created `alert_subscriptions` table with:
- `id` (uuid, primary key)
- `venue_id` (uuid, references venues)
- `device_id` (text, for user identification)
- `phone` (text, nullable, E.164 format)
- `threshold` (smallint, 1=Low, 2=Medium-or-lower)
- `active` (boolean, default true)
- `created_at` (timestamptz)
- `last_fired_at` (timestamptz, nullable, for cooldown)

**SQL file:** `ALERT_SUBSCRIPTIONS_SCHEMA.sql`

### Code Changes:

1. **Shared Utility** (`lib/deviceId.ts`)
   - Extracted `getDeviceId()` helper for reuse
   - Used by both report submission and alert subscription

2. **UI Component** (`app/v/[slug]/alertSubscription.tsx`)
   - Client component with threshold selection (Medium-or-lower / Low)
   - Optional phone input (E.164 format)
   - Save alert button
   - Error/success messaging

3. **API Route: Subscribe** (`app/api/alerts/subscribe/route.ts`)
   - POST endpoint for creating/updating subscriptions
   - Validates threshold (1 or 2)
   - Validates phone format (E.164) if provided
   - Upserts subscription with unique constraint on (venue_id, device_id, threshold)

4. **API Route: Run** (`app/api/alerts/run/route.ts`)
   - POST endpoint to check and fire alerts
   - Loads all active subscriptions
   - Computes current crowd level for each venue
   - Checks threshold conditions:
     - Threshold 2: fires when label <= 2 (Medium or Low)
     - Threshold 1: fires when label == 1 (Low only)
   - Enforces 60-minute cooldown via `last_fired_at`
   - Sends SMS via Twilio if env vars configured
   - Updates `last_fired_at` after successful send

5. **Updated Files:**
   - `app/v/[slug]/venueClient.tsx`: Uses shared `getDeviceId()` helper
   - `app/v/[slug]/page.tsx`: Includes `<AlertSubscription />` component

### Twilio Integration:
- Uses environment variables: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- If env vars missing, logs what would be sent (no error thrown)
- SMS message format: `"Venue Scout: {venueName} is now {label} (confidence {confidence})."`

---

## Testing

### Test Subscribe Endpoint:
```bash
curl -X POST http://localhost:3000/api/alerts/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "venue_id": "YOUR_VENUE_ID",
    "device_id": "test-device-123",
    "threshold": 2,
    "phone": "+17345551234"
  }'
```

### Test Run Endpoint:
```bash
curl -X POST http://localhost:3000/api/alerts/run \
  -H "Content-Type: application/json"
```

### Verification Checklist:
- [ ] Subscribe with threshold 2 (Medium-or-lower) → saves successfully
- [ ] Subscribe with threshold 1 (Low) → saves successfully
- [ ] Subscribe without phone → saves but won't send SMS
- [ ] Run alerts when venue is Medium/Low → fires for threshold 2
- [ ] Run alerts when venue is Low → fires for threshold 1
- [ ] Run alerts again within 60 min → respects cooldown
- [ ] Run alerts after 60 min → fires again
- [ ] Trend arrows display correctly on homepage
- [ ] Trend arrows display correctly on venue detail page

---

## Security Notes:
- Current RLS policy allows all operations (same as reports table)
- In production, should restrict by `device_id` using proper auth
- Phone numbers validated for E.164 format
- Cooldown prevents spam (60 minutes between fires)

---

## Files Modified/Created:

### Modified:
- `app/page.tsx` - Added trend calculation and display
- `app/v/[slug]/page.tsx` - Added trend calculation and alert subscription UI
- `app/v/[slug]/venueClient.tsx` - Uses shared deviceId helper

### Created:
- `lib/deviceId.ts` - Shared device ID utility
- `app/v/[slug]/alertSubscription.tsx` - Alert subscription UI component
- `app/api/alerts/subscribe/route.ts` - Subscribe API endpoint
- `app/api/alerts/run/route.ts` - Run alerts API endpoint
- `ALERT_SUBSCRIPTIONS_SCHEMA.sql` - Database schema
- `IMPLEMENTATION_SUMMARY.md` - This file
