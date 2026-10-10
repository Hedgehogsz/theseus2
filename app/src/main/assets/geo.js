/* Offline geodesy and astronomy for the tools. No network, no dependencies.
 *  - WGS84 (GPS) <-> OSGB36 British National Grid via the OS 7-parameter Helmert transform (accurate to ~5 m)
 *    and the Transverse Mercator projection (OS "A guide to coordinate systems in Great Britain", Annex B/C).
 *  - Magnetic declination from the World Magnetic Model WMM2025 (NOAA/BGS, public domain coefficients), valid 2025-2030.
 *  - Sun position, sunrise/sunset/civil twilight and moon phase from standard low-precision formulas
 *    (Astronomical Almanac / "Astronomy Answers"); good to a minute or two in the UK.
 */
(function (root) {
  "use strict";
  var PI = Math.PI, rad = PI / 180, deg = 180 / PI;
  var sin = Math.sin, cos = Math.cos, tan = Math.tan, atan2 = Math.atan2, asin = Math.asin, acos = Math.acos, sqrt = Math.sqrt;

  // ------------------------------------------------------------------ ellipsoids and Helmert
  var WGS84 = { a: 6378137, b: 6356752.314245 };
  var AIRY = { a: 6377563.396, b: 6356256.909 };
  // WGS84 -> OSGB36 (OS published parameters); the inverse uses the negated parameters.
  var HELMERT = { tx: -446.448, ty: 125.157, tz: -542.060, s: 20.4894, rx: -0.1502, ry: -0.2470, rz: -0.8421 };

  function toCartesian(lat, lon, h, e) {
    var e2 = 1 - (e.b * e.b) / (e.a * e.a), sl = sin(lat * rad), cl = cos(lat * rad);
    var nu = e.a / sqrt(1 - e2 * sl * sl);
    return [(nu + h) * cl * cos(lon * rad), (nu + h) * cl * sin(lon * rad), ((1 - e2) * nu + h) * sl];
  }
  function fromCartesian(p, e) {
    var x = p[0], y = p[1], z = p[2], e2 = 1 - (e.b * e.b) / (e.a * e.a);
    var pp = sqrt(x * x + y * y), lat = atan2(z, pp * (1 - e2)), lat0 = 2 * PI, nu = e.a, i = 0;
    while (Math.abs(lat - lat0) > 1e-12 && i++ < 20) {
      nu = e.a / sqrt(1 - e2 * sin(lat) * sin(lat));
      lat0 = lat;
      lat = atan2(z + e2 * nu * sin(lat), pp);
    }
    return { lat: lat * deg, lon: atan2(y, x) * deg, h: pp / cos(lat) - nu };
  }
  function helmert(p, t, sign) {
    var tx = sign * t.tx, ty = sign * t.ty, tz = sign * t.tz, s1 = 1 + sign * t.s / 1e6;
    var rx = sign * (t.rx / 3600) * rad, ry = sign * (t.ry / 3600) * rad, rz = sign * (t.rz / 3600) * rad;
    var x = p[0], y = p[1], z = p[2];
    return [tx + x * s1 - y * rz + z * ry, ty + x * rz + y * s1 - z * rx, tz - x * ry + y * rx + z * s1];
  }

  // ------------------------------------------------------------------ Transverse Mercator (National Grid)
  var F0 = 0.9996012717, LAT0 = 49 * rad, LON0 = -2 * rad, E0 = 400000, N0 = -100000;
  function meridional(phi) {
    var a = AIRY.a, b = AIRY.b, n = (a - b) / (a + b), n2 = n * n, n3 = n2 * n, dp = phi - LAT0, sp = phi + LAT0;
    return b * F0 * ((1 + n + 5 / 4 * n2 + 5 / 4 * n3) * dp - (3 * n + 3 * n2 + 21 / 8 * n3) * sin(dp) * cos(sp) +
      (15 / 8 * n2 + 15 / 8 * n3) * sin(2 * dp) * cos(2 * sp) - (35 / 24 * n3) * sin(3 * dp) * cos(3 * sp));
  }
  function tmForward(latDeg, lonDeg) {
    var a = AIRY.a, b = AIRY.b, e2 = 1 - (b * b) / (a * a), phi = latDeg * rad, lam = lonDeg * rad;
    var s = sin(phi), c = cos(phi), t = tan(phi);
    var nu = a * F0 / sqrt(1 - e2 * s * s), rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), eta2 = nu / rho - 1;
    var M = meridional(phi), c3 = c * c * c, c5 = c3 * c * c, t2 = t * t, t4 = t2 * t2;
    var I = M + N0, II = nu / 2 * s * c, III = nu / 24 * s * c3 * (5 - t2 + 9 * eta2), IIIA = nu / 720 * s * c5 * (61 - 58 * t2 + t4);
    var IV = nu * c, V = nu / 6 * c3 * (nu / rho - t2), VI = nu / 120 * c5 * (5 - 18 * t2 + t4 + 14 * eta2 - 58 * t2 * eta2);
    var dl = lam - LON0, d2 = dl * dl, d3 = d2 * dl, d4 = d3 * dl, d5 = d4 * dl, d6 = d5 * dl;
    return { e: E0 + IV * dl + V * d3 + VI * d5, n: I + II * d2 + III * d4 + IIIA * d6 };
  }
  function tmInverse(E, N) {
    var a = AIRY.a, b = AIRY.b, e2 = 1 - (b * b) / (a * a), phi = LAT0, M = 0;
    do { phi = (N - N0 - M) / (a * F0) + phi; M = meridional(phi); } while (Math.abs(N - N0 - M) >= 0.00001);
    var s = sin(phi), c = cos(phi), t = tan(phi);
    var nu = a * F0 / sqrt(1 - e2 * s * s), rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), eta2 = nu / rho - 1;
    var t2 = t * t, t4 = t2 * t2, t6 = t4 * t2, sec = 1 / c, nu3 = nu * nu * nu, nu5 = nu3 * nu * nu, nu7 = nu5 * nu * nu;
    var VII = t / (2 * rho * nu), VIII = t / (24 * rho * nu3) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2), IX = t / (720 * rho * nu5) * (61 + 90 * t2 + 45 * t4);
    var X = sec / nu, XI = sec / (6 * nu3) * (nu / rho + 2 * t2), XII = sec / (120 * nu5) * (5 + 28 * t2 + 24 * t4), XIIA = sec / (5040 * nu7) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);
    var dE = E - E0, d2 = dE * dE, d3 = d2 * dE, d4 = d3 * dE, d5 = d4 * dE, d6 = d5 * dE, d7 = d6 * dE;
    return { lat: (phi - VII * d2 + VIII * d4 - IX * d6) * deg, lon: (LON0 + X * dE - XI * d3 + XII * d5 - XIIA * d7) * deg };
  }

  /** GPS lat/lon (WGS84, degrees) -> { e, n } British National Grid metres, or null outside the grid. */
  function toOSGB(lat, lon) {
    var p = fromCartesian(helmert(toCartesian(lat, lon, 0, WGS84), HELMERT, 1), AIRY);
    var g = tmForward(p.lat, p.lon);
    if (g.e < 0 || g.e >= 700000 || g.n < 0 || g.n >= 1300000) return null;
    return g;
  }
  /** National Grid metres -> GPS lat/lon (WGS84). */
  function fromOSGB(e, n) {
    var p = tmInverse(e, n);
    var w = fromCartesian(helmert(toCartesian(p.lat, p.lon, 0, AIRY), HELMERT, -1), WGS84);
    return { lat: w.lat, lon: w.lon };
  }
  /** Grid metres -> "NY 26603 22410" style reference with 'digits' figures in total (6, 8 or 10). */
  function gridRef(g, digits) {
    if (!g) return "";
    digits = digits || 8;
    var e100 = Math.floor(g.e / 100000), n100 = Math.floor(g.n / 100000);
    if (e100 < 0 || e100 > 6 || n100 < 0 || n100 > 12) return "";
    var l1 = (19 - n100) - (19 - n100) % 5 + Math.floor((e100 + 10) / 5);
    var l2 = ((19 - n100) * 5) % 25 + (e100 % 5);
    if (l1 > 7) l1++;
    if (l2 > 7) l2++;
    var half = digits / 2, div = Math.pow(10, 5 - half);
    var ee = String(Math.floor((g.e % 100000) / div)), nn = String(Math.floor((g.n % 100000) / div));
    while (ee.length < half) ee = "0" + ee;
    while (nn.length < half) nn = "0" + nn;
    return String.fromCharCode(l1 + 65) + String.fromCharCode(l2 + 65) + " " + ee + " " + nn;
  }
  /** "NY 266 224" / "NY2660322410" -> { e, n } (centre of the square it describes), or null. */
  function parseGridRef(s) {
    var m = String(s || "").toUpperCase().replace(/\s+/g, "").match(/^([HJNOST])([A-HJ-Z])(\d*)$/);
    if (!m || m[3].length % 2 || m[3].length > 10) return null;
    var l1 = m[1].charCodeAt(0) - 65, l2 = m[2].charCodeAt(0) - 65;
    if (l1 > 7) l1--;
    if (l2 > 7) l2--;
    var e100 = ((l1 - 2) % 5) * 5 + (l2 % 5), n100 = (19 - Math.floor(l1 / 5) * 5) - Math.floor(l2 / 5);
    var half = m[3].length / 2, unit = Math.pow(10, 5 - half);
    var e = half ? parseInt(m[3].slice(0, half), 10) * unit : 0, n = half ? parseInt(m[3].slice(half), 10) * unit : 0;
    return { e: e100 * 100000 + e + unit / 2, n: n100 * 100000 + n + unit / 2 };
  }

  // ------------------------------------------------------------------ distance and bearing
  function distance(a, b) {
    var R = 6371008.8, p1 = a.lat * rad, p2 = b.lat * rad, dp = p2 - p1, dl = (b.lon - a.lon) * rad;
    var h = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2);
    return 2 * R * atan2(sqrt(h), sqrt(1 - h));
  }
  /** Initial true bearing from a to b, degrees 0-360. */
  function bearing(a, b) {
    var p1 = a.lat * rad, p2 = b.lat * rad, dl = (b.lon - a.lon) * rad;
    var y = sin(dl) * cos(p2), x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl);
    return (atan2(y, x) * deg + 360) % 360;
  }

  // ------------------------------------------------------------------ WMM2025 declination
  // Rows: [n, m, g, h, g-dot, h-dot] in nT and nT/year, epoch 2025.0.
  var WMM = [[1,0,-29351.8,0,12,0],[1,1,-1410.8,4545.4,9.7,-21.5],[2,0,-2556.6,0,-11.6,0],[2,1,2951.1,-3133.6,-5.2,-27.7],[2,2,1649.3,-815.1,-8,-12.1],[3,0,1361,0,-1.3,0],[3,1,-2404.1,-56.6,-4.2,4],[3,2,1243.8,237.5,0.4,-0.3],[3,3,453.6,-549.5,-15.6,-4.1],[4,0,895,0,-1.6,0],[4,1,799.5,278.6,-2.4,-1.1],[4,2,55.7,-133.9,-6,4.1],[4,3,-281.1,212,5.6,1.6],[4,4,12.1,-375.6,-7,-4.4],[5,0,-233.2,0,0.6,0],[5,1,368.9,45.4,1.4,-0.5],[5,2,187.2,220.2,0,2.2],[5,3,-138.7,-122.9,0.6,0.4],[5,4,-142,43,2.2,1.7],[5,5,20.9,106.1,0.9,1.9],[6,0,64.4,0,-0.2,0],[6,1,63.8,-18.4,-0.4,0.3],[6,2,76.9,16.8,0.9,-1.6],[6,3,-115.7,48.8,1.2,-0.4],[6,4,-40.9,-59.8,-0.9,0.9],[6,5,14.9,10.9,0.3,0.7],[6,6,-60.7,72.7,0.9,0.9],[7,0,79.5,0,0,0],[7,1,-77,-48.9,-0.1,0.6],[7,2,-8.8,-14.4,-0.1,0.5],[7,3,59.3,-1,0.5,-0.8],[7,4,15.8,23.4,-0.1,0],[7,5,2.5,-7.4,-0.8,-1],[7,6,-11.1,-25.1,-0.8,0.6],[7,7,14.2,-2.3,0.8,-0.2],[8,0,23.2,0,-0.1,0],[8,1,10.8,7.1,0.2,-0.2],[8,2,-17.5,-12.6,0,0.5],[8,3,2,11.4,0.5,-0.4],[8,4,-21.7,-9.7,-0.1,0.4],[8,5,16.9,12.7,0.3,-0.5],[8,6,15,0.7,0.2,-0.6],[8,7,-16.8,-5.2,0,0.3],[8,8,0.9,3.9,0.2,0.2],[9,0,4.6,0,0,0],[9,1,7.8,-24.8,-0.1,-0.3],[9,2,3,12.2,0.1,0.3],[9,3,-0.2,8.3,0.3,-0.3],[9,4,-2.5,-3.3,-0.3,0.3],[9,5,-13.1,-5.2,0,0.2],[9,6,2.4,7.2,0.3,-0.1],[9,7,8.6,-0.6,-0.1,-0.2],[9,8,-8.7,0.8,0.1,0.4],[9,9,-12.9,10,-0.1,0.1],[10,0,-1.3,0,0.1,0],[10,1,-6.4,3.3,0,0],[10,2,0.2,0,0.1,0],[10,3,2,2.4,0.1,-0.2],[10,4,-1,5.3,0,0.1],[10,5,-0.6,-9.1,-0.3,-0.1],[10,6,-0.9,0.4,0,0.1],[10,7,1.5,-4.2,-0.1,0],[10,8,0.9,-3.8,-0.1,-0.1],[10,9,-2.7,0.9,0,0.2],[10,10,-3.9,-9.1,0,0],[11,0,2.9,0,0,0],[11,1,-1.5,0,0,0],[11,2,-2.5,2.9,0,0.1],[11,3,2.4,-0.6,0,0],[11,4,-0.6,0.2,0,0.1],[11,5,-0.1,0.5,-0.1,0],[11,6,-0.6,-0.3,0,0],[11,7,-0.1,-1.2,0,0.1],[11,8,1.1,-1.7,-0.1,0],[11,9,-1,-2.9,-0.1,0],[11,10,-0.2,-1.8,-0.1,0],[11,11,2.6,-2.3,-0.1,0],[12,0,-2,0,0,0],[12,1,-0.2,-1.3,0,0],[12,2,0.3,0.7,0,0],[12,3,1.2,1,0,-0.1],[12,4,-1.3,-1.4,0,0.1],[12,5,0.6,0,0,0],[12,6,0.6,0.6,0.1,0],[12,7,0.5,-0.1,0,0],[12,8,-0.1,0.8,0,0],[12,9,-0.4,0.1,0,0],[12,10,-0.2,-1,-0.1,0],[12,11,-1.3,0.1,0,0],[12,12,-0.7,0.2,-0.1,-0.1]];
  var WMM_EPOCH = 2025.0, NMAX = 12, RE = 6371.2;
  function decimalYear(date) {
    var y = date.getUTCFullYear(), start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
    return y + (date.getTime() - start) / (end - start);
  }
  /** Magnetic declination in degrees (east positive) at lat/lon (deg), height (m, default 0) and date. */
  function declination(lat, lon, heightM, date) {
    var t = decimalYear(date || new Date()) - WMM_EPOCH;
    var g = [], h = [], i, n, m;
    for (n = 0; n <= NMAX; n++) { g.push([]); h.push([]); for (m = 0; m <= NMAX; m++) { g[n].push(0); h[n].push(0); } }
    for (i = 0; i < WMM.length; i++) {
      var r0 = WMM[i];
      g[r0[0]][r0[1]] = r0[2] + t * r0[4];
      h[r0[0]][r0[1]] = r0[3] + t * r0[5];
    }
    // Geodetic -> geocentric spherical.
    var a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f), hk = (heightM || 0) / 1000;
    var phi = lat * rad, lam = lon * rad, sp = sin(phi), cp = cos(phi);
    var Rc = a / sqrt(1 - e2 * sp * sp), px = (Rc + hk) * cp, pz = (Rc * (1 - e2) + hk) * sp;
    var r = sqrt(px * px + pz * pz), phic = asin(pz / r);
    // Schmidt semi-normalised associated Legendre functions of sin(phic) and their derivatives wrt latitude.
    var x = sin(phic), y = cos(phic);
    var P = [], dP = [];
    for (n = 0; n <= NMAX; n++) { P.push([]); dP.push([]); for (m = 0; m <= NMAX; m++) { P[n].push(0); dP[n].push(0); } }
    P[0][0] = 1;
    for (n = 1; n <= NMAX; n++) {
      for (m = 0; m <= n; m++) {
        if (n === m) {
          var k = n === 1 ? 1 : sqrt((2 * n - 1) / (2 * n));
          P[n][m] = k * y * P[n - 1][m - 1];
          dP[n][m] = k * (y * dP[n - 1][m - 1] - x * P[n - 1][m - 1]);
        } else {
          var k1 = (2 * n - 1) / sqrt(n * n - m * m), k2 = n - 1 >= m ? sqrt(((n - 1) * (n - 1) - m * m) / (n * n - m * m)) : 0;
          P[n][m] = k1 * x * P[n - 1][m] - (n >= 2 ? k2 * P[n - 2][m] : 0);
          dP[n][m] = k1 * (x * dP[n - 1][m] + y * P[n - 1][m]) - (n >= 2 ? k2 * dP[n - 2][m] : 0);
        }
      }
    }
    // Field components (WMM technical report eq. 10-12); P and dP above are already Schmidt semi-normalised.
    var X = 0, Y = 0, Z = 0;
    for (n = 1; n <= NMAX; n++) {
      var ar = Math.pow(RE / r, n + 2);
      for (m = 0; m <= n; m++) {
        var cm = cos(m * lam), sm = sin(m * lam);
        var gc = g[n][m] * cm + h[n][m] * sm;
        X -= ar * gc * dP[n][m];
        Y += ar * m * (g[n][m] * sm - h[n][m] * cm) * P[n][m] / y;
        Z -= ar * (n + 1) * gc * P[n][m];
      }
    }
    // Rotate from geocentric to geodetic frame.
    var psi = phic - phi;
    var Xg = X * cos(psi) - Z * sin(psi);
    return atan2(Y, Xg) * deg;
  }

  // ------------------------------------------------------------------ sun and moon
  var DAY = 86400000, J1970 = 2440588, J2000 = 2451545, OBL = rad * 23.4397;
  function toDays(date) { return date.valueOf() / DAY - 0.5 + J1970 - J2000; }
  function fromJulian(j) { return new Date((j + 0.5 - J1970) * DAY); }
  function rightAscension(l, b) { return atan2(sin(l) * cos(OBL) - tan(b) * sin(OBL), cos(l)); }
  function decl(l, b) { return asin(sin(b) * cos(OBL) + cos(b) * sin(OBL) * sin(l)); }
  function sidereal(d, lw) { return rad * (280.16 + 360.9856235 * d) - lw; }
  function meanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }
  function eclipticLon(M) {
    var C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));
    return M + C + rad * 102.9372 + PI;
  }
  function sunCoords(d) { var L = eclipticLon(meanAnomaly(d)); return { dec: decl(L, 0), ra: rightAscension(L, 0) }; }

  /** Sun position: { azimuth (deg from true north, clockwise), altitude (deg) }. */
  function sunPosition(date, lat, lon) {
    var lw = -lon * rad, phi = lat * rad, d = toDays(date), c = sunCoords(d), H = sidereal(d, lw) - c.ra;
    var az = atan2(sin(H), cos(H) * sin(phi) - tan(c.dec) * cos(phi)); // from south, west positive
    var alt = asin(sin(phi) * sin(c.dec) + cos(phi) * cos(c.dec) * cos(H));
    return { azimuth: (az * deg + 180 + 360) % 360, altitude: alt * deg };
  }

  /** Sunrise/sunset and civil dawn/dusk for the date's day. Values are Dates, or null (sun never reaches that angle). */
  function sunTimes(date, lat, lon) {
    var lw = -lon * rad, phi = lat * rad, J0 = 0.0009;
    var d = toDays(date), n = Math.round(d - J0 - lw / (2 * PI));
    var ds = J0 + lw / (2 * PI) + n, M = meanAnomaly(ds), L = eclipticLon(M), dc = decl(L, 0);
    var Jnoon = J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
    function at(hDeg) {
      var cosH = (sin(hDeg * rad) - sin(phi) * sin(dc)) / (cos(phi) * cos(dc));
      if (cosH < -1 || cosH > 1) return null;
      var w = acos(cosH), a = J0 + (w + lw) / (2 * PI) + n;
      var Jset = J2000 + a + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
      return { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
    }
    var s = at(-0.833), c = at(-6);
    return {
      noon: fromJulian(Jnoon),
      sunrise: s && s.rise, sunset: s && s.set,
      dawn: c && c.rise, dusk: c && c.set,
    };
  }

  function moonCoords(d) {
    var L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
    var l = L + rad * 6.289 * sin(M), b = rad * 5.128 * sin(F), dist = 385001 - 20905 * cos(M);
    return { ra: rightAscension(l, b), dec: decl(l, b), dist: dist };
  }
  /** Moon: { fraction lit 0-1, phase 0..1 (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter), name }. */
  function moonPhase(date) {
    var d = toDays(date || new Date()), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    var ph = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
    var inc = atan2(sdist * sin(ph), m.dist - sdist * cos(ph));
    var ang = atan2(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
    var fraction = (1 + cos(inc)) / 2, phase = 0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / PI;
    var names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
    return { fraction: fraction, phase: phase, name: names[Math.round(phase * 8) % 8] };
  }

  // ------------------------------------------------------------------ field calculations
  /** Naismith: 5 km/h on the flat plus 1 minute per 10 m of ascent. Returns minutes. */
  function naismith(km, ascentM) { return km / 5 * 60 + ascentM / 10; }
  /** Met Office / JAG-TI wind chill (°C, wind km/h at 10 m). Valid for T <= 10 °C and wind > 4.8 km/h. */
  function windChill(tC, windKmh) {
    if (tC > 10 || windKmh <= 4.8) return tC;
    var v = Math.pow(windKmh, 0.16);
    return 13.12 + 0.6215 * tC - 11.37 * v + 0.3965 * tC * v;
  }
  /** Rough daily water need in litres: 2.5 base, more for heat and hard work (UK guidance ranges). */
  function waterNeed(tempC, hoursActive, effort) {
    var base = 2.5, perHour = effort === "hard" ? 0.75 : effort === "moderate" ? 0.5 : 0.25;
    var heat = tempC >= 30 ? 1.5 : tempC >= 25 ? 1 : tempC >= 20 ? 0.5 : 0;
    return Math.round((base + hoursActive * perHour + heat) * 10) / 10;
  }

  var Geo = {
    toOSGB: toOSGB, fromOSGB: fromOSGB, gridRef: gridRef, parseGridRef: parseGridRef,
    distance: distance, bearing: bearing, declination: declination,
    sunPosition: sunPosition, sunTimes: sunTimes, moonPhase: moonPhase,
    naismith: naismith, windChill: windChill, waterNeed: waterNeed,
    _tm: { forward: tmForward, inverse: tmInverse },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Geo;
  else root.Geo = Geo;
})(this);
