'use strict';
/**
 * games/daily-horoscope/src/index.js
 * MYSTIC OBSERVATORY  --  SynthDoor Astrological Engine
 */

const path = require('path');
const { GameBase, Screen, Draw, Color, CP437, Attr } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);
const D = require(path.join(__dirname, 'data.js'));

const {
  BLACK, WHITE, BRIGHT_WHITE,
  CYAN, BRIGHT_CYAN, MAGENTA, BRIGHT_MAGENTA,
  BRIGHT_RED, BRIGHT_YELLOW, BRIGHT_GREEN, BRIGHT_BLUE,
  RED, GREEN, YELLOW, BLUE
} = Color;

// ═══════════════════════════════════════════════════════════════════════════
//  ASTRONOMY ENGINE  (Geocentric Apparent Longitude & Orbital Mechanics)
// ═══════════════════════════════════════════════════════════════════════════

const J2000 = 2451545.0;

function dateToJulian(date) {
  const Y = date.getUTCFullYear();
  const M = date.getUTCMonth() + 1;
  const D2 = date.getUTCDate() + date.getUTCHours() / 24;
  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + D2 + B - 1524.5;
}

function normalizeAngle(deg) {
  deg = deg % 360;
  return deg < 0 ? deg + 360 : deg;
}

// Added Earth's elements and Semi-Major Axes (a) for distance scaling
const ORBITAL_ELEMENTS = {
  Earth:   { a: 1.000000, L0: 100.46435, L1:  36000.76983, e0: 0.01670863, e1: -0.00004204, w0: 102.93720, w1:  0.32320000 },
  Mercury: { a: 0.387098, L0: 252.25032, L1: 149472.67411, e0: 0.20563593, e1:  3.0e-9,     w0:  77.45779, w1:  0.15873520 },
  Venus:   { a: 0.723332, L0: 181.97971, L1:  58517.81538, e0: 0.00677323, e1: -1.3e-8,     w0: 131.56370, w1:  0.00268329 },
  Mars:    { a: 1.523679, L0: 355.45332, L1:  19140.29585, e0: 0.09341233, e1:  2.78e-7,    w0: 336.04084, w1:  0.00443084 },
  Jupiter: { a: 5.202603, L0:  34.89191, L1:   3034.74612, e0: 0.04849485, e1:  1.63e-7,    w0:  14.72960, w1:  0.00215559 },
  Saturn:  { a: 9.554909, L0:  50.07744, L1:   1222.11380, e0: 0.05551825, e1: -3.46e-7,    w0:  92.43194, w1: -0.00365590 },
  Uranus:  { a: 19.21845, L0: 314.05501, L1:    428.46881, e0: 0.04629590, e1: -2.72e-7,    w0: 170.96424, w1:  0.00040273 },
  Neptune: { a: 30.11039, L0: 304.34866, L1:    218.45945, e0: 0.00898809, e1:  6.3e-9,     w0:  44.96476, w1: -0.00032394 },
  Pluto:   { a: 39.48211, L0: 238.92881, L1:    145.20780, e0: 0.24882730, e1:  0.0,        w0: 224.06676, w1:  0.0        },
};

// Calculates the planet's actual position in space relative to the Sun
function getHeliocentricPos(name, jd) {
  const T = (jd - J2000) / 36525.0;
  const el = ORBITAL_ELEMENTS[name];
  
  const L = normalizeAngle(el.L0 + el.L1 * T);
  const e = el.e0 + el.e1 * T;
  const w = el.w0 + el.w1 * T;
  
  // Mean Anomaly
  const M_deg = normalizeAngle(L - w);
  const M = M_deg * Math.PI / 180;
  
  // Equation of Center (True Anomaly translation)
  const C = (2 * e - Math.pow(e, 3) / 4) * Math.sin(M)
          + (5 / 4) * Math.pow(e, 2) * Math.sin(2 * M)
          + (13 / 12) * Math.pow(e, 3) * Math.sin(3 * M);
          
  const helioLon = normalizeAngle(L + C * 180 / Math.PI);
  const trueAnomaly = (M_deg + (C * 180 / Math.PI)) * Math.PI / 180;
  
  // Radius Vector (Distance from Sun in AU)
  const r = (el.a * (1 - e * e)) / (1 + e * Math.cos(trueAnomaly));
  
  return { lon: helioLon, r: r };
}

// Lunar calculations are already geocentric
function getMoonLongitude(jd) {
  const T = (jd - J2000) / 36525.0;
  const L = normalizeAngle(218.3165 + 481267.8813 * T);
  const Mm = normalizeAngle(134.9634 + 477198.8676 * T) * Math.PI / 180;
  const Ms = normalizeAngle(357.5291 + 35999.0503 * T) * Math.PI / 180;
  const F  = normalizeAngle(93.2721  + 483202.0175 * T) * Math.PI / 180;
  const Dv = normalizeAngle(297.8502 + 445267.1115 * T) * Math.PI / 180;
  
  const corr = 6.289 * Math.sin(Mm)
    - 1.274 * Math.sin(2 * Dv - Mm) + 0.658 * Math.sin(2 * Dv)
    - 0.214 * Math.sin(2 * Mm) - 0.186 * Math.sin(Ms)
    - 0.114 * Math.sin(2 * F) + 0.059 * Math.sin(2 * Dv - 2 * Mm)
    + 0.057 * Math.sin(2 * Dv - Ms - Mm) + 0.053 * Math.sin(2 * Dv + Mm)
    + 0.046 * Math.sin(2 * Dv - Ms);
    
  return normalizeAngle(L + corr);
}

// Calculates apparent longitude from the perspective of Earth
function getPlanetLongitude(name, date) {
  const jd = dateToJulian(date);
  
  if (name === 'Moon') return getMoonLongitude(jd);
  
  const earthPos = getHeliocentricPos('Earth', jd);
  
  // The Sun is directly opposite Earth's heliocentric position
  if (name === 'Sun') return normalizeAngle(earthPos.lon + 180);
  
  const planetPos = getHeliocentricPos(name, jd);
  
  // Convert heliocentric polar coordinates to Cartesian (X,Y) for Earth
  const eX = earthPos.r * Math.cos(earthPos.lon * Math.PI / 180);
  const eY = earthPos.r * Math.sin(earthPos.lon * Math.PI / 180);
  
  // Convert heliocentric polar coordinates to Cartesian (X,Y) for Planet
  const pX = planetPos.r * Math.cos(planetPos.lon * Math.PI / 180);
  const pY = planetPos.r * Math.sin(planetPos.lon * Math.PI / 180);
  
  // Geocentric Vector: Planet - Earth
  const geoX = pX - eX;
  const geoY = pY - eY;
  
  // Convert Geocentric vector back to an angle (Apparent Zodiac Longitude)
  const geoLon = Math.atan2(geoY, geoX) * 180 / Math.PI;
  return normalizeAngle(geoLon);
}

// Retrograde is an optical illusion from Earth. Because our math is now 
// geocentric, a simple delta over 24 hours reliably calculates true retrogrades!
function isRetrograde(name, date) {
  if (name === 'Sun' || name === 'Moon') return false;
  
  const d1 = new Date(date.getTime() - 86400000); // Yesterday
  const d2 = new Date(date.getTime() + 86400000); // Tomorrow
  
  let diff = getPlanetLongitude(name, d2) - getPlanetLongitude(name, d1);
  
  // Handle wrapping over the 360/0 degree Aries boundary
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  
  // If the planet's apparent longitude is decreasing, it is in retrograde
  return diff < 0;
}

function longitudeToSign(lon) {
  const idx = Math.floor(lon / 30) % 12;
  return { signIndex: idx, degree: Math.floor(lon % 30) };
}

function getMoonPhase(date) {
  const LUNAR = 29.53058867;
  const KNOWN = new Date('2000-01-06T18:14:00Z').getTime();
  let phase = ((date.getTime() - KNOWN) / (1000 * 60 * 60 * 24) % LUNAR) / LUNAR;
  if (phase < 0) phase += 1;
  let name, icon, energy;
  if      (phase < 0.03 || phase >= 0.97) { name = 'New Moon';        icon = '(( ))'; energy = 'Beginnings';  }
  else if (phase < 0.22)                  { name = 'Waxing Crescent'; icon = '( ))';  energy = 'Intention';   }
  else if (phase < 0.28)                  { name = 'First Quarter';   icon = '( | )'; energy = 'Action';      }
  else if (phase < 0.47)                  { name = 'Waxing Gibbous';  icon = '( O )'; energy = 'Refinement';  }
  else if (phase < 0.53)                  { name = 'Full Moon';       icon = '( O )'; energy = 'Culmination'; }
  else if (phase < 0.72)                  { name = 'Waning Gibbous';  icon = '(O  )'; energy = 'Gratitude';   }
  else if (phase < 0.78)                  { name = 'Third Quarter';   icon = '( | )'; energy = 'Release';     }
  else                                    { name = 'Waning Crescent'; icon = '(( )';  energy = 'Surrender';   }
  return { name, icon, energy, illumination: Math.round((0.5 - Math.abs(phase - 0.5)) * 200), phase };
}

const ASPECTS_DEF = [
  { name: 'Conjunction', angle: 0,   orb: 8, symbol: 'cnj', quality: 'intense'    },
  { name: 'Sextile',     angle: 60,  orb: 5, symbol: 'sxt', quality: 'harmonious' },
  { name: 'Square',      angle: 90,  orb: 7, symbol: 'sqr', quality: 'tense'      },
  { name: 'Trine',       angle: 120, orb: 7, symbol: 'tri', quality: 'flowing'    },
  { name: 'Opposition',  angle: 180, orb: 8, symbol: 'opp', quality: 'polarizing' },
  { name: 'Quincunx',    angle: 150, orb: 3, symbol: 'qnx', quality: 'adjusting'  },
];

