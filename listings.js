// api/listings.js
// Vercel Edge Function — proxies the Coldwell Banker Select Zillow XML feed
// (iq_cb_select_zillow.xml). Parses the nested schema into a flat JSON shape
// the Curb View client expects.
//
// Set FEED_URL in Vercel project env vars (or paste below) when deploying.

export const config = { runtime: 'edge' };

// ---- CONFIG ----
const FEED_URL = ''; // <- paste CB Select feed URL here, OR set FEED_URL env var
const CACHE_TTL_SECONDS = 300; // 5 minutes
const ALLOWED_ORIGINS = ['*'];

// In-memory cache (per edge instance)
let cache = { data: null, timestamp: 0 };

export default async function handler(req) {
  const feedUrl = (typeof process !== 'undefined' && process.env && process.env.FEED_URL) || FEED_URL;

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // No feed URL configured → return realistic mock so UI works in dev
  if (!feedUrl) {
    return json({ source: 'mock', listings: MOCK_LISTINGS, count: MOCK_LISTINGS.length });
  }

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
    return json({
      source: 'mock-fallback',
      error: String(err.message || err),
      listings: MOCK_LISTINGS,
      count: MOCK_LISTINGS.length,
    });
  }
}

// =================================================================
// XML PARSER — matches the real iq_cb_select_zillow.xml schema
// =================================================================
function parseZillowXML(xml) {
  const listings = [];
  const blocks = xml.match(/<Listing>[\s\S]*?<\/Listing>/gi) || [];

  for (const block of blocks) {
    // Pull each section out so child tags don't get confused
    // (e.g. <PictureUrl> appears in <Pictures> and also in <Agent>)
    const location = extract(block, 'Location') || '';
    const details = extract(block, 'ListingDetails') || '';
    const basic = extract(block, 'BasicDetails') || '';
    const pictures = extract(block, 'Pictures') || '';
    const agent = extract(block, 'Agent') || '';
    const office = extract(block, 'Office') || '';
    const rich = extract(block, 'RichDetails') || '';
    const openHouses = extract(block, 'OpenHouses') || '';

    const lat = parseFloat(get(location, 'Lat'));
    const lng = parseFloat(get(location, 'Long'));
    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) continue;

    // Photos — only those nested inside <Pictures>
    const photos = [];
    const picBlocks = pictures.match(/<Picture>[\s\S]*?<\/Picture>/gi) || [];
    for (const pic of picBlocks) {
      const url = get(pic, 'PictureUrl');
      if (url) photos.push(url);
    }

    // Open houses
    const openHouseList = [];
    const ohBlocks = openHouses.match(/<OpenHouse>[\s\S]*?<\/OpenHouse>/gi) || [];
    for (const oh of ohBlocks) {
      openHouseList.push({
        date: get(oh, 'Date'),
        startTime: get(oh, 'StartTime'),
        endTime: get(oh, 'EndTime'),
      });
    }

    const aFirst = get(agent, 'FirstName') || '';
    const aLast = get(agent, 'LastName') || '';
    const agentName = `${aFirst} ${aLast}`.trim() || null;

    const mlsId = get(details, 'MlsId');
    const price = parseFloat((get(details, 'Price') || '0').replace(/[^0-9.]/g, ''));

    listings.push({
      id: mlsId || `${lat},${lng}`,
      mls: mlsId,
      status: get(details, 'Status') || 'Active',
      price,
      listingUrl: get(details, 'ListingUrl'),
      virtualTour: get(details, 'VirtualTourUrl'),

      address: get(location, 'StreetAddress'),
      unit: get(location, 'UnitNumber') || null,
      city: get(location, 'City'),
      state: get(location, 'State'),
      zip: get(location, 'Zip'),
      lat,
      lng,

      propertyType: get(basic, 'PropertyType'),
      description: get(basic, 'Description') || '',
      beds: parseInt(get(basic, 'Bedrooms') || '0') || null,
      baths: parseFloat(get(basic, 'Bathrooms') || '0') || null,
      fullBaths: parseInt(get(basic, 'FullBathrooms') || '0') || null,
      halfBaths: parseInt(get(basic, 'HalfBathrooms') || '0') || null,
      sqft: parseInt(get(basic, 'LivingArea') || '0') || null,
      lotSize: get(basic, 'LotSize') ? `${get(basic, 'LotSize')} acres` : null,
      yearBuilt: parseInt(get(basic, 'YearBuilt') || '0') || null,

      photos,
      photoCount: photos.length,
      openHouses: openHouseList,

      waterfront: get(rich, 'Waterfront'),
      pool: get(rich, 'Pool'),
      basement: get(rich, 'Basement'),

      agent: {
        name: agentName,
        firstName: aFirst || null,
        lastName: aLast || null,
        email: get(agent, 'EmailAddress'),
        phone: get(agent, 'OfficeLineNumber'),
        photo: get(agent, 'PictureUrl'),
      },
      office: {
        name: get(office, 'OfficeName'),
        brokerage: get(office, 'BrokerageName') || 'Coldwell Banker Select',
        phone: get(office, 'BrokerPhone'),
        email: get(office, 'BrokerEmail'),
      },
    });
  }

  return listings;
}

