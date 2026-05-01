# Curb View — Coldwell Banker Select

AR listing tool for agents in the field. Point your phone at any home in CB Select inventory and see live listing data float in 3D space.

## Stack

- Single `index.html` — zero build step
- One Vercel Edge Function (`api/listings.js`) proxies the Zillow XML feed
- Leaflet for the map view (loaded from CDN)
- Pure canvas for the AR overlay
- 5-minute cache on the feed proxy

## Deploy to Vercel

1. Create a new GitHub repo, push these files at the root (so `index.html` is at the root and `api/listings.js` is in `/api`)
2. Import the repo into Vercel — auto-detects as a static site with edge functions, no config needed
3. In Vercel project settings → Environment Variables, add `FEED_URL` with the CB Select Zillow XML feed URL
4. Redeploy

Until you set `FEED_URL`, the proxy returns realistic Tulsa-area mock data so you can demo and develop against the same shape.

## Wire up the real feed

When you have the feed URL:

**Option A** — environment variable (preferred):
```
FEED_URL=https://feed.cbselect.example/zillow.xml
```

**Option B** — paste it into the constant at the top of `api/listings.js`:
```js
const FEED_URL = 'https://feed.cbselect.example/zillow.xml';
```

The XML parser handles standard Zillow listing feed tags. If CB Select uses custom tag names, edit the field map in the `parseZillowXML` function — search for `get('Latitude')`, `get('ListPrice')`, etc. Each field falls through a list of likely tag names.

## How targeting works

1. `watchPosition()` keeps the user's GPS lat/lng updated continuously
2. `deviceorientation` events provide compass heading + pitch
3. On each animation frame:
   - Filter listings to those within `searchRadius` (default 200m, toggleable: 100/200/500/1000m)
   - For each, calculate bearing from user → listing
   - The "active" listing is the one closest in bearing to where the phone points (within ±18° cone), tie-broken by distance
4. Bearing-debounced switching prevents the active card from flickering when two homes are nearly aligned

## Brand

- CB Blue `#012169` for primary surfaces
- White horizontal "CB / Coldwell Banker Select" lockup (only on dark)
- Roboto Slab as Bauziet stand-in (swap to real Bauziet when self-hosting fonts)
- Roboto for data/UI
- Gold accent `#c9a876` for active targeting state

## iOS notes

- HTTPS required for camera + device orientation (Vercel handles this automatically)
- iOS 13+ shows a permission prompt for orientation on first tap of "Begin"
- Best results when held in portrait, mostly upright

## Files

```
curb-view/
├── index.html          # The whole app
├── api/
│   └── listings.js     # Vercel edge function: feed proxy + parser
└── README.md
```
