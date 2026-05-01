// api/listings.js
// Vercel Edge Function — proxies Coldwell Banker Select Zillow XML feed.
// Drop into the api/ folder of a Vercel project. Set FEED_URL env var,
// or paste your URL into the FEED_URL constant below.

export const config = { runtime: 'edge' };

// ---- CONFIG ----
// Either set FEED_URL in Vercel project env vars, or hardcode here.
const FEED_URL = ''; // <- paste CB Select Zillow XML feed URL here when ready

const CACHE_TTL_SECONDS = 300; // 5 minutes
const ALLOWED_ORIGINS = ['*']; // tighten when deployed

// In-memory cache (per edge instance)
let cache = { data: null, timestamp: 0 };

export default async function handler(req) {
  const url = new URL(req.url);
  const feedUrl = process.env.FEED_URL || FEED_URL;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // If no feed URL configured, return realistic mock data so the UI is testable
  if (!feedUrl) {
    return json({ source: 'mock', listings: MOCK_LISTINGS, count: MOCK_LISTINGS.length });
  }

  // Serve cache if fresh
  const now = Date.now();
  if (cache.data && (now - cache.timestamp) / 1000 < CACHE_TTL_SECONDS) {
    return json({ source: 'cache', ...cache.data });
  }

  try {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'CBSelect-CurbView/1.0' },
    });
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const xml = await response.text();
    const listings = parseZillowXML(xml);

    cache = { data: { listings, count: listings.length }, timestamp: now };
    return json({ source: 'live', listings, count: listings.length });
  } catch (err) {
    // Fall back to mock on error so the agent isn't stranded in the field
    return json({
      source: 'mock-fallback',
      error: String(err.message || err),
      listings: MOCK_LISTINGS,
      count: MOCK_LISTINGS.length,
    });
  }
}

// ---- Zillow XML parser ----
// Handles the standard Zillow listing feed format. Adjust field paths
// if the CB Select feed uses custom tags.
function parseZillowXML(xml) {
  const listings = [];
  // Match <Listing> blocks (case-insensitive, handles <listing> too)
  const blocks = xml.match(/<Listing[\s\S]*?<\/Listing>/gi) || [];

  for (const block of blocks) {
    const get = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const m = block.match(re);
      if (!m) return null;
      return decodeXMLEntities(m[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
    };

    const getAll = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
      const matches = [];
      let m;
      while ((m = re.exec(block)) !== null) {
        matches.push(decodeXMLEntities(m[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')));
      }
      return matches;
    };

    const lat = parseFloat(get('Latitude') || get('lat'));
    const lng = parseFloat(get('Longitude') || get('lng') || get('long'));
    if (isNaN(lat) || isNaN(lng)) continue;

    const photos = getAll('Picture')
      .map((p) => {
        const urlMatch = p.match(/<PictureURL>([\s\S]*?)<\/PictureURL>/i);
        return urlMatch ? urlMatch[1].trim() : p; // raw URL fallback
      })
      .filter(Boolean);

    listings.push({
      id: get('MlsId') || get('ListingID') || get('MLSNumber') || `${lat},${lng}`,
      mls: get('MlsId') || get('MLSNumber'),
      status: get('Status') || 'Active',
      price: parseFloat((get('ListPrice') || '0').replace(/[^0-9.]/g, '')),
      address: get('Address') || get('StreetAddress'),
      city: get('City'),
      state: get('State'),
      zip: get('Zip') || get('PostalCode'),
      lat,
      lng,
      beds: parseInt(get('Bedrooms') || '0'),
      baths: parseFloat(get('Bathrooms') || get('BathsTotal') || '0'),
      sqft: parseInt((get('SquareFeet') || get('LivingArea') || '0').replace(/[^0-9]/g, '')),
      lotSize: get('LotSize'),
      yearBuilt: parseInt(get('YearBuilt') || '0') || null,
      propertyType: get('PropertyType') || get('PropertySubType'),
      description: get('Description') || get('PublicRemarks') || '',
      daysOnMarket: parseInt(get('DaysOnMarket') || '0') || null,
      listDate: get('ListingDate') || get('ListDate'),
      photos,
      virtualTour: get('VirtualTourURL') || get('VirtualTour'),
      agent: {
        name: get('ListingAgentFullName') || get('AgentName'),
        phone: get('ListingAgentPhone') || get('AgentPhone'),
        email: get('ListingAgentEmail') || get('AgentEmail'),
      },
      brokerage: get('ListingOfficeName') || 'Coldwell Banker Select',
    });
  }

  return listings;
}

function decodeXMLEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.join(','),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
    },
  });
}