// Extract a section (e.g. <Location>...</Location>)
function extract(source, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = source.match(re);
  return m ? m[1] : null;
}

// Get a leaf tag value with optional CDATA stripping
function get(source, tag) {
  if (!source) return null;
  const re = new RegExp(`<${tag}[^>]*\\/?>([\\s\\S]*?)<\\/${tag}>|<${tag}\\s*\\/>`, 'i');
  const m = source.match(re);
  if (!m) return null;
  let val = (m[1] || '').trim();
  val = val.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  return val ? decodeXMLEntities(val) : null;
}

function decodeXMLEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
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

// =================================================================
// MOCK DATA — used when no FEED_URL configured
// Same shape the parser produces, real Tulsa addresses
// =================================================================
const MOCK_LISTINGS = [
  {
    id: '670001', mls: '670001', status: 'Active', price: 485000,
    listingUrl: '#', virtualTour: null,
    address: '2847 S Birmingham Pl', unit: null,
    city: 'Tulsa', state: 'OK', zip: '74114',
    lat: 36.1245, lng: -95.9522,
    propertyType: 'SingleFamily',
    description: 'Stunning Maple Ridge tudor with updated kitchen, original hardwoods throughout, and a sun-drenched backyard. Walking distance to Utica Square and Philbrook.',
    beds: 4, baths: 3, fullBaths: 2, halfBaths: 1, sqft: 2840,
    lotSize: '0.28 acres', yearBuilt: 1948,
    photos: [
      'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200&q=80',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80',
      'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1200&q=80',
    ],
    photoCount: 3, openHouses: [],
    waterfront: 'No', pool: null, basement: null,
    agent: { name: 'Jamie Rivers', firstName: 'Jamie', lastName: 'Rivers',
      email: 'jrivers@cbselect.com', phone: '(918) 555-0142', photo: null },
    office: { name: 'Tulsa Midtown', brokerage: 'Coldwell Banker Select',
      phone: '(918) 555-0100', email: null },
  },
  {
    id: '670002', mls: '670002', status: 'Active', price: 329500,
    listingUrl: '#', virtualTour: null,
    address: '1418 E 26th St', unit: null,
    city: 'Tulsa', state: 'OK', zip: '74114',
    lat: 36.1289, lng: -95.9684,
    propertyType: 'SingleFamily',
    description: 'Charming Craftsman bungalow in Brookside. Front porch, built-ins, claw-foot tub, and a detached studio in the back perfect for a home office.',
    beds: 3, baths: 2, fullBaths: 2, halfBaths: 0, sqft: 1920,
    lotSize: '0.16 acres', yearBuilt: 1925,
    photos: [
      'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80',
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80',
    ],
    photoCount: 2, openHouses: [],
    waterfront: 'No', pool: null, basement: null,
    agent: { name: 'Morgan Hale', firstName: 'Morgan', lastName: 'Hale',
      email: 'mhale@cbselect.com', phone: '(918) 555-0187', photo: null },
    office: { name: 'Tulsa Brookside', brokerage: 'Coldwell Banker Select',
      phone: '(918) 555-0101', email: null },
  },
  {
    id: '670003', mls: '670003', status: 'Pending', price: 749000,
    listingUrl: '#',
    virtualTour: 'https://my.matterport.com/show/?m=example1',
    address: '4612 S Lewis Ave', unit: null,
    city: 'Tulsa', state: 'OK', zip: '74105',
    lat: 36.1018, lng: -95.9601,
    propertyType: 'SingleFamily',
    description: 'Mid-century modern showpiece with vaulted ceilings, walls of glass, and a saltwater pool.',
    beds: 5, baths: 4, fullBaths: 3, halfBaths: 1, sqft: 4120,
    lotSize: '0.42 acres', yearBuilt: 1962,
    photos: [
      'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80',
      'https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?w=1200&q=80',
    ],
    photoCount: 2, openHouses: [],
    waterfront: 'No', pool: 'Yes', basement: null,
    agent: { name: 'Taylor Brennan', firstName: 'Taylor', lastName: 'Brennan',
      email: 'tbrennan@cbselect.com', phone: '(918) 555-0211', photo: null },
    office: { name: 'Tulsa South', brokerage: 'Coldwell Banker Select',
      phone: '(918) 555-0102', email: null },
  },
  {
    id: '670004', mls: '670004', status: 'Active', price: 215000,
    listingUrl: '#', virtualTour: null,
    address: '6024 E 31st St', unit: null,
    city: 'Tulsa', state: 'OK', zip: '74135',
    lat: 36.1158, lng: -95.8889,
    propertyType: 'SingleFamily',
    description: 'Move-in ready ranch with new roof, HVAC, and updated bathrooms.',
    beds: 3, baths: 2, fullBaths: 2, halfBaths: 0, sqft: 1450,
    lotSize: '0.19 acres', yearBuilt: 1968,
    photos: ['https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=1200&q=80'],
    photoCount: 1, openHouses: [],
    waterfront: 'No', pool: null, basement: null,
    agent: { name: 'Casey Donovan', firstName: 'Casey', lastName: 'Donovan',
      email: 'cdonovan@cbselect.com', phone: '(918) 555-0298', photo: null },
    office: { name: 'Tulsa East', brokerage: 'Coldwell Banker Select',
      phone: '(918) 555-0103', email: null },
  },
  {
    id: '670005', mls: '670005', status: 'Active', price: 1295000,
    listingUrl: '#',
    virtualTour: 'https://my.matterport.com/show/?m=example2',
    address: '3505 S Madison Ave', unit: null,
    city: 'Tulsa', state: 'OK', zip: '74105',
    lat: 36.1142, lng: -95.9512,
    propertyType: 'SingleFamily',
    description: 'Magnificent Maple Ridge estate. Limestone exterior, slate roof, four fireplaces.',
    beds: 5, baths: 5, fullBaths: 4, halfBaths: 1, sqft: 5680,
    lotSize: '0.61 acres', yearBuilt: 1932,
    photos: [
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&q=80',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200&q=80',
    ],
    photoCount: 2, openHouses: [],
    waterfront: 'No', pool: 'Yes', basement: null,
    agent: { name: 'Sloane Whitaker', firstName: 'Sloane', lastName: 'Whitaker',
      email: 'swhitaker@cbselect.com', phone: '(918) 555-0334', photo: null },
    office: { name: 'Tulsa Midtown', brokerage: 'Coldwell Banker Select',
      phone: '(918) 555-0100', email: null },
  },
  {
    id: '670006', mls: '670006', status: 'Active', price: 425000,
    listingUrl: '#', virtualTour: null,
    address: '8814 S Granite Ave', unit: null,
    city: 'Tulsa', state: 'OK', zip: '74137',
    lat: 36.0512, lng: -95.9156,
    propertyType: 'SingleFamily',
    description: 'Spacious Jenks-area home with open floor plan and three-car garage.',
    beds: 4, baths: 3, fullBaths: 2, halfBaths: 1, sqft: 3220,
    lotSize: '0.24 acres', yearBuilt: 2008,
    photos: ['https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=1200&q=80'],
    photoCount: 1, openHouses: [],
    waterfront: 'No', pool: null, basement: null,
    agent: { name: 'Jordan Pace', firstName: 'Jordan', lastName: 'Pace',
      email: 'jpace@cbselect.com', phone: '(918) 555-0376', photo: null },
    office: { name: 'Tulsa South', brokerage: 'Coldwell Banker Select',
      phone: '(918) 555-0102', email: null },
  },
  {
    id: '670011', mls: '670011', status: 'Active', price: 359000,
    listingUrl: '#', virtualTour: null,
    address: '1822 S Florence Ave', unit: null,
    city: 'Tulsa', state: 'OK', zip: '74104',
    lat: 36.1402, lng: -95.9622,
    propertyType: 'SingleFamily',
    description: 'Restored Cherry Street tudor with original arched doorways and leaded glass.',
    beds: 3, baths: 2, fullBaths: 2, halfBaths: 0, sqft: 2100,
    lotSize: '0.17 acres', yearBuilt: 1936,
    photos: ['https://images.unsplash.com/photo-1605146768851-eda79da39897?w=1200&q=80'],
    photoCount: 1, openHouses: [],
    waterfront: 'No', pool: null, basement: null,
    agent: { name: 'Hayden Castellano', firstName: 'Hayden', lastName: 'Castellano',
      email: 'hcastellano@cbselect.com', phone: '(918) 555-0563', photo: null },
    office: { name: 'Tulsa Cherry Street', brokerage: 'Coldwell Banker Select',
      phone: '(918) 555-0104', email: null },
  },
];