function getAspect(l1, l2) {
  let diff = Math.abs(l1 - l2);
  if (diff > 180) diff = 360 - diff;
  for (const a of ASPECTS_DEF) {
    if (Math.abs(diff - a.angle) <= a.orb) {
      return { ...a, exactness: 1 - Math.abs(diff - a.angle) / a.orb };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ZODIAC & PLANET TABLES
// ═══════════════════════════════════════════════════════════════════════════

const SIGNS = [
  { name: 'Aries',       dates: 'Mar 21-Apr 19', element: 'Fire',  modality: 'Cardinal', ruler: 'Mars',    color: BRIGHT_RED,     sym: '^',        keywords: ['bold','pioneering','direct'],          house: 'identity'       },
  { name: 'Taurus',      dates: 'Apr 20-May 20', element: 'Earth', modality: 'Fixed',    ruler: 'Venus',   color: YELLOW,   sym: 'U',        keywords: ['stable','sensual','persistent'],       house: 'resources'      },
  { name: 'Gemini',      dates: 'May 21-Jun 20', element: 'Air',   modality: 'Mutable',  ruler: 'Mercury', color: BRIGHT_YELLOW,  sym: 'II',       keywords: ['curious','adaptive','expressive'],     house: 'mind'           },
  { name: 'Cancer',      dates: 'Jun 21-Jul 22', element: 'Water', modality: 'Cardinal', ruler: 'Moon',    color: BRIGHT_CYAN,    sym: '69',       keywords: ['nurturing','intuitive','protective'],  house: 'home'           },
  { name: 'Leo',         dates: 'Jul 23-Aug 22', element: 'Fire',  modality: 'Fixed',    ruler: 'Sun',     color: BRIGHT_RED,  sym: 'Ω',     keywords: ['radiant','creative','generous'],       house: 'creativity'     },
  { name: 'Virgo',       dates: 'Aug 23-Sep 22', element: 'Earth', modality: 'Mutable',  ruler: 'Mercury', color: BRIGHT_GREEN,   sym: 'm',        keywords: ['analytical','precise','helpful'],      house: 'service'        },
  { name: 'Libra',       dates: 'Sep 23-Oct 22', element: 'Air',   modality: 'Cardinal', ruler: 'Venus',   color: BRIGHT_BLUE, sym: '=',        keywords: ['harmonious','just','aesthetic'],       house: 'partnership'    },
  { name: 'Scorpio',     dates: 'Oct 23-Nov 21', element: 'Water', modality: 'Fixed',    ruler: 'Pluto',   color: BRIGHT_CYAN,     sym: 'M',        keywords: ['intense','transformative','deep'],     house: 'transformation' },
  { name: 'Sagittarius', dates: 'Nov 22-Dec 21', element: 'Fire',  modality: 'Mutable',  ruler: 'Jupiter', color: BRIGHT_MAGENTA,    sym: '↑',        keywords: ['adventurous','free','philosophical'],  house: 'expansion'      },
  { name: 'Capricorn',   dates: 'Dec 22-Jan 19', element: 'Earth', modality: 'Cardinal', ruler: 'Saturn',  color: WHITE,   sym: 'V',        keywords: ['disciplined','ambitious','patient'],   house: 'achievement'    },
  { name: 'Aquarius',    dates: 'Jan 20-Feb 18', element: 'Air',   modality: 'Fixed',    ruler: 'Uranus',  color: BRIGHT_BLUE,    sym: '≈',        keywords: ['innovative','original','humane'],       house: 'community'      },
  { name: 'Pisces',      dates: 'Feb 19-Mar 20', element: 'Water', modality: 'Mutable',  ruler: 'Neptune', color: BRIGHT_CYAN,    sym: '}{',        keywords: ['empathic','spiritual','imaginative'],  house: 'transcendence'  },
];

const PLANET_DATA = {
  Sun:     { color: BRIGHT_YELLOW, domain: 'identity and purpose'        },
  Moon:    { color: BRIGHT_WHITE,  domain: 'emotion and instinct'        },
  Mercury: { color: BRIGHT_CYAN,   domain: 'mind and communication'      },
  Venus:   { color: BRIGHT_MAGENTA,domain: 'love and attraction'         },
  Mars:    { color: BRIGHT_RED,    domain: 'action and desire'           },
  Jupiter: { color: BRIGHT_YELLOW, domain: 'expansion and wisdom'        },
  Saturn:  { color: WHITE,         domain: 'structure and discipline'    },
  Uranus:  { color: BRIGHT_CYAN,   domain: 'change and awakening'        },
  Neptune: { color: BRIGHT_BLUE,   domain: 'dreams and spirituality'     },
  Pluto:   { color: BRIGHT_MAGENTA,domain: 'transformation and power'    },
};

const PLANETS_ORDERED = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'];

const HOUSE_MEANINGS = [
  'Self & Identity', 'Values & Resources', 'Mind & Comms', 'Home & Roots',
  'Creativity & Joy', 'Health & Service', 'Partnership', 'Transformation',
  'Belief & Travel', 'Career & Legacy', 'Community', 'Karma & Spirit',
];

// ═══════════════════════════════════════════════════════════════════════════
//  DAILY PRNG  (deterministic per user+sign+day)
// ═══════════════════════════════════════════════════════════════════════════

class DailyPRNG {
  constructor(seed) {
    this.state = (seed >>> 0) || 1;
  }

  next() {
    // USE SACRED NUMBERS TO READ THE STARS
    // Multiplier: 2654435761 (Golden Prime Ratio)
    // Increment: 25920 (The Great Year / Precession of the Equinoxes)
    // Modulo: 2^32 (4294967296)
    this.state = (Math.imul(this.state, 2654435761) + 25920) >>> 0;
    return this.state / 4294967296;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  range(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  pickN(arr, n) {
    const copy = [...arr];
    const r = [];
    for (let i = 0; i < n && copy.length; i++) {
      r.push(copy.splice(Math.floor(this.next() * copy.length), 1)[0]);
    }
    return r;
  }
}

function dateSeed(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

// ═══════════════════════════════════════════════════════════════════════════
//  GAMIFICATION
// ═══════════════════════════════════════════════════════════════════════════

const XP_DAILY   = 10;
const XP_CHART   = 25;
const XP_STREAK  = 5;
const XP_MOON    = 30;

const BADGE_DEFS = [
  { id: 'first_star',  name: 'First Star',      desc: 'First cosmic consultation'       },
  { id: 'streak_3',    name: 'Threefold Path',  desc: '3-day consecutive reading'       },
  { id: 'streak_7',    name: 'Lunar Week',      desc: '7-day consecutive streak'        },
  { id: 'streak_28',   name: 'Moon Cycle',      desc: 'Full lunar cycle of readings'    },
  { id: 'chart_cast',  name: 'Chart Cast',      desc: 'First full natal chart reading'  },
  { id: 'all_signs',   name: 'Zodiac Wanderer', desc: 'Read all 12 signs'               },
  { id: 'full_moon',   name: 'Moonchild',       desc: 'Read under a Full Moon'          },
  { id: 'new_moon',    name: 'New Beginnings',  desc: 'Read under a New Moon'           },
  { id: 'retrograde',  name: 'Mercury Marked',  desc: 'Read during Mercury retrograde'  },
  { id: 'century',     name: 'Cosmic Century',  desc: 'Accumulated 100 XP'              },
  { id: 'lucky_draw',  name: 'Fortune Seeker',  desc: 'First Lucky Draw'                },
];

// ═══════════════════════════════════════════════════════════════════════════
//  GAME CLASS
// ═══════════════════════════════════════════════════════════════════════════

class MysticObservatory extends GameBase {
  static get GAME_NAME()  { return 'daily-horoscope'; }
  static get GAME_TITLE() { return 'Daily Horoscope'; }

  async run() {
    this._running = true;
    this.screen.setMode(Screen.FIXED);
    this.input.start();

    this.now       = new Date();
    this.todayStr  = Utils.todayStr();
    this._xpGains  = [];
    this._newBadges = [];

    this._computeSky();
    this._loadProfile();
    this._processDailyCheckin();

    await this._showSplashScreen();
    if (!this._running) { this.input.stop(); return; }

    let state = 'DASHBOARD';
    let selectedSignIdx = this._profile.lastSignIndex || 0;
    let birthDate = this._profile.birthDate ? new Date(this._profile.birthDate) : null;

    // Track what the user has done this session for sequential flow
    this._sessionDidLucky = false;
    this._sessionDidChart = false;

    while (this._running) {
      const currentToday = Utils.todayStr();
      if (currentToday !== this.todayStr) {
        this.now = new Date();
        this.todayStr = currentToday;
        this._computeSky();
        this._processDailyCheckin(); // This resets luckyDrawToday to false!
      }

      if (state === 'DASHBOARD') {
        const result = await this._runDashboard(selectedSignIdx);
        if (result.action === 'quit')  { this._running = false; break; }
        if (result.action === 'learn') { await this._runLearnPage(); continue; }
        selectedSignIdx = result.signIdx;
        state = 'DAILY_HOROSCOPE';
      }
      else if (state === 'DAILY_HOROSCOPE') {
        const next = await this._runDailyHoroscope(SIGNS[selectedSignIdx]);
        if (next === 'back')       { state = 'DASHBOARD'; }
        else if (next === 'chart') { state = 'CHART_INVITE'; }
        else if (next === 'lucky') {
          await this._runLuckyDraw(SIGNS[selectedSignIdx]);
          // Return to horoscope screen -- now luckyDrawToday=true so status bar
          // shows only [ENTER] Full Chart Reading
          // state stays DAILY_HOROSCOPE
        }
      }
      else if (state === 'CHART_INVITE') {
        const result = await this._runChartInvite(birthDate);
        if (result === 'skip')  { state = 'DASHBOARD'; }
        else if (result === 'chart_invite')  { state = 'CHART_INVITE'; }
        else if (result === 'lucky') {
          await this._runLuckyDraw(SIGNS[selectedSignIdx]);
          // Return to horoscope screen -- now luckyDrawToday=true so status bar
          // shows only [ENTER] Full Chart Reading
          // state stays DAILY_HOROSCOPE
        }

        else {
          const dateObj = new Date(result);

          if (isNaN(dateObj.getTime())) {
            state = 'CHART_INVITE';
          } else {
            birthDate = dateObj; 
            this._profile.birthDate = dateObj.toISOString();
            this._saveProfile();
            state = 'FULL_CHART';
          } 
        }
      }
      else if (state === 'FULL_CHART') {
        const full = await this._runFullChart(birthDate, selectedSignIdx);

        if (full === 'back')       { state = 'DASHBOARD'; }
        else if (full === 'lucky') {
          await this._runLuckyDraw(SIGNS[selectedSignIdx]);
          state = 'DASHBOARD';
          // Return to horoscope screen -- now luckyDrawToday=true so status bar
          // shows only [ENTER] Full Chart Reading
          // state stays DAILY_HOROSCOPE
        }
      }
    }

    this._saveProfile();
    this.input.stop();
    await this._showGoodbye();
    await this._showLeaderboard();
  }

  // ─── Sky Computation ────────────────────────────────────────────────────

  _computeSky() {
    this.sky = {};
    for (const p of PLANETS_ORDERED) {
      const lon = getPlanetLongitude(p, this.now);
      const { signIndex, degree } = longitudeToSign(lon);
      this.sky[p] = { longitude: lon, signIndex, degree, retrograde: isRetrograde(p, this.now), sign: SIGNS[signIndex] };
    }
    this.moonPhase = getMoonPhase(this.now);
    this.aspects = [];
    for (let i = 0; i < PLANETS_ORDERED.length; i++) {
      for (let j = i + 1; j < PLANETS_ORDERED.length; j++) {
        const asp = getAspect(this.sky[PLANETS_ORDERED[i]].longitude, this.sky[PLANETS_ORDERED[j]].longitude);
        if (asp) this.aspects.push({ p1: PLANETS_ORDERED[i], p2: PLANETS_ORDERED[j], ...asp });
      }
    }
    this.aspects.sort((a, b) => b.exactness - a.exactness);
  }

_computeNatalChart(bDate) {
    const natal = {};
    
    // --- 1. DETERMINE EXACT BIRTH TIME & LOCATION ---
    // Fallbacks provided just in case the profile data is missing
    const bHour = this._profile.birthHour !== undefined ? this._profile.birthHour : 12;
    const bTz   = this._profile.birthTz !== undefined ? this._profile.birthTz : -5;
    const bHemi = this._profile.birthHemi || 'north';

    // JS Date.UTC handles overflow/underflow automatically. 
    // If local hour is 2 and timezone is -5, UTC hour is 7.
    // If local hour is 2 and timezone is +9, UTC hour is -7 (safely rolls back to previous day).
    const exactUTC = new Date(Date.UTC(
      bDate.getUTCFullYear(),
      bDate.getUTCMonth(),
      bDate.getUTCDate(),
      bHour - bTz, 
      0, 0
    ));

    const exactJD = dateToJulian(exactUTC);

    // --- 2. CALCULATE PLANETS FOR EXACT TIME ---
    for (const p of PLANETS_ORDERED) {
      // Using exactUTC makes the fast-moving Moon highly accurate!
      const lon = getPlanetLongitude(p, exactUTC);
      const { signIndex, degree } = longitudeToSign(lon);
      natal[p] = { longitude: lon, signIndex, degree, sign: SIGNS[signIndex] };
    }
    
    // --- 3. CALCULATE TRUE ASCENDANT (Spherical Trigonometry) ---
    // Convert time zone to approximate Longitude (1 hour = 15 degrees)
    const lon = bTz * 15.0;
    
    // Convert Hemisphere to approximate Latitude
    let lat = 40.0; // Default north (approx. NYC/Madrid)
    if (bHemi === 'south') lat = -35.0; // approx. Buenos Aires/Sydney
    else if (bHemi === 'equator') lat = 0.0;

    // Calculate Local Sidereal Time (LST)
    const D = exactJD - 2451545.0; // Days since J2000
    const GMST = normalizeAngle(280.46061837 + 360.98564736629 * D); // Greenwich Mean Sidereal Time
    const LST = normalizeAngle(GMST + lon);

    // Standard Ascendant Formula (atan2 safely handles all 4 quadrants)
    const LST_rad = LST * Math.PI / 180;
    const lat_rad = lat * Math.PI / 180;
    const ecliptic_tilt_rad = 23.4392911 * Math.PI / 180; // Earth's axial tilt

    const y_asc = Math.cos(LST_rad);
    const x_asc = -Math.sin(LST_rad) * Math.cos(ecliptic_tilt_rad) - Math.tan(lat_rad) * Math.sin(ecliptic_tilt_rad);
    
    const asc_lon = normalizeAngle(Math.atan2(y_asc, x_asc) * 180 / Math.PI);
    const ascIdx = Math.floor(asc_lon / 30) % 12;

    natal.ascendant = { 
      longitude: asc_lon, 
      signIndex: ascIdx, 
      degree: Math.floor(asc_lon % 30), 
      sign: SIGNS[ascIdx] 
    };
    
    // --- 4. ASSIGN WHOLE SIGN HOUSES ---
    for (const p of PLANETS_ORDERED) {
      natal[p].house = ((natal[p].signIndex - ascIdx + 12) % 12) + 1;
    }

    natal._aspects = [];
    for (let i = 0; i < PLANETS_ORDERED.length; i++) {
      for (let j = i + 1; j < PLANETS_ORDERED.length; j++) {
        const asp = getAspect(natal[PLANETS_ORDERED[i]].longitude, natal[PLANETS_ORDERED[j]].longitude);
        if (asp) natal._aspects.push({ p1: PLANETS_ORDERED[i], p2: PLANETS_ORDERED[j], ...asp });
      }
    }
    natal._aspects.sort((a, b) => b.exactness - a.exactness);

    natal._transits = [];
    for (const cp of PLANETS_ORDERED) {
      for (const np of PLANETS_ORDERED) {
        const asp = getAspect(this.sky[cp].longitude, natal[np].longitude);
        if (asp) natal._transits.push({ currentPlanet: cp, natalPlanet: np, ...asp });
      }
    }
    natal._transits.sort((a, b) => b.exactness - a.exactness);

    return natal;
  }

  // ─── Profile & Gamification ─────────────────────────────────────────────

  _loadProfile() {
    const raw = this.db?.getPlayerData(MysticObservatory.GAME_NAME, this.username, 'profile', null);
    if (raw) {
      try { this._profile = typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch(e) { this._profile = {}; }
    } else { this._profile = {}; }
    this._profile = Object.assign({
      xp: 0, level: 1, streak: 0, lastPlayDate: null,
      totalReadings: 0, badges: [], signsRead: [],
      lastSignIndex: 0, birthDate: null, luckyDrawToday: false,
    }, this._profile);
  }

  _saveProfile() {
    this.db?.setPlayerData(MysticObservatory.GAME_NAME, this.username, 'profile', JSON.stringify(this._profile));
  }

  _addXP(amount, label) {
    this._profile.xp = (this._profile.xp || 0) + amount;
    this._profile.level = Math.floor(Math.sqrt(this._profile.xp / 20)) + 1;
    this._xpGains.push({ amount, label });
  }

  _awardBadge(id) {
    if (!this._profile.badges.includes(id)) {
      const def = BADGE_DEFS.find(b => b.id === id);
      if (def) { this._profile.badges.push(id); this._newBadges.push(def); }
    }
  }

  _processDailyCheckin() {
    const today = this.todayStr;
    if (this._profile.lastPlayDate === today) return;
    const yesterday = new Date(this.now.getTime() - 86400000);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
    this._profile.streak = (this._profile.lastPlayDate === yStr) ? (this._profile.streak || 0) + 1 : 1;
    this._addXP(XP_DAILY, 'Daily Check-in');
    if (this._profile.streak > 1) this._addXP(this._profile.streak * XP_STREAK, `${this._profile.streak}-Day Streak`);
    if (this.moonPhase.name === 'Full Moon') { this._addXP(XP_MOON, 'Full Moon Reading');  this._awardBadge('full_moon'); }
    if (this.moonPhase.name === 'New Moon')  { this._addXP(XP_MOON, 'New Moon Reading');   this._awardBadge('new_moon');  }
    if (this.sky.Mercury.retrograde)         this._awardBadge('retrograde');
    this._profile.lastPlayDate = today;
    this._profile.totalReadings = (this._profile.totalReadings || 0) + 1;
    this._profile.luckyDrawToday = false;
    this._profile.chartReadToday = false;
    if (this._profile.streak >= 3)  this._awardBadge('streak_3');
    if (this._profile.streak >= 7)  this._awardBadge('streak_7');
    if (this._profile.streak >= 28) this._awardBadge('streak_28');
    if (this._profile.totalReadings === 1) this._awardBadge('first_star');
    if (this._profile.xp >= 100) this._awardBadge('century');
    // Save score to leaderboard
    this.db?.saveScore(MysticObservatory.GAME_NAME, this.username, this._profile.xp, { streak: this._profile.streak });
    this._saveProfile();
  }

  // ─── SPLASH ──────────────────────────────────────────────────────────────

  async _showSplashScreen() {
    const s = this.screen;
    s.clear(BLACK, BLACK);

    // Starfield
    const prng = new DailyPRNG(dateSeed(this.now) * 7 + 13);
    for (let i = 0; i < 80; i++) {
      const x = prng.range(1, 80); const y = prng.range(2, 23);
      s.putChar(x, y, prng.pick(['.', '+', '*']), prng.pick([CYAN, WHITE, BRIGHT_CYAN, MAGENTA]), BLACK);
    }

    // MYSTIC in CP437-safe block letters using Draw.blockBanner (3x5 chars)
    // But since that pads to fixed size, we use two separate banners
    Draw.blockBanner(s, 4, 'MYSTIC', BRIGHT_MAGENTA, BLACK, 19);
    Draw.blockBanner(s, 10, 'OBSERVATORY', BRIGHT_CYAN, BLACK, 19);

    s.putString(24, 16, '~ Personal Celestial Guidance ~', BRIGHT_YELLOW, BLACK);

    const moonLine = this.moonPhase.icon + '  ' + this.moonPhase.name + '  ' + this.moonPhase.illumination + '% Illuminated';
    Draw.centerText(s, 18, moonLine, BRIGHT_YELLOW, BLACK);
    Draw.centerText(s, 19, Utils.todayStr(), CYAN, BLACK);

    if (this._profile.totalReadings > 1) {
      const streakStr = this._profile.streak > 1 ? '  Streak: ' + this._profile.streak + ' days' : '';
      Draw.centerText(s, 20, 'Level ' + this._profile.level + '  ~  ' + this._profile.xp + ' XP' + streakStr, BRIGHT_MAGENTA, BLACK);
    }
    if (this._xpGains.length > 0) {
      Draw.centerText(s, 21, this._xpGains.map(g => '+' + g.amount + ' ' + g.label).join('  |  '), BRIGHT_YELLOW, BLACK);
    }
    if (this._newBadges.length > 0) {
      Draw.centerText(s, 22, '** BADGE: ' + this._newBadges[0].name + ' ** ' + this._newBadges[0].desc, BRIGHT_CYAN, BLACK);
    }

    s.statusBar('  Press any key to enter the Observatory...', BLACK, MAGENTA);
    s.flush();
    const key = await this.terminal.waitKey();
    if (key === 'q' || key === 'Q' || key === '\x1b') this._running = false;
  }

  // ─── DASHBOARD ───────────────────────────────────────────────────────────

  async _runDashboard(selectedIdx) {
    let sel = selectedIdx;
    this.input.start();
    while (true) {
      this._drawDashboard(sel);
      this.screen.flush();

      // We need to wait for either an action OR the 'L' key
      let resolved = false;
      let resolvedAction = null;
      let resolvedKey = null;

      await new Promise((resolve) => {
        const onAction = (action) => {
          if (['UP','DOWN','LEFT','RIGHT','CONFIRM','QUIT','CANCEL'].includes(action)) {
            resolvedAction = action; resolved = true; resolve();
          }
        };
        const onKey = (key) => {
          if (key === 'l' || key === 'L') {
            resolvedKey = 'L'; resolved = true; resolve();
          }
        };
        this.input.once('action', onAction);
        this.terminal.once('key', onKey);
        // cleanup handled by resolution
      });

      if (resolvedKey === 'L') return { action: 'learn', signIdx: sel };
      const action = resolvedAction;
      if (action === 'QUIT' || action === 'CANCEL') return { action: 'quit' };
      if (action === 'UP' || action === 'LEFT')   sel = (sel + 11) % 12;
      if (action === 'DOWN' || action === 'RIGHT') sel = (sel + 1) % 12;
      if (action === 'CONFIRM') {
        this._profile.lastSignIndex = sel;
        if (!this._profile.signsRead.includes(SIGNS[sel].name)) {
          this._profile.signsRead.push(SIGNS[sel].name);
          if (this._profile.signsRead.length >= 12) this._awardBadge('all_signs');
        }
        return { action: 'read', signIdx: sel };
      }
    }
  }

  _drawDashboard(selIdx) {
    const s = this.screen;
    s.clear(BLACK, BLACK);

    // Outer border
    Draw.titledBox(s, 1, 1, 79, 24, '     ++ MYSTIC  OBSERVATORY ++', Draw.BOX_DOUBLE, MAGENTA, BLACK, BRIGHT_YELLOW, BLACK);

    // ── LEFT COLUMN (cols 2-28): Today's Sky ──
    Draw.vLine(s, 29, 2, 22, Draw.BOX_SINGLE, MAGENTA, BLACK);
    s.putChar(29, 1, '╤', MAGENTA, BLACK);
    s.putChar(29, 24, '╧', MAGENTA, BLACK);

    s.putString(9, 2, 'TODAY\'S SKY', BRIGHT_CYAN, BLACK);
    Draw.hLine(s, 2, 3, 78, Draw.BOX_SINGLE, MAGENTA, BLACK);
    s.putChar(29, 3, '┼', MAGENTA, BLACK);

    s.putString(2, 4, 'Date   :', CYAN, BLACK);
    s.putString(11, 4, Utils.todayStr(), WHITE, BLACK);
    s.putString(2, 5, 'Moon   :', CYAN, BLACK);
    // Truncate moon name to fit 
    s.putString(11, 5, this.moonPhase.name.substring(0, 17), BRIGHT_YELLOW, BLACK);
    s.putString(2, 6, 'Energy :', CYAN, BLACK);
    s.putString(11, 6, this.moonPhase.energy.substring(0, 17), BRIGHT_CYAN, BLACK);

    // Planet table header - col layout: 2=name(3) 6=deg(3) 10=sign(9) 20=Rx
    s.putString(2, 8, 'PLN DEG  SIGN      R', CYAN, BLACK);
    Draw.hLine(s, 2, 9, 27, Draw.BOX_SINGLE, MAGENTA, BLACK);
    s.putChar(29, 9, '┤', MAGENTA, BLACK);

    let row = 10;
    for (const p of PLANETS_ORDERED) {
      const pd = this.sky[p];
      const pc = PLANET_DATA[p].color;
      s.putString(2,  row, p.substring(0,3),                              pc,    BLACK);
      s.putString(6,  row, String(pd.degree).padStart(2,'0') + '°',   WHITE,  BLACK);
      s.putString(10, row, pd.sign.name.substring(0,9),                  CYAN,   BLACK);
      if (pd.retrograde) s.putString(20, row, 'Rx', BRIGHT_RED, BLACK);
      row++;
    }

    // ── CENTER COLUMN (cols 30-54): Sign Selection ──
    Draw.vLine(s, 55, 2, 22, Draw.BOX_SINGLE, MAGENTA, BLACK);
    s.putChar(55, 1, '╤', MAGENTA, BLACK);
    s.putChar(55, 24, '╧', MAGENTA, BLACK);
    s.putChar(29, 3, '┼', MAGENTA, BLACK);
    s.putChar(55, 3, '┼',  MAGENTA, BLACK);

    s.putString(34, 2, 'SELECT YOUR SIGN', BRIGHT_CYAN, BLACK);

    for (let i = 0; i < 12; i++) {
      const sign = SIGNS[i];
      const r = 4 + i;
      const isSel = (i === selIdx);
      const bg = isSel ? MAGENTA : BLACK;
      const fg = isSel ? BRIGHT_WHITE : sign.color;
      s.fill(30, r, 24, 1, ' ', fg, bg);
      if (isSel) s.putChar(30, r, '>', BRIGHT_YELLOW, bg);
      // sym (2) + name (11) + element (4) = 17, fits in 24 cols
      s.putString(32, r, sign.sym, isSel ? BRIGHT_YELLOW : sign.color, bg);
      s.putString(35, r, sign.name.padEnd(11), fg, bg);
      // Element: show first 5 chars only
      s.putString(47, r, sign.element.substring(0,5), isSel ? WHITE : CYAN, bg);
    }

    // Active aspects (rows 17-22) - use readable names: "Sun Trine Jupiter"
    s.putString(30, 17, 'ACTIVE ASPECTS:', BRIGHT_CYAN, BLACK);
    Draw.hLine(s, 30, 18, 24, Draw.BOX_SINGLE, MAGENTA, BLACK);
    s.putChar(55, 18, CP437.BOX_UP_DOWN_LEFT, MAGENTA, BLACK);
    const topAsp = this.aspects.slice(0, 4);
    for (let i = 0; i < 4; i++) {
      if (!topAsp[i]) break;
      const a = topAsp[i];
      // "Sun Trine Jup" -- full aspect name, readable
      const aspShort = a.name.substring(0, 5);  // Conju/Sexti/Squar/Trine/Oppos/Quinc
      const str = (a.p1.substring(0,3) + ' ' + aspShort + ' ' + a.p2.substring(0,3)).substring(0, 16);
      const col = a.quality === 'tense' ? BRIGHT_RED : a.quality === 'flowing' ? BRIGHT_GREEN : BRIGHT_CYAN;
      s.putString(30, 19 + i, str.padEnd(16), col, BLACK);
      const barW = Math.floor(a.exactness * 5);
      s.putString(47, 19 + i, '[' + '█'.repeat(barW) + '░'.repeat(5 - barW) + ']', MAGENTA, BLACK);
    }

    // ── RIGHT COLUMN (cols 56-79): Alignment ──
    const sign = SIGNS[selIdx];
    s.putString(60, 2, 'YOUR ALIGNMENT', BRIGHT_CYAN, BLACK);

    // Sign info  --  right col is 24 chars wide (56-79)
    s.putString(56, 4, (sign.sym + ' ' + sign.name).substring(0, 22), sign.color, BLACK);
    s.putString(56, 5, sign.dates.substring(0, 22), CYAN, BLACK);
    s.putString(56, 6, ('Element: ' + sign.element).substring(0, 22), WHITE, BLACK);
    s.putString(56, 7, ('Ruler: ' + sign.ruler).substring(0, 22), WHITE, BLACK);
    s.putString(56, 8, ('Modality: ' + sign.modality).substring(0, 22), CYAN, BLACK);


    // Keywords on two lines to fit
    let kw = sign.keywords;
    kw.sort((a, b) => a.length - b.length);

    let kw_line_one = (kw[0] + ', ' + kw[1]).substring(0, 22)
    if (kw[2]) {
      kw_line_one += ',';
    }

    s.putString(56, 10, kw_line_one, BRIGHT_CYAN, BLACK);
    if (kw[2]) {
      s.putString(56, 11, kw[2].substring(0, 23), BRIGHT_CYAN, BLACK);
    }

    // Planets in sign today
    const planetsHere = PLANETS_ORDERED.filter(p => this.sky[p].signIndex === selIdx);
    if (planetsHere.length > 0) {
        s.putString(56, 13, 'In sign today:', BRIGHT_YELLOW, BLACK);
    
        let line1 = "";
        let line2 = "";
        let pIdx = 0;

        // Fill the first line (max 22 chars)
        while (pIdx < planetsHere.length) {
            let name = planetsHere[pIdx];
            let addition = (line1.length === 0 ? "" : ", ") + name;
            if ((line1 + addition).length <= 22) {
                line1 += addition;
                pIdx++;
            } else {
                break; // Line 1 is full
            }
        }
    
        // Fill the second line (max 22 chars)
        while (pIdx < planetsHere.length) {
            let name = planetsHere[pIdx];
            let addition = (line2.length === 0 ? "" : ", ") + name;
            if ((line2 + addition).length <= 22) {
                line2 += addition;
                pIdx++;
            } else {
                break; // Line 2 is full, discard any remaining planets
            }
        }

        // Output the results
        s.putString(56, 14, line1, WHITE, BLACK);
        if (line2.length > 0) {
            s.putString(56, 15, line2, WHITE, BLACK);
        }
    }


    Draw.hLine(s, 56, 16, 24, Draw.BOX_SINGLE, MAGENTA, BLACK);

    // Player stats
    const lvl = this._profile.level || 1;
    const xp  = this._profile.xp   || 0;
    const str = this._profile.streak || 0;
    s.putString(56, 17, ('Level ' + lvl).substring(0, 22), BRIGHT_YELLOW, BLACK);
    s.putString(56, 18, ('XP: ' + xp).substring(0, 22), WHITE, BLACK);
    s.putString(56, 19, ('Streak: ' + str + 'd').substring(0, 22), str >= 7 ? BRIGHT_YELLOW : BRIGHT_CYAN, BLACK);
    s.putString(56, 20, ('Badges: ' + this._profile.badges.length + '/' + BADGE_DEFS.length).substring(0, 22), BRIGHT_MAGENTA, BLACK);

    // XP bar
    const nextXP = Math.pow(lvl, 2) * 20;
    const prevXP = Math.pow(lvl - 1, 2) * 20;
    const barW   = 20;
    const filled = Math.max(0, Math.min(barW, Math.floor(((xp - prevXP) / Math.max(1, nextXP - prevXP)) * barW)));
    s.putString(56, 22, '[' + '█'.repeat(filled) + '░'.repeat(barW - filled) + ']', MAGENTA, BLACK);

    s.statusBar('  [UP/DN] Select   [ENTER] Read   [L] Learn   [Q] Quit', BLACK, MAGENTA);


    // Box fixes
    s.putChar(24, 1, '═',  MAGENTA, BLACK);
    s.putChar(25, 1, '═',  MAGENTA, BLACK);
    s.putChar(26, 1, '═',  MAGENTA, BLACK);
    s.putChar(27, 1, '═',  MAGENTA, BLACK);
    s.putChar(28, 1, '═',  MAGENTA, BLACK);
    s.putChar(56, 1, '═',  MAGENTA, BLACK);
    s.putChar(1, 3, '╟',  MAGENTA, BLACK);
    s.putChar(79, 3, '╢',  MAGENTA, BLACK);
    s.putChar(1, 9, '╟',  MAGENTA, BLACK);
    s.putChar(55, 16, '├',  MAGENTA, BLACK);
    s.putChar(79, 16, '╢',  MAGENTA, BLACK);
    s.putChar(54, 18, '─',  MAGENTA, BLACK);
    s.putChar(55, 18, '┤',  MAGENTA, BLACK);
    s.putChar(79, 24, '╝',  MAGENTA, BLACK);
  }

  // ─── DAILY HOROSCOPE ─────────────────────────────────────────────────────

  async _runDailyHoroscope(sign) {
    this._drawDailyHoroscope(sign);
    this.screen.flush();

    while (true) {
      const key = await this.terminal.waitKey();
      if (key === 'q' || key === 'Q' || key === '\x1b') return 'back';
      // L = Lucky Draw (only if not yet drawn today)
      if ((key === 'l' || key === 'L') && !this._profile.luckyDrawToday) {
        return 'lucky';
      }
      // ENTER = always goes to full chart
      if (key === '\r' || key === '\n') {
        return 'chart';
      }
    }
  }

  _drawDailyHoroscope(sign) {
    const s = this.screen;
    s.clear(BLACK, BLACK);

    Draw.titledBox(s, 1, 1, 79, 24,
      ' ~*~ ' + sign.name.toUpperCase() + ' ~*~ ', Draw.BOX_DOUBLE, sign.color, BLACK, BRIGHT_YELLOW, BLACK);

    // Header band - keep short to avoid overflow
    const hdr = sign.sym + '  ' + sign.name + '  ' + sign.element + ' ' + sign.modality + '  Ruled by ' + sign.ruler;
    Draw.centerText(s, 2, hdr, BRIGHT_YELLOW, BLACK);

    Draw.hLine(s, 2, 3, 77, Draw.BOX_SINGLE, MAGENTA, BLACK);

    const reading = this._generateDailyReading(sign);

    // Text area: rows 4-15 (12 rows). Wrap to 74 chars, skip sentence if no room.
    let r = 4;
    for (const para of reading.paragraphs) {
      if (r > 15) break;
      const lines = Utils.wordWrap(para, 74);
      // Only render if the whole paragraph fits; skip if would overflow mid-sentence
      if (r + lines.length - 1 > 15) {
        // Try fitting just first sentence (up to first period)
        const firstSent = para.split('. ')[0];
        if (firstSent && firstSent.length > 0) {
          const fl = Utils.wordWrap(firstSent, 74);
          if (r + fl.length - 1 <= 15) {
            for (const line of fl) Draw.centerText(s, r++, line, BRIGHT_WHITE, BLACK);
            r++;
          }
        }
      } else {
        for (const line of lines) Draw.centerText(s, r++, line, BRIGHT_WHITE, BLACK);
        r++;
      }
    }

    Draw.hLine(s, 2, 15, 77, Draw.BOX_SINGLE, MAGENTA, BLACK);

    // ── COSMIC SIGNATURES (left, col 2-38) ──
    s.putString(3, 16, 'COSMIC SIGNATURES ', BRIGHT_MAGENTA, BLACK);

    // Labels at col 3, values at col 18, max 19 chars value (ends by col 36)
    s.putString(3,  17, 'Lucky Color  :', CYAN, BLACK);
    s.putString(18, 17, reading.luckyColor.substring(0, 19),  WHITE, BLACK);
    s.putString(3,  18, 'Crystal      :', CYAN, BLACK);
    s.putString(18, 18, reading.crystal.substring(0, 19),     WHITE, BLACK);
    s.putString(3,  19, 'Tarot Card   :', CYAN, BLACK);
    s.putString(18, 19, reading.tarotCard.substring(0, 19),   WHITE, BLACK);
    s.putString(3,  20, 'Energy Level :', CYAN, BLACK);
    const ebar = '█'.repeat(reading.energyLevel) + '░'.repeat(5 - reading.energyLevel);
    s.putString(18, 20, '[' + ebar + ']',
      reading.energyLevel >= 4 ? BRIGHT_GREEN : reading.energyLevel >= 2 ? BRIGHT_YELLOW : BRIGHT_RED, BLACK);

    // ── RIGHT SECTION (col 40-78): 5 items ──
    // Labels at 40, values at 55, max 23 chars (ends col 77)
    s.putString(40, 16, 'Moon Phase   :', CYAN, BLACK);
    s.putString(55, 16, this.moonPhase.name.substring(0, 23), BRIGHT_YELLOW, BLACK);

    s.putString(40, 17, 'Lucky Numbers:', CYAN, BLACK);
    // 5 white numbers + 1 special red in brackets, all starting at col 55
    const numStr = reading.luckyNumbers.slice(0,5).map(n => String(n).padStart(2,'0')).join(' ');
    s.putString(55, 17, numStr, WHITE, BLACK);
    s.putString(55 + numStr.length + 1, 17, '[' + String(reading.specialNumber).padStart(2,'0') + ']', BRIGHT_RED, BLACK);

    s.putString(40, 18, 'Focus Area   :', CYAN, BLACK);
    s.putString(55, 18, HOUSE_MEANINGS[reading.focusHouse - 1].substring(0, 23), BRIGHT_CYAN, BLACK);

    // Single compatible sign (first from list)
    s.putString(40, 19, 'Compatible   :', CYAN, BLACK);
    const compatSign = (D.COMPATIBLE_SIGNS[sign.name] || [])[0] || 'Libra';
    s.putString(55, 19, compatSign.substring(0, 23), BRIGHT_GREEN, BLACK);

    s.putString(40, 20, 'Lucky Time   :', CYAN, BLACK);
    s.putString(55, 20, reading.favorableTime, WHITE, BLACK);

    Draw.hLine(s, 2, 21, 77, Draw.BOX_SINGLE, MAGENTA, BLACK);

    // Continuity hook 
    const hook = reading.continuityHook;

    const chLines = Utils.wordWrap(hook, 75);
    r = 22;
    for (const line of chLines) s.putString(3, r++, line, BRIGHT_CYAN, BLACK);

    // Status bar - clear L vs ENTER distinction per #7
    if (this._profile.luckyDrawToday) {
      s.statusBar('  [ENTER] Full Chart Reading   [Q] Back to Dashboard', BLACK, MAGENTA);
    } else {
      s.statusBar('  [L] Lucky Draw   [ENTER] Full Chart Reading   [Q] Back', BLACK, MAGENTA);
    }
  }

  _generateDailyReading(sign) {
    const signIdx = SIGNS.indexOf(sign);
    const seed = dateSeed(this.now) * 31 + signIdx * 97 + 7;
    const prng = new DailyPRNG(seed);

    const planetsInSign = PLANETS_ORDERED.filter(p => this.sky[p].signIndex === signIdx);
    const focusPlanet   = planetsInSign.length > 0 ? planetsInSign[0] : sign.ruler;
    const focusPlanetData = this.sky[focusPlanet] || this.sky.Sun;
    const focusHouse    = ((signIdx - this.sky.Sun.signIndex + 12) % 12) + 1;

    // P1: Astronomical opener
    const tmpl = prng.pick(D.TRANSIT_OPENERS);
    const p1 = tmpl
      .replace('{planet}', focusPlanet)
      .replace('{degree}', focusPlanetData.degree)
      .replace('{sign}', focusPlanetData.sign.name)
      .replace('{house}', focusHouse)
      .replace('{houseMeaning}', HOUSE_MEANINGS[focusHouse - 1]);

    /*
    // P2: Moon energy + Barnum
    const moonEn = D.MOON_ENERGY[this.moonPhase.name] || 'The lunar energy heightens your sensitivity today.';
    const barnum = prng.pick(D.BARNUM_CORE);
    const p2 = moonEn + ' ' + barnum;
    */

    // P2: Barnum
    const barnum = prng.pick(D.BARNUM_CORE);
    const p2 = barnum;

    // P3: A-B-C
    const topAspect = this.aspects.find(a => a.p1 === focusPlanet || a.p2 === focusPlanet);
    let p3_A = '';
    if (topAspect) {
      const tpl = D.ASPECT_INTERPRETATIONS[topAspect.name];
      if (Array.isArray(tpl)) { p3_A = prng.pick(tpl); }
      else if (tpl) { p3_A = prng.pick(topAspect.quality === 'tense' || topAspect.quality === 'intense' ? tpl.tense : tpl.harmonious); }
    }
    const virtTpl = prng.pick(D.VIRTUE_TEMPLATES);
    const p3_B = virtTpl
      .replace('{keyword}',  prng.pick(sign.keywords))
      .replace('{element}',  sign.element)
      .replace('{keyword2}', prng.pick(sign.keywords));
    const p3_C = prng.pick(D.ACTIONS[sign.element]);

    // P4: Barnum
    let barnum2;
    do {
        barnum2 = prng.pick(D.BARNUM_CORE);
    } while (barnum2 === p2);
    const p4 = barnum2;

    // P5: Romance (injected if Venus or Mars is focus, or 1-in-3 chance)
    let p5 = '';
    if (focusPlanet === 'Venus') p5 = prng.pick(D.ROMANCE_VENUS);
    else if (focusPlanet === 'Mars') p5 = prng.pick(D.ROMANCE_MARS);
    else if (prng.range(0, 2) === 0) p5 = prng.pick(D.ROMANCE_GENERAL);

    // P6: Moon energy
    const moonArray = D.MOON_ENERGY[this.moonPhase.name];
    const moonEn_paragraph = moonArray 
      ? prng.pick(moonArray) 
      : 'The lunar energy heightens your sensitivity today.';
    const p6 = moonEn_paragraph;

    const horoscope_paragraph_pre = p1 + " " + p2 + " " + [p3_A, p3_B, p3_C].filter(Boolean).join(' ') + " " + p4 + " " + p5 + " " + p6

const maxLength = 800;

function shortenToSentence(str, max) {
  if (str.length <= max) return str;
  
  const subStr = str.substring(0, max);
  // Matches the last occurrence of . ! or ?
  const match = subStr.match(/.*[.!?]/);
  
  return match ? match[0] : subStr;
}

const horoscope_paragraph = shortenToSentence(horoscope_paragraph_pre, maxLength);

    const continuityHook = prng.pick(D.CONTINUITY_HOOKS);

    // Lucky numbers: 5 from 1-69, 1 special from 1-24
    const pool = Array.from({length: 69}, (_, i) => i + 1);
    const luckyNumbers = prng.pickN(pool, 5).sort((a, b) => a - b);
    const specialNumber = prng.range(1, 24);

    // favorableTime
    const hours = prng.range(1, 12);
    const mins = prng.pick(['00', '15', '30', '45']);
    const ampm = prng.pick(['AM', 'PM']);
    const favorableTime = `${hours}:${mins} ${ampm}`;

    return {
      // paragraphs: [p1, p2, [p3_A, p3_B, p3_C].filter(Boolean).join(' '), p4].filter(Boolean),
      paragraphs: [horoscope_paragraph].filter(Boolean),
      continuityHook,
      luckyNumbers, specialNumber,
      luckyColor:  prng.pick(D.LUCKY_COLORS),
      crystal:     prng.pick(D.CRYSTALS),
      tarotCard:   prng.pick(D.TAROT_CARDS),
      energyLevel: prng.range(2, 5),
      focusHouse,
      favorableTime,
    };
  }

  // ─── LUCKY DRAW ──────────────────────────────────────────────────────────

  async _runLuckyDraw(sign) {
    if (this._profile.luckyDrawToday) {
      // Already drawn  --  go straight to chart
      return;
    }
    this._sessionDidLucky = true;

    const s = this.screen;
    s.clear(BLACK, BLACK);
    Draw.titledBox(s, 15, 6, 50, 14, ' ++ LUCKY DRAW ++ ', Draw.BOX_DOUBLE, BRIGHT_YELLOW, BLACK, BRIGHT_WHITE, BLACK);
    Draw.centerText(s, 8, 'The cosmos reaches into the void...', BRIGHT_CYAN, BLACK);
    s.flush();
    await this._sleep(800);

    const spinChars = ['|', '/', '-', '\\'];
    for (let i = 0; i < 12; i++) {
      Draw.centerText(s, 11, '    ' + spinChars[i % 4] + '    ', BRIGHT_YELLOW, BLACK);
      s.flush();
      await this._sleep(100);
    }

    const prng = new DailyPRNG(dateSeed(this.now) * 53 + SIGNS.indexOf(sign) * 17 + (this._profile.xp || 0));
    const roll = prng.range(1, 100);
    let prize, prizeColor, xpGain;

    if      (roll >= 95) { prize = 'COSMIC ALIGNMENT! +50 XP'; prizeColor = BRIGHT_YELLOW; xpGain = 50; }
    else if (roll >= 75) { prize = 'Stellar Fortune!  +25 XP'; prizeColor = BRIGHT_CYAN;   xpGain = 25; }
    else if (roll >= 40) { prize = 'Celestial Boost!  +15 XP'; prizeColor = BRIGHT_GREEN;  xpGain = 15; }
    else if (roll >= 20) { prize = 'Astral Flicker.    +5 XP'; prizeColor = WHITE;          xpGain = 5;  }
    else                 { prize = 'The stars are silent. +1'; prizeColor = CYAN;           xpGain = 1;  }

    this._addXP(xpGain, 'Lucky Draw');
    this._profile.luckyDrawToday = true;
    this._awardBadge('lucky_draw');
    this.db?.saveScore(MysticObservatory.GAME_NAME, this.username, this._profile.xp, { streak: this._profile.streak });
    this._saveProfile();

    Draw.centerText(s, 11, prize, prizeColor, BLACK);
    Draw.centerText(s, 13, 'Total XP: ' + this._profile.xp + '  Level ' + this._profile.level, BRIGHT_MAGENTA, BLACK);
    Draw.centerText(s, 32, '[ENTER] Continue', CYAN, BLACK);
    s.statusBar('  [ENTER] Continue   [Q] Return', BLACK, MAGENTA);
    s.flush();
    await this.terminal.waitKey();
  }

// ─── CHART INVITE ────────────────────────────────────────────────────────

  async _runChartInvite(existingBirthDate) {
    const s = this.screen;
    s.clear(BLACK, BLACK);

    const prng = new DailyPRNG(dateSeed(this.now) + 999);
    for (let i = 0; i < 60; i++)
      s.putChar(prng.range(1,80), prng.range(2,23), prng.pick(['.','+']), prng.pick([CYAN, MAGENTA]), BLACK);

    // Expanded the box height (y: 2, height: 21) to fit the 4 input fields
    Draw.titledBox(s, 5, 2, 70, 21, ' ++ YOUR NATAL CHART AWAITS ++ ', Draw.BOX_DOUBLE, BRIGHT_MAGENTA, BLACK, BRIGHT_YELLOW, BLACK);

    Draw.centerText(s, 4, 'The stars remember the moment of your birth.', BRIGHT_CYAN, BLACK);
    Draw.centerText(s, 5, 'Each planet\'s position then is your cosmic signature,', WHITE, BLACK);
    Draw.centerText(s, 6, 'and it speaks to who you are -- and what this day holds.', WHITE, BLACK);
    Draw.hLine(s, 6, 7, 68, Draw.BOX_SINGLE, MAGENTA, BLACK);

    if (existingBirthDate) {
      const bdStr = existingBirthDate.toISOString().slice(0,10);
      Draw.centerText(s, 9, 'Birth date on record: ' + bdStr, BRIGHT_GREEN, BLACK);
      Draw.centerText(s, 11, 'Use this date for your natal chart reading?', BRIGHT_WHITE, BLACK);
      Draw.centerText(s, 13, '[Y] Yes    [N] New date    [ESC] Return', CYAN, BLACK);
      s.flush();
      while (true) {
        const key = await this.terminal.waitKey();
        if (key === 'y' || key === 'Y' || key === '\r') return existingBirthDate;
        if (key === '\x1b') return 'skip';
        if (key === 'q' || key === 'Q') return 'skip';
        if (key === 'l' || key === 'L') return 'lucky';
        if (key === 'n' || key === 'N') break;
      }
    } else {
      Draw.centerText(s, 8, 'Enter your birth date to unlock your natal chart.', BRIGHT_WHITE, BLACK);
      Draw.centerText(s, 9, 'A natal chart reveals your cosmic blueprint and shows', WHITE, BLACK);
      Draw.centerText(s, 10, 'which planetary currents are active in your life today.', WHITE, BLACK);
    }

    // ── 1. BIRTH DATE INPUT ──
    Draw.centerText(s, 13, '                                        ');
    s.flush();

    Draw.centerText(s, 12, 'Enter birth date (YYYY-MM-DD):', BRIGHT_CYAN, BLACK);
    s.putString(29, 13, '> ', BRIGHT_YELLOW, BLACK);
    s.flush();

    let input = '';
    this.terminal.moveTo(31, 13);
    this.terminal.setColor(WHITE, BLACK);

    while (true) {
      const key = await this.terminal.waitKey();
      if (key === 'q' || key === 'Q') return 'skip';
      if (key === 'l' || key === 'L') return 'lucky';
      if (key === '\x1b') return 'skip';
      if (key === '\r' || key === '\n') break;
      if (key === '\x7f' || key === '\x08' || key === 'BACKSPACE' ) {
        if (input.length > 0) {
          input = input.slice(0, -1);
          this.terminal.writeRaw('\x08 \x08');
        }
        continue;
      }
      if (input.length < 10 && (key >= '0' && key <= '9' || key === '-')) {
        input += key;
        this.terminal.write(key);
      }
    }

    // ── 2. BIRTH HOUR INPUT ──
    s.statusBar('  [ENTER] Continue', BLACK, MAGENTA);
    Draw.centerText(s, 20, 'Leave at 12 (noon) if unsure.', MAGENTA, BLACK);
    Draw.centerText(s, 21, '14=2PM  16=4PM  18=6PM  20=8PM  22=10PM  0=12AM', MAGENTA, BLACK);
    Draw.centerText(s, 14, 'Enter birth hour (0-23):', BRIGHT_CYAN, BLACK);
    s.putString(29, 15, '> ', BRIGHT_YELLOW, BLACK);
    
    let hourInput = '12';
    s.putString(31, 15, hourInput, WHITE, BLACK);
    s.flush();
    this.terminal.moveTo(31 + hourInput.length, 15);
    this.terminal.setColor(WHITE, BLACK);

    while (true) {
      const key = await this.terminal.waitKey();
      if (key === '\x1b') return 'skip';
      if (key === '\r' || key === '\n') break;
      if (key === '\x7f' || key === '\x08' || key === 'BACKSPACE' ) {
        if (hourInput.length > 0) {
          hourInput = hourInput.slice(0, -1);
          this.terminal.writeRaw('\x08 \x08');
        }
        continue;
      }
      if (hourInput.length < 2 && (key >= '0' && key <= '9')) {
        hourInput += key;
        this.terminal.write(key);
      }
    }

    // ── 3. TIME ZONE INPUT ──
    s.statusBar('  [ENTER] Continue', BLACK, MAGENTA);
    Draw.centerText(s, 20, '                                              ');
    Draw.centerText(s, 21, '                                              ');
    Draw.centerText(s, 20, '-5=EST  -6=CST  -7=MST  -8=PST  -9=AKST  -10=HST', MAGENTA, BLACK);
    Draw.centerText(s, 21, '+0=GMT  +1=CET  +3=EAT  +3=MSK  +8=CST  +10=AEST', MAGENTA, BLACK);
    Draw.centerText(s, 16, 'Enter birth time zone (-12 to +14):', BRIGHT_CYAN, BLACK);
    s.putString(29, 17, '> ', BRIGHT_YELLOW, BLACK);
    
    let tzInput = '-5';
    s.putString(31, 17, tzInput, WHITE, BLACK);
    s.flush();
    this.terminal.moveTo(31 + tzInput.length, 17);
    this.terminal.setColor(WHITE, BLACK);

    while (true) {
      const key = await this.terminal.waitKey();
      if (key === '\x1b') return 'skip';
      if (key === '\r' || key === '\n') break;
      if (key === '\x7f' || key === '\x08' || key === 'BACKSPACE' ) {
        if (tzInput.length > 0) {
          tzInput = tzInput.slice(0, -1);
          this.terminal.writeRaw('\x08 \x08');
        }
        continue;
      }
      // Allow minus, plus, and numbers up to 3 chars
      if (tzInput.length < 3 && ((key >= '0' && key <= '9') || key === '-' || key === '+')) {
        tzInput += key;
        this.terminal.write(key);
      }
    }

    // ── 4. HEMISPHERE INPUT ──
    s.statusBar('  [ENTER] Continue', BLACK, MAGENTA);
    Draw.centerText(s, 20, '                                                  ');
    Draw.centerText(s, 21, '                                                  ');
    Draw.centerText(s, 18, 'Enter birth hemisphere (north, south, equator):', BRIGHT_CYAN, BLACK);
    s.putString(29, 19, '> ', BRIGHT_YELLOW, BLACK);
    
    let hemiInput = 'north';
    s.putString(31, 19, hemiInput, WHITE, BLACK);
    s.flush();
    this.terminal.moveTo(31 + hemiInput.length, 19);
    this.terminal.setColor(WHITE, BLACK);

    while (true) {
      const key = await this.terminal.waitKey();
      if (key === '\x1b') return 'skip';
      if (key === '\r' || key === '\n') break;
      if (key === '\x7f' || key === '\x08' || key === 'BACKSPACE' ) {
        if (hemiInput.length > 0) {
          hemiInput = hemiInput.slice(0, -1);
          this.terminal.writeRaw('\x08 \x08');
        }
        continue;
      }
      // Allow letters only, up to 7 characters (length of 'equator')
      if (hemiInput.length < 7 && (key.match(/[a-zA-Z]/))) {
        hemiInput += key;
        this.terminal.write(key);
      }
    }

    // --- Validation Logic ---
    // Validate birth hour (0-23)
    const checkHour = parseInt(hourInput, 10);
    if (isNaN(checkHour) || checkHour < 0 || checkHour > 23) {
      hourInput = '12';
    }

    // Validate time zone (-12 to +14)
    const checkTz = parseInt(tzInput, 10);
    if (isNaN(checkTz) || checkTz < -12 || checkTz > 14) {
      tzInput = '-5';
    }

    // Validate hemisphere (north, south, equator)
    const validHemis = ['north', 'south', 'equator'];
    if (!validHemis.includes(hemiInput.toLowerCase().trim())) {
      hemiInput = 'north';
    }

    // Save inputs to profile so _computeNatalChart can use them later
    this._profile.birthHour = parseInt(hourInput, 10);
    this._profile.birthTz = parseInt(tzInput, 10);
    this._profile.birthHemi = hemiInput.toLowerCase().trim();

    const parsed = new Date(input + 'T12:00:00Z');
    if (isNaN(parsed.getTime()) || parsed.getFullYear() < 1900 || parsed.getFullYear() > 2020) {
      s.clear(BLACK, BLACK);
      Draw.centerText(s, 12, 'That date could not be read by the stars.', BRIGHT_RED, BLACK);
      Draw.centerText(s, 13, 'Please try again. Format: 1985-06-21', CYAN, BLACK);
      s.flush();
      await this._sleep(1200);
      return 'chart_invite';
    }
    
    return parsed;
  }

  // ─── FULL NATAL CHART ────────────────────────────────────────────────────

  async _runFullChart(birthDate, selectedSignIdx) {
    this._sessionDidChart = true;
    if (!this._profile.chartReadToday) {
      this._addXP(XP_CHART, 'Natal Chart Reading');
      this._profile.chartReadToday = true;
      this._awardBadge('chart_cast');
      this.db?.saveScore(MysticObservatory.GAME_NAME, this.username, this._profile.xp, { streak: this._profile.streak });
      this._saveProfile();
    }

    const natal = this._computeNatalChart(birthDate);
    await this._drawChartPage1(natal, birthDate);
    await this._drawChartPage2(natal, birthDate);
    
    const s = this.screen;

    // Status bar - clear L vs ENTER distinction
    if (this._profile.luckyDrawToday) {
      s.statusBar('  [ENTER] Return to Dashboard   [Q] Return', BLACK, MAGENTA);
    } else {
      s.statusBar('  [ENTER] Lucky Draw   [Q] Return', BLACK, MAGENTA);
    }
    s.flush();
    while (true) {
      const key = await this.terminal.waitKey();
      if (key === 'q' || key === 'Q' || key === '\x1b') return 'back';
      // L = Lucky Draw (only if not yet drawn today)
      else if ((key === '\r' || key === '\n') && !this._profile.luckyDrawToday) {
        return 'lucky';
      }
      else if (key === '\r' || key === '\n') {

        return 'back';
      }
    }
  }

  async _drawChartPage1(natal, birthDate) {
    const s = this.screen;
    s.clear(BLACK, BLACK);
    s.flush();
    const sunSign  = natal.Sun.sign;
    const moonSign = natal.Moon.sign;
    const ascSign  = natal.ascendant.sign;

    Draw.titledBox(s, 1, 1, 79, 24, ' NATAL CHART READING ', Draw.BOX_DOUBLE, BRIGHT_MAGENTA, BLACK, BRIGHT_YELLOW, BLACK);

    // Left panel (cols 2-39)
    s.putString(2, 2, 'THE BIG THREE', BRIGHT_CYAN, BLACK);
    Draw.hLine(s, 2, 3, 38, Draw.BOX_SINGLE, MAGENTA, BLACK);

    s.putString(2, 4, 'Sun Sign  :', CYAN, BLACK); s.putString(13, 4, sunSign.sym  + ' ' + sunSign.name,  sunSign.color,  BLACK);
    s.putString(2, 5, 'Moon Sign :', CYAN, BLACK); s.putString(13, 5, moonSign.sym + ' ' + moonSign.name, moonSign.color, BLACK);
    s.putString(2, 6, 'Ascendant :', CYAN, BLACK); s.putString(13, 6, ascSign.sym  + ' ' + ascSign.name,  ascSign.color,  BLACK);

    // Big three synopsis
    const synKey = sunSign.element + moonSign.element;
    const synText = D.BIG_THREE_SYNTH[synKey] || D.BIG_THREE_SYNTH['WaterWater'];
    const ascAddendum = ' Your ' + ascSign.name + ' ascendant shapes how this is perceived by others.';
    const synLines = Utils.wordWrap(synText + ascAddendum, 37);
    Draw.hLine(s, 2, 7, 38, Draw.BOX_SINGLE, MAGENTA, BLACK);
    let r = 8;
    for (const line of synLines.slice(0, 8)) s.putString(2, r++, line, BRIGHT_WHITE, BLACK);

    // Birthstone + Chinese Zodiac
    const bMonth = birthDate.getUTCMonth() + 1;
    const bYear  = birthDate.getUTCFullYear();
    const bs = D.BIRTHSTONES.find(b => b.month === bMonth);
    const cz = D.getChineseZodiac(bYear);

    Draw.hLine(s, 2, 16, 38, Draw.BOX_SINGLE, MAGENTA, BLACK);
    s.putString(2, 17, 'Birthstone:', CYAN, BLACK);
    s.putString(15, 17, (bs ? bs.stone : 'Unknown').substring(0, 22), BRIGHT_YELLOW, BLACK);
    //if (bs) {
    //  const bsLines = Utils.wordWrap(bs.meaning, 37);
    //  if (bsLines[0]) s.putString(2, 18, bsLines[0].substring(0, 37), WHITE, BLACK);
    //}
    s.putString(2, 18, 'Chinese Zodiac: ', CYAN, BLACK);
    s.putString(18, 18, (bYear + ' - ' + cz.name).substring(0, 22), BRIGHT_YELLOW, BLACK);
    const czLines = Utils.wordWrap(cz.desc, 37);
    r = 19;
    for (const line of czLines.slice(0, 5)) s.putString(2, r++, line.substring(0, 37), BRIGHT_WHITE, BLACK);

    // Right panel (cols 41-79): Planet placements
    Draw.vLine(s, 40, 2, 21, Draw.BOX_SINGLE, MAGENTA, BLACK);
    s.putChar(40, 1, '╤', BRIGHT_MAGENTA, BLACK);
    s.putChar(40, 24, '╧', BRIGHT_MAGENTA, BLACK);

    s.putString(41, 2, 'PLANETARY POSITIONS', BRIGHT_CYAN, BLACK);
    Draw.hLine(s, 41, 3, 38, Draw.BOX_SINGLE, MAGENTA, BLACK);
    s.putString(41, 4, 'Planet   Sign        Deg  Hse', CYAN, BLACK);
    Draw.hLine(s, 41, 5, 38, Draw.BOX_SINGLE, MAGENTA, BLACK);

    r = 6;
    for (const p of PLANETS_ORDERED) {
      const pd = natal[p];
      s.putString(41, r, p.padEnd(8),                    PLANET_DATA[p].color, BLACK);
      s.putString(50, r, pd.sign.name.substring(0,10).padEnd(10), CYAN, BLACK);
      s.putString(62, r, String(pd.degree).padStart(2,'0') + '°', WHITE, BLACK);
      s.putString(67, r, 'H' + pd.house,                  BRIGHT_MAGENTA, BLACK);
      r++;
    }

    // Key natal aspects
    Draw.hLine(s, 41, 16, 38, Draw.BOX_SINGLE, MAGENTA, BLACK);
    s.putString(41, 17, 'KEY NATAL ASPECTS', BRIGHT_CYAN, BLACK);
    Draw.hLine(s, 41, 18, 38, Draw.BOX_SINGLE, MAGENTA, BLACK);
    r = 19;
    for (const asp of natal._aspects.slice(0, 5)) {
      const col = asp.quality === 'tense' ? BRIGHT_RED : asp.quality === 'flowing' ? BRIGHT_GREEN : BRIGHT_CYAN;
      // Plain text: "Saturn   Square    Uranus"
      const aspLine = (asp.p1.padEnd(8) + asp.name.padEnd(12) + asp.p2).substring(0, 38);
      s.putString(41, r++, aspLine, col, BLACK);

      // box fixes
      s.putChar(40, 1, 'R', BRIGHT_YELLOW, BLACK);
      s.putChar(40, 23, '│', MAGENTA, BLACK);
      s.putChar(40, 24, '╧', BRIGHT_MAGENTA, BLACK);
    }

    s.statusBar('  [ENTER] See Your Personal Forecast   [Q] Return', BLACK, MAGENTA);
    s.flush();
    await this._waitEnterOrQ();
  }

  async _drawChartPage2(natal, birthDate) {
    const s = this.screen;
    s.clear(BLACK, BLACK);

    const sunSign  = natal.Sun.sign;
    const moonSign = natal.Moon.sign;
    const prng = new DailyPRNG(dateSeed(this.now) * 41 + (birthDate.getTime() % 10000));

    Draw.titledBox(s, 1, 1, 79, 24, ' PERSONAL PLANETARY FORECAST ', Draw.BOX_DOUBLE, BRIGHT_MAGENTA, BLACK, BRIGHT_YELLOW, BLACK);

    s.putString(2, 2, '                               ACTIVE TRANSITS', MAGENTA, BLACK);
 
    let r = 3;
    for (const t of natal._transits.slice(0, 4)) {
      const cpd = PLANET_DATA[t.currentPlanet];
      const npd = PLANET_DATA[t.natalPlanet];
      const col = t.quality === 'tense' ? BRIGHT_RED : t.quality === 'flowing' ? BRIGHT_GREEN : BRIGHT_CYAN;

      // Transit header -- no Unicode symbols, use plain text
      const header = (t.currentPlanet + ' ' + t.name + ' natal ' + t.natalPlanet).substring(0, 50);
      s.putString(2, r, header, col, BLACK);
      s.putString(55, r, ('Exact:' + Math.round(t.exactness * 100) + '%').substring(0, 12), CYAN, BLACK);
      r++;

      let interp = '';
      const tpl = D.ASPECT_INTERPRETATIONS[t.name];
      if (Array.isArray(tpl)) interp = prng.pick(tpl);
      else if (tpl) interp = prng.pick(t.quality === 'tense' || t.quality === 'intense' ? tpl.tense : tpl.harmonious);
      else interp = prng.pick(D.BARNUM_CORE);

      // const domain = 'Touches your ' + npd.domain + ' through ' + cpd.domain + '.';
      const full = interp // + ' ' + domain;
      const lines = Utils.wordWrap(full, 76);
      for (const line of lines.slice(0, 2)) {
        if (r > 18) break;
        s.putString(2, r++, line, BRIGHT_WHITE, BLACK);
      }
      r++;
      if (r > 18) break;
    }

    Draw.hLine(s, 2, 18, 77, Draw.BOX_SINGLE, MAGENTA, BLACK);

    // Romance paragraph -- always in full chart
    const romancePara = this.sky.Venus.signIndex === natal.Venus.signIndex
      ? prng.pick(D.ROMANCE_VENUS)
      : prng.pick(D.ROMANCE_GENERAL);
    const romLines = Utils.wordWrap(romancePara, 76);
    r = 19;
    for (const line of romLines.slice(0, 3)) {
      if (r > 21) break;
      Draw.centerText(s, r++, line, BRIGHT_MAGENTA, BLACK);
    }

    // Closing synthesis -- row 23 only
    Draw.hLine(s, 2, 22, 77, Draw.BOX_SINGLE, MAGENTA, BLACK);
    const closing = 'The stars chart your path. Return tomorrow to see how it shifts.';
    Draw.centerText(s, 23, closing.substring(0, 78), BRIGHT_CYAN, BLACK);
    s.flush();

  }

  // ─── LEARN PAGE ──────────────────────────────────────────────────────────

  async _runLearnPage() {
    const s = this.screen;

    const pages = [
      {
        title: 'ABOUT THE OBSERVATORY',
        lines: [
          'The Mystic Observatory reads the sky the way classical astrologers have',
          'for thousands of years -- using the actual positions of the planets.',
          '',
          'Each planet moves through the twelve signs of the Zodiac at its own',
          'pace. The Sun changes sign roughly every 30 days. The Moon every 2.5',
          'days. Saturn takes 29 years to complete one circuit. Each planet',
          'governs a domain of life: Venus rules love, Mars governs action,',
          'Mercury oversees communication.',
          '',
          'The DASHBOARD shows where every planet sits in the sky TODAY. Each',
          'planet is listed with its current sign and exact degree. An "Rx"',
          'marker means the planet is in RETROGRADE -- it appears to move',
          'backward through the sky from Earth\'s perspective. Retrograde periods',
          'traditionally call for review and reflection rather than new action.',
          '',
          '[ENTER] Next Page   [Q] Return',
        ],
      },
      {
        title: 'READING THE DASHBOARD',
        lines: [
          'The TODAY\'S SKY panel shows where every planet is RIGHT NOW.',
          '',
          'Each row shows: Planet name, Degree (0-29), Sign, and "Rx".',
          '',
          '"Rx" means RETROGRADE -- the planet appears to move backward',
          'through the sky from Earth\'s perspective. This is an optical',
          'illusion caused by orbital mechanics, but astrologers treat it',
          'as a time for review and reflection in that planet\'s domain.',
          'Mercury Rx: rethink communication. Venus Rx: revisit love.',
          'Mars Rx: reconsider your actions before pushing forward.',
          '',
          'The ACTIVE ASPECTS panel shows today\'s strongest planetary',
          'angles. "Sun Trine Jupiter" means the Sun and Jupiter are',
          '120 degrees apart -- a flowing, supportive connection.',
          'The bar shows how exact the aspect is (fuller = more exact).',
          '',
          '[ENTER] Next Page   [Q] Return',
        ],
      },
      {
        title: 'READING YOUR HOROSCOPE',
        lines: [
          'Your daily horoscope is generated from two real calculations:',
          '',
          '1. TODAY\'S SKY -- where the planets are right now.',
          '2. YOUR NATAL CHART -- where they were when you were born.',
          '',
          'TRANSITS are the relationships between these two maps. When Mars',
          'today makes a 90-degree Square to your natal Sun, astrologers',
          'read: tension between your drive (Mars) and identity (Sun).',
          '',
          'THE FIVE MAJOR ASPECTS:',
          '  Conjunction (0 deg)  -- fusion, intensity, amplification',
          '  Sextile    (60 deg)  -- opportunity, cooperation, ease',
          '  Square     (90 deg)  -- friction, challenge, growth',
          '  Trine     (120 deg)  -- flow, natural gift, support',
          '  Opposition(180 deg)  -- tension, balance, awareness',
          '',
          '[ENTER] Next Page   [Q] Return',
        ],
      },
      {
        title: 'THE NATAL CHART',
        lines: [
          'Your NATAL CHART is a map of the sky at your exact moment of birth.',
          'It is unique to you -- no one born at a different time has the same one.',
          '',
          'THE BIG THREE:',
          '  Sun Sign   -- your core identity, purpose, and conscious self',
          '  Moon Sign  -- your emotional nature, instincts, and inner life',
          '  Ascendant  -- how you appear to others; your social mask',
          '',
          'HOUSES divide the chart into 12 areas of life. The Observatory uses',
          'the Whole Sign system -- the simplest and oldest method -- where each',
          'house corresponds to one complete sign.',
          '',
          'Enter your birthdate to unlock your natal chart. The more specific',
          'the date and location, the more precisely your chart can be read.',
          '',
          '[ENTER] Return to Dashboard   [Q] Return',
        ],
      },
    ];

    let page = 0;
    while (true) {
      s.clear(BLACK, BLACK);
      Draw.titledBox(s, 2, 1, 76, 24, ' ++ OBSERVATORY GUIDE ++ ', Draw.BOX_DOUBLE, BRIGHT_CYAN, BLACK, BRIGHT_YELLOW, BLACK);
      s.putString(4, 2, pages[page].title, BRIGHT_MAGENTA, BLACK);
      Draw.hLine(s, 3, 3, 74, Draw.BOX_SINGLE, MAGENTA, BLACK);

      for (let i = 0; i < pages[page].lines.length && i < 18; i++) {
        s.putString(4, 4 + i, pages[page].lines[i].substring(0, 72), BRIGHT_WHITE, BLACK);
      }
      s.putString(4, 23, 'Page ' + (page + 1) + ' of ' + pages.length, CYAN, BLACK);
      s.statusBar('  [ENTER] ' + (page < pages.length - 1 ? 'Next' : 'Done') + '   [Q] Return', BLACK, MAGENTA);
      s.flush();

      const key = await this.terminal.waitKey();
      if (key === 'q' || key === 'Q' || key === '\x1b') return;
      if (key === '\r' || key === '\n') {
        if (page < pages.length - 1) page++;
        else return;
      }
    }
  }

  // ─── GOODBYE SCREEN ──────────────────────────────────────────────────────

  async _showGoodbye() {
    const s = this.screen;
    s.clear(BLACK, BLACK);

    // Starfield
    const prng = new DailyPRNG(Date.now() % 9999 + 1);
    for (let i = 0; i < 120; i++) {
      s.putChar(prng.range(1,80), prng.range(1,24),
        prng.pick(['.', '+', '*', CP437.BULLET]),
        prng.pick([CYAN, WHITE, BRIGHT_CYAN, MAGENTA, BRIGHT_MAGENTA]), BLACK);
    }

    // Day-of-week art (0=Sun, 1=Mon ... 6=Sat)
    const dow = this.now.getDay();
    const art = D.GOODBYE_IMAGES[dow] || D.GOODBYE_IMAGES[0];
    const artStartRow = Math.floor((18 - art.length) / 2) + 1;
    for (let i = 0; i < art.length; i++) {
      Draw.centerText(s, artStartRow + i, art[i], BRIGHT_YELLOW, BLACK);
    }

    const artEnd = artStartRow + art.length;
    Draw.centerText(s, artEnd + 1, '~ The stars remember you ~', BRIGHT_MAGENTA, BLACK);
    Draw.centerText(s, artEnd + 2, 'Return tomorrow for your next reading', CYAN, BLACK);

    if (this._xpGains.length > 0) {
      const total = this._xpGains.reduce((sum, g) => sum + g.amount, 0);
      Draw.centerText(s, artEnd + 4, 'Gained ' + total + ' XP today  |  Total: ' + this._profile.xp + ' XP  |  Level ' + this._profile.level, BRIGHT_CYAN, BLACK);
    }
    if (this._newBadges.length > 0) {
      Draw.centerText(s, artEnd + 5, 'Badges: ' + this._newBadges.map(b => b.name).join(', '), BRIGHT_YELLOW, BLACK);
    }

    s.flush();
    await this._sleep(3000);
  }

  // ─── LEADERBOARD ─────────────────────────────────────────────────────────

  async _showLeaderboard() {
    await this.showLeaderboard(MysticObservatory.GAME_NAME, 'COSMIC RANKINGS');
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  async _waitEnterOrQ() {
    while (true) {
      const key = await this.terminal.waitKey();
      if (key === '\x1b' || key === 'q' || key === 'Q' || key === '\r' || key === '\n') return;
    }
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = MysticObservatory;