// ---- Mock data ----
// Realistic Tulsa-area listings spread across neighborhoods so the
// agent tool works out-of-the-box for demos and dev.
const MOCK_LISTINGS = [
  {
    id: 'MOCK-1001',
    mls: '2401001',
    status: 'Active',
    price: 485000,
    address: '2847 S Birmingham Pl',
    city: 'Tulsa', state: 'OK', zip: '74114',
    lat: 36.1245, lng: -95.9522,
    beds: 4, baths: 3, sqft: 2840,
    lotSize: '0.28 acres', yearBuilt: 1948,
    propertyType: 'Single Family',
    description: 'Stunning Maple Ridge tudor with updated kitchen, original hardwoods throughout, and a sun-drenched backyard. Walking distance to Utica Square and Philbrook.',
    daysOnMarket: 12,
    listDate: '2026-04-18',
    photos: [
      'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80',
      'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1200&q=80',
    ],
    virtualTour: null,
    agent: { name: 'Jamie Rivers', phone: '918-555-0142', email: 'jrivers@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1002',
    mls: '2401002',
    status: 'Active',
    price: 329500,
    address: '1418 E 26th St',
    city: 'Tulsa', state: 'OK', zip: '74114',
    lat: 36.1289, lng: -95.9684,
    beds: 3, baths: 2, sqft: 1920,
    lotSize: '0.16 acres', yearBuilt: 1925,
    propertyType: 'Single Family',
    description: 'Charming Craftsman bungalow in Brookside. Front porch, built-ins, claw-foot tub, and a detached studio in the back perfect for a home office.',
    daysOnMarket: 5,
    listDate: '2026-04-25',
    photos: [
      'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80',
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80',
    ],
    virtualTour: null,
    agent: { name: 'Morgan Hale', phone: '918-555-0187', email: 'mhale@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1003',
    mls: '2401003',
    status: 'Pending',
    price: 749000,
    address: '4612 S Lewis Ave',
    city: 'Tulsa', state: 'OK', zip: '74105',
    lat: 36.1018, lng: -95.9601,
    beds: 5, baths: 4, sqft: 4120,
    lotSize: '0.42 acres', yearBuilt: 1962,
    propertyType: 'Single Family',
    description: 'Mid-century modern showpiece with vaulted ceilings, walls of glass, and a saltwater pool. Recently renovated kitchen and primary suite.',
    daysOnMarket: 28,
    listDate: '2026-04-02',
    photos: [
      'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80',
      'https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?w=1200&q=80',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&q=80',
    ],
    virtualTour: 'https://my.matterport.com/show/?m=example1',
    agent: { name: 'Taylor Brennan', phone: '918-555-0211', email: 'tbrennan@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1004',
    mls: '2401004',
    status: 'Active',
    price: 215000,
    address: '6024 E 31st St',
    city: 'Tulsa', state: 'OK', zip: '74135',
    lat: 36.1158, lng: -95.8889,
    beds: 3, baths: 2, sqft: 1450,
    lotSize: '0.19 acres', yearBuilt: 1968,
    propertyType: 'Single Family',
    description: 'Move-in ready ranch with new roof, HVAC, and updated bathrooms. Fenced backyard with mature trees. Excellent first-time buyer opportunity.',
    daysOnMarket: 3,
    listDate: '2026-04-27',
    photos: [
      'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=1200&q=80',
      'https://images.unsplash.com/photo-1502673530728-f79b4cab31b1?w=1200&q=80',
    ],
    virtualTour: null,
    agent: { name: 'Casey Donovan', phone: '918-555-0298', email: 'cdonovan@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1005',
    mls: '2401005',
    status: 'Active',
    price: 1295000,
    address: '3505 S Madison Ave',
    city: 'Tulsa', state: 'OK', zip: '74105',
    lat: 36.1142, lng: -95.9512,
    beds: 5, baths: 5, sqft: 5680,
    lotSize: '0.61 acres', yearBuilt: 1932,
    propertyType: 'Single Family',
    description: 'Magnificent Maple Ridge estate. Limestone exterior, slate roof, four fireplaces, library with original millwork, and formal gardens designed by the original landscape architect.',
    daysOnMarket: 45,
    listDate: '2026-03-16',
    photos: [
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200&q=80',
      'https://images.unsplash.com/photo-1600566753086-00f18fe6ba68?w=1200&q=80',
    ],
    virtualTour: 'https://my.matterport.com/show/?m=example2',
    agent: { name: 'Sloane Whitaker', phone: '918-555-0334', email: 'swhitaker@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1006',
    mls: '2401006',
    status: 'Active',
    price: 425000,
    address: '8814 S Granite Ave',
    city: 'Tulsa', state: 'OK', zip: '74137',
    lat: 36.0512, lng: -95.9156,
    beds: 4, baths: 3, sqft: 3220,
    lotSize: '0.24 acres', yearBuilt: 2008,
    propertyType: 'Single Family',
    description: 'Spacious Jenks-area home with open floor plan, gourmet kitchen, and three-car garage. Backs up to greenbelt with walking trails.',
    daysOnMarket: 18,
    listDate: '2026-04-12',
    photos: [
      'https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=1200&q=80',
      'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1200&q=80',
    ],
    virtualTour: null,
    agent: { name: 'Jordan Pace', phone: '918-555-0376', email: 'jpace@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1007',
    mls: '2401007',
    status: 'Active',
    price: 178900,
    address: '4427 N Trenton Ave',
    city: 'Tulsa', state: 'OK', zip: '74106',
    lat: 36.1888, lng: -95.9589,
    beds: 2, baths: 1, sqft: 1080,
    lotSize: '0.14 acres', yearBuilt: 1947,
    propertyType: 'Single Family',
    description: 'Updated North Tulsa cottage. New paint, refinished floors, modern kitchen. Investor-friendly with solid rental history.',
    daysOnMarket: 8,
    listDate: '2026-04-22',
    photos: [
      'https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=1200&q=80',
    ],
    virtualTour: null,
    agent: { name: 'Riley Mercer', phone: '918-555-0412', email: 'rmercer@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1008',
    mls: '2401008',
    status: 'Active',
    price: 595000,
    address: '11220 S Yorktown Ave',
    city: 'Tulsa', state: 'OK', zip: '74137',
    lat: 36.0214, lng: -95.9445,
    beds: 4, baths: 4, sqft: 3850,
    lotSize: '0.32 acres', yearBuilt: 2016,
    propertyType: 'Single Family',
    description: 'Better-than-new construction in gated community. Designer finishes, smart home throughout, resort-style backyard with covered patio and outdoor kitchen.',
    daysOnMarket: 21,
    listDate: '2026-04-09',
    photos: [
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80',
      'https://images.unsplash.com/photo-1600563438938-a9a27215d8b5?w=1200&q=80',
    ],
    virtualTour: 'https://my.matterport.com/show/?m=example3',
    agent: { name: 'Avery Lindstrom', phone: '918-555-0445', email: 'alindstrom@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1009',
    mls: '2401009',
    status: 'Active',
    price: 268000,
    address: '7715 E 65th St',
    city: 'Tulsa', state: 'OK', zip: '74133',
    lat: 36.0598, lng: -95.8634,
    beds: 3, baths: 2, sqft: 1780,
    lotSize: '0.20 acres', yearBuilt: 1985,
    propertyType: 'Single Family',
    description: 'Well-maintained South Tulsa home in established neighborhood. Updated kitchen, large family room with fireplace, screened porch.',
    daysOnMarket: 15,
    listDate: '2026-04-15',
    photos: [
      'https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=1200&q=80',
    ],
    virtualTour: null,
    agent: { name: 'Quinn Bradford', phone: '918-555-0489', email: 'qbradford@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1010',
    mls: '2401010',
    status: 'Active',
    price: 875000,
    address: '5208 E 110th Pl',
    city: 'Tulsa', state: 'OK', zip: '74137',
    lat: 36.0289, lng: -95.8912,
    beds: 5, baths: 5, sqft: 4720,
    lotSize: '0.45 acres', yearBuilt: 2019,
    propertyType: 'Single Family',
    description: 'Custom luxury in coveted Forest Ridge. Soaring two-story foyer, chef\'s kitchen with butler\'s pantry, primary suite with spa bath, wine cellar, and pool.',
    daysOnMarket: 32,
    listDate: '2026-03-29',
    photos: [
      'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1200&q=80',
      'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?w=1200&q=80',
    ],
    virtualTour: 'https://my.matterport.com/show/?m=example4',
    agent: { name: 'Reese Fontaine', phone: '918-555-0521', email: 'rfontaine@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1011',
    mls: '2401011',
    status: 'Active',
    price: 359000,
    address: '1822 S Florence Ave',
    city: 'Tulsa', state: 'OK', zip: '74104',
    lat: 36.1402, lng: -95.9622,
    beds: 3, baths: 2, sqft: 2100,
    lotSize: '0.17 acres', yearBuilt: 1936,
    propertyType: 'Single Family',
    description: 'Restored Cherry Street tudor with original arched doorways, leaded glass, and refinished hardwoods. Updated systems throughout. Walk to restaurants and Whole Foods.',
    daysOnMarket: 9,
    listDate: '2026-04-21',
    photos: [
      'https://images.unsplash.com/photo-1605146768851-eda79da39897?w=1200&q=80',
      'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=1200&q=80',
    ],
    virtualTour: null,
    agent: { name: 'Hayden Castellano', phone: '918-555-0563', email: 'hcastellano@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
  {
    id: 'MOCK-1012',
    mls: '2401012',
    status: 'Active',
    price: 152500,
    address: '9012 E Admiral Pl',
    city: 'Tulsa', state: 'OK', zip: '74115',
    lat: 36.1738, lng: -95.8501,
    beds: 3, baths: 1, sqft: 1240,
    lotSize: '0.18 acres', yearBuilt: 1955,
    propertyType: 'Single Family',
    description: 'Solid East Tulsa ranch with fresh paint and new flooring. Detached two-car garage. Great starter home or rental investment.',
    daysOnMarket: 6,
    listDate: '2026-04-24',
    photos: [
      'https://images.unsplash.com/photo-1572120360610-d971b9d7767c?w=1200&q=80',
    ],
    virtualTour: null,
    agent: { name: 'Drew Ashworth', phone: '918-555-0598', email: 'dashworth@cbselect.com' },
    brokerage: 'Coldwell Banker Select',
  },
];
