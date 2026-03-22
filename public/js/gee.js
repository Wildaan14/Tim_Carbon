// ============================================================
// gee.js — Google Earth Engine REST API v1 integration
// NDVI fetch via computePixels for Literature method
// ============================================================
//
// Authentication options:
//   A) Manual token — get from Python:
//        import ee; ee.Initialize()
//        print(ee.data.getAuthToken())
//   B) Google Sign-In — requires setting GEE_CLIENT_ID below
//        (Create OAuth2 Web Client in Google Cloud Console with
//         Earth Engine API enabled + authorized JS origin)
// ============================================================

// To use Google Sign-In: set your OAuth2 Client ID here
// Leave empty to use manual token input only
const GEE_CLIENT_ID = window.GEE_CLIENT_ID ?? '';

const GEE_SCOPE = 'https://www.googleapis.com/auth/earthengine.readonly';
const GEE_BASE  = 'https://earthengine.googleapis.com/v1';

let _geeToken = null;

// ── Token management ─────────────────────────────────────────
function geeSetToken(token) {
  _geeToken = token?.trim() || null;
}
function geeIsAuthenticated() { return !!_geeToken; }

// ── Google Sign-In (optional, requires GEE_CLIENT_ID) ────────
function geeSignIn(onSuccess, onError) {
  if (!GEE_CLIENT_ID) {
    onError?.('Client ID belum dikonfigurasi. Gunakan input token manual di bawah.');
    return;
  }
  if (!window.google?.accounts?.oauth2) {
    onError?.('Google Identity Services tidak tersedia. Gunakan token manual.');
    return;
  }
  const client = google.accounts.oauth2.initTokenClient({
    client_id: GEE_CLIENT_ID,
    scope: GEE_SCOPE,
    callback: (resp) => {
      if (resp.error) {
        onError?.(resp.error_description || resp.error);
        return;
      }
      _geeToken = resp.access_token;
      onSuccess?.();
    },
  });
  client.requestAccessToken();
}

// ── Build GEE REST API expression: Sentinel-2 SR NDVI ────────
// Loads S2_SR_HARMONIZED, filters date + cloud, sorts by cloud,
// takes least-cloudy image, returns normalizedDifference(B8, B4)
function _buildS2NdviExpr(bbox, dateStart, dateEnd, cloudMax) {
  const [west, south, east, north] = bbox;

  const geom = {
    functionInvocationValue: {
      functionName: 'GeometryConstructors.BBox',
      arguments: {
        west:  { constantValue: west  },
        south: { constantValue: south },
        east:  { constantValue: east  },
        north: { constantValue: north },
      },
    },
  };

  const s2Col = {
    functionInvocationValue: {
      functionName: 'ImageCollection.load',
      arguments: { id: { constantValue: 'COPERNICUS/S2_SR_HARMONIZED' } },
    },
  };

  const filtered = {
    functionInvocationValue: {
      functionName: 'ImageCollection.filterDate',
      arguments: {
        collection: s2Col,
        start: { constantValue: dateStart },
        end:   { constantValue: dateEnd   },
      },
    },
  };

  const cloudFiltered = {
    functionInvocationValue: {
      functionName: 'Collection.filter',
      arguments: {
        collection: filtered,
        filter: {
          functionInvocationValue: {
            functionName: 'Filter.lt',
            arguments: {
              leftField:  { constantValue: 'CLOUDY_PIXEL_PERCENTAGE' },
              rightValue: { constantValue: cloudMax },
            },
          },
        },
      },
    },
  };

  const bounded = {
    functionInvocationValue: {
      functionName: 'Collection.filterBounds',
      arguments: { collection: cloudFiltered, geometry: geom },
    },
  };

  const sorted = {
    functionInvocationValue: {
      functionName: 'Collection.sort',
      arguments: {
        collection: bounded,
        property: { constantValue: 'CLOUDY_PIXEL_PERCENTAGE' },
      },
    },
  };

  const first = {
    functionInvocationValue: {
      functionName: 'Collection.first',
      arguments: { collection: sorted },
    },
  };

  const ndvi = {
    functionInvocationValue: {
      functionName: 'Image.normalizedDifference',
      arguments: {
        input: first,
        bandSelectors: { constantValue: ['B8', 'B4'] },
      },
    },
  };

  return { result: '0', values: { '0': ndvi } };
}

// ── Fetch NDVI as GeoTIFF ArrayBuffer ─────────────────────────
// bbox: [minLng, minLat, maxLng, maxLat]
// options: { projectId, dateStart, dateEnd, cloudMax, resolution }
async function fetchNdviFromGee(bbox, options = {}) {
  const {
    projectId  = 'earthengine-legacy',
    dateStart  = `${new Date().getFullYear() - 1}-01-01`,
    dateEnd    = `${new Date().getFullYear() - 1}-12-31`,
    cloudMax   = 30,
    resolution = 0.0002,   // ~22m at equator
  } = options;

  if (!_geeToken) {
    throw new Error('Belum terautentikasi. Masukkan GEE Token atau klik "Sign in with Google".');
  }

  const [minLng, minLat, maxLng, maxLat] = bbox;
  const spanLng = Math.abs(maxLng - minLng);
  const spanLat = Math.abs(maxLat - minLat);
  const width   = Math.max(64, Math.min(512, Math.ceil(spanLng / resolution)));
  const height  = Math.max(64, Math.min(512, Math.ceil(spanLat / resolution)));
  const scaleX  = spanLng / width;
  const scaleY  = -(spanLat / height);

  const body = {
    expression: _buildS2NdviExpr(bbox, dateStart, dateEnd, cloudMax),
    grid: {
      dimensions: { width, height },
      affineTransform: {
        scaleX, shearX: 0, translateX: minLng,
        shearY: 0, scaleY, translateY: maxLat,
      },
      crsCode: 'EPSG:4326',
    },
    fileFormat: 'GEO_TIFF',
  };

  const url = `${GEE_BASE}/projects/${encodeURIComponent(projectId)}/image:computePixels`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${_geeToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let msg = `GEE error ${resp.status}`;
    try {
      const e = await resp.json();
      msg = e.error?.message || msg;
      if (resp.status === 401 || resp.status === 403) {
        _geeToken = null;
        msg = 'Token GEE tidak valid atau sudah kedaluwarsa. Masukkan token baru.';
      } else if (
        msg.toLowerCase().includes('no images') ||
        msg.toLowerCase().includes('empty collection') ||
        msg.toLowerCase().includes('first')
      ) {
        msg = `Tidak ada citra Sentinel-2 untuk area/periode yang dipilih (cloud ≤ ${cloudMax}%). Coba tahun lain atau naikkan batas cloud.`;
      }
    } catch { /* keep default msg */ }
    throw new Error(msg);
  }

  return resp.arrayBuffer();
}

// Expose to global scope
window.geeSetToken      = geeSetToken;
window.geeIsAuthenticated = geeIsAuthenticated;
window.geeSignIn        = geeSignIn;
window.fetchNdviFromGee = fetchNdviFromGee;
