# Curb View — Coldwell Banker Select

AR listing tool for agents. Point your phone at any home in CB Select inventory and see live listing data float in 3D space, anchored to the home's GPS position.

Brand-compliant per the **Coldwell Banker Brand Guidelines (July 2025)**.

## Stack

- Single `index.html` — zero build step
- One Vercel Edge Function (`api/listings.js`) proxies the Zillow XML feed, parses to JSON, caches 5 min
- Self-hosted **Bauziet** (CB primary brand font), **Roboto** via Google Fonts, **Leaflet** via CDN
- Pure canvas for the AR overlay
- Real CB Select Horizontal Monogram DBA logo asset

## Deploy to Vercel

1. New GitHub repo, push these files at root
2. Import to Vercel — auto-detects as a static site with edge functions, no build config needed
3. In Vercel project settings → Environment Variables, add `FEED_URL` = the CB Select Zillow XML feed URL
4. Redeploy

Without `FEED_URL`, the proxy returns realistic Tulsa-area mock listings so the app demos out of the box.

## Brand compliance

This build follows the Coldwell Banker Brand Guidelines (07.2025):

### Logo usage
- Uses the **Horizontal Monogram DBA** (`Logo_133009_Select_HZ_W_MO.png`) — white on dark only
- Logo only appears on CB Blue or dark surfaces — never reversed (per page 5 of guidelines)
- Safety distance preserved around logo per the 1/2 logo-box-height rule
- Never stretched, recolored, angled, or used as a copy element

### Typography
- **Bauziet** (primary) — self-hosted via @font-face. Light, Regular, Italic, Medium, Semibold, Bold
- **Roboto** (body copy) — via Google Fonts, per spec
- **Geometos** (subheaders/stats) — substituted with Bauziet Bold all-caps until you upload Geometos OTFs

### Colors (refreshed 2025 palette)
- CB Blue `#012169` — signature
- Midnight `#0A1730` — deep ground
- Slate `#1B3C55` — body text
- Smoky Gray `#58718D` — labels
- Glacier `#DAE1E8`, Mist `#BECAD7`, Tide `#B8CFEA`, Icy Blue `#F0F5FB` — surfaces
- Bright Blue `#1F69FF`, Celestial `#418FDE` — accents

### Required disclaimer
The full Anywhere Advisors disclaimer + "not intended as a solicitation" language is rendered at the bottom of the listing detail card.

## Feed schema (validated)

Built for the actual `iq_cb_select_zillow.xml` feed (1,182 listings, 215 Tulsa). Top-level structure per `<Listing>`:

```
Location: StreetAddress, UnitNumber, City, State, Zip, Lat, Long
ListingDetails: Status, Price, ListingUrl, MlsId, VirtualTourUrl
BasicDetails: PropertyType, Description, Bedrooms, Bathrooms,
              FullBathrooms, HalfBathrooms, LivingArea (sqft),
              LotSize (acres), YearBuilt
Pictures > Picture > PictureUrl  (avg 30 photos per listing)
Agent: FirstName, LastName, EmailAddress, PictureUrl, OfficeLineNumber
Office: BrokerageName, BrokerPhone, BrokerEmail, OfficeName
RichDetails: Waterfront, Pool, Basement
OpenHouses > OpenHouse: Date, StartTime, EndTime
```

No `DaysOnMarket` or `ListDate` field exists in this feed, so the UI shows photo count instead.

## How targeting works

1. `watchPosition()` keeps user GPS lat/lng updated
2. `deviceorientation` events provide compass heading + pitch (with iOS 13+ permission flow)
3. Each animation frame:
   - Filter to listings within `searchRadius` (100m / 200m / 500m / 1km — tap Range pill to cycle)
   - Calculate bearing from user → each listing
   - Active listing = closest in bearing (±18° cone), tie-broken by distance
4. Bearing-debounced switching prevents flicker

If iOS reports compass accuracy is low (>15°), a calibration toast prompts the user to do the figure-8 motion.

## Files

```
curb-view/
├── index.html
├── vercel.json              # MIME types + cache headers for fonts and images
├── api/
│   └── listings.js          # Edge function: feed proxy + parser
├── fonts/
│   ├── Bauziet-Light.otf
│   ├── Bauziet-Regular.otf
│   ├── Bauziet-Italic.otf
│   ├── Bauziet-Medium.otf
│   ├── Bauziet-Semibold.otf
│   └── Bauziet-Bold.otf
├── img/
│   ├── cb-select-logo-white.png    (1961×200, white on transparent)
│   └── klinekraft-logo-white.png   (467×126, white on transparent)
└── README.md
```

## iOS notes

- HTTPS required for camera + device orientation (Vercel handles this automatically)
- iOS 13+ shows a permission prompt for orientation on first tap of "Begin"
- iOS Safari requires "Motion & Orientation Access" enabled in Settings → Safari → Advanced
- Best results held in portrait, mostly upright
