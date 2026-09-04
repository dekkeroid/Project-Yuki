"""
context_feed.py — Real-time situational awareness for Project Yuki.

Provides:
  - Granular location resolution (City, State/Region, Country) via auto-detection or user settings
  - VPN / Datacenter proxy detection: skips IP geolocation if VPN is detected to prevent false city data
  - Fallback to Windows OS kernel country code when offline or behind VPN
  - Live local weather via wttr.in (cached, 30m TTL, skipped if reliable city unavailable)
  - Regional or topic-targeted news headlines via Google News RSS (cached, 45m TTL)
  - Explicit terminal logging for all resolution steps
"""

import sys
import time
import json
import html
import re
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import concurrent.futures
from typing import Dict, Any, List, Optional, Tuple
from app import config

# ---------------------------------------------------------------------------
# Caches with TTLs
# ---------------------------------------------------------------------------
_LOCATION_CACHE: Dict[str, Any] = {"data": None, "timestamp": 0.0}
_WEATHER_CACHE: Dict[str, Any] = {}
_NEWS_CACHE: Dict[str, Any] = {}

LOCATION_TTL_SEC = 21600.0  # 6 hours
WEATHER_TTL_SEC = 1800.0    # 30 minutes
NEWS_TTL_SEC = 2700.0       # 45 minutes


def _safe_log(msg: str):
    """Prints a message to terminal with safe console encoding handling on Windows."""
    try:
        enc = sys.stdout.encoding or "utf-8"
        clean = msg.encode(enc, errors="replace").decode(enc)
        print(clean)
    except Exception:
        try:
            print(msg.encode("ascii", errors="replace").decode("ascii"))
        except Exception:
            pass


def _get_windows_country_code() -> str:
    """
    Reads default OS country code from Windows kernel32.
    Works offline, instantaneous, and immune to VPN tunnels.
    """
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(10)
        res = ctypes.windll.kernel32.GetUserDefaultGeoName(buf, 10)
        if res > 0 and buf.value.strip():
            return buf.value.strip().upper()
    except Exception:
        pass
    return "US"


_COUNTRY_ALIASES: Dict[str, str] = {
    "uk": "GB", "united kingdom": "GB", "great britain": "GB", "england": "GB", "scotland": "GB", "wales": "GB",
    "us": "US", "usa": "US", "united states": "US", "america": "US",
    "in": "IN", "india": "IN", "bharat": "IN",
    "ca": "CA", "canada": "CA",
    "jp": "JP", "japan": "JP",
    "de": "DE", "germany": "DE", "deutschland": "DE",
    "fr": "FR", "france": "FR",
    "ru": "RU", "russia": "RU",
    "au": "AU", "australia": "AU",
    "br": "BR", "brazil": "BR",
    "cn": "CN", "china": "CN",
    "it": "IT", "italy": "IT",
    "es": "ES", "spain": "ES",
    "kr": "KR", "korea": "KR", "south korea": "KR",
    "sg": "SG", "singapore": "SG",
    "ae": "AE", "uae": "AE", "dubai": "AE",
    "sa": "SA", "saudi": "SA", "saudi arabia": "SA",
    "nl": "NL", "netherlands": "NL", "holland": "NL",
    "se": "SE", "sweden": "SE",
    "no": "NO", "norway": "NO",
    "fi": "FI", "finland": "FI",
    "nz": "NZ", "new zealand": "NZ",
}


def resolve_user_location(configured_location: Optional[str] = None) -> Dict[str, Any]:
    """
    Resolves the user's location: City, State/Region, and Country.
    - If configured_location is manually set by the user, uses it directly.
    - If "Auto" or empty:
        - Performs IP geolocation via ip-api.com.
        - Checks for VPN / proxy / hosting flags.
        - If VPN is detected or IP lookup fails: skips IP city/region, falls back
          to Windows OS country code, and skips weather.
    """
    now = time.time()
    loc_key = (configured_location or "Auto").strip()

    # 1. Manual user override in Settings
    if loc_key and loc_key.lower() != "auto":
        parts = [p.strip() for p in loc_key.split(",") if p.strip()]
        city = parts[0] if len(parts) > 0 else loc_key
        region = ""
        country = ""
        country_code = ""

        if len(parts) >= 3:
            city, region, country = parts[0], parts[1], parts[2]
            c_norm = country.lower()
            country_code = _COUNTRY_ALIASES.get(c_norm, country[:2].upper() if len(country) == 2 else _get_windows_country_code())
        elif len(parts) == 2:
            p1_norm = parts[1].lower()
            if p1_norm in _COUNTRY_ALIASES:
                # e.g. "London, UK" or "Tokyo, Japan" -> City, Country
                city, region, country = parts[0], "", parts[1]
                country_code = _COUNTRY_ALIASES[p1_norm]
            else:
                # e.g. "San Francisco, CA" or "Patna, Bihar" -> City, Region
                city, region = parts[0], parts[1]
                country = _get_windows_country_code()
                country_code = country
        else:
            city = parts[0]
            country = _get_windows_country_code()
            country_code = country

        result = {
            "city": city,
            "region": region,
            "country": country,
            "country_code": country_code,
            "display": loc_key,
            "is_vpn": False,
            "source": "settings"
        }
        _safe_log(f"[ContextFeed] Location configured from settings: {loc_key} (Country Code: {country_code})")
        return result

    # Check cache if "Auto"
    if _LOCATION_CACHE["data"] and (now - _LOCATION_CACHE["timestamp"]) < LOCATION_TTL_SEC:
        return _LOCATION_CACHE["data"]

    # 2. Auto-detection via fast IP API with VPN check
    detected = None
    try:
        url = "http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,proxy,hosting"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=2.5) as r:
            raw = json.loads(r.read().decode("utf-8", errors="replace"))
            
            if raw.get("status") == "success":
                is_vpn = bool(raw.get("proxy") or raw.get("hosting"))
                
                if is_vpn:
                    # VPN or Datacenter IP detected
                    vpn_city = raw.get("city", "Unknown")
                    vpn_country = raw.get("country", "Unknown")
                    sys_cc = _get_windows_country_code()
                    _safe_log(f"[ContextFeed] VPN / Proxy detected via IP ({vpn_city}, {vpn_country}). Skipping IP location.")
                    _safe_log(f"[ContextFeed] Falling back to system country: {sys_cc} (skipping weather).")
                    detected = {
                        "city": "",
                        "region": "",
                        "country": sys_cc,
                        "country_code": sys_cc,
                        "display": f"Country: {sys_cc} (VPN Active)",
                        "is_vpn": True,
                        "source": "vpn_fallback"
                    }
                else:
                    # Trusted residential connection
                    city = raw.get("city", "").strip()
                    region = raw.get("regionName", "").strip()
                    country = raw.get("country", "").strip()
                    cc = raw.get("countryCode", "US").strip().upper()
                    
                    parts = [p for p in (city, region, country) if p]
                    display = ", ".join(parts) if parts else country
                    _safe_log(f"[ContextFeed] Resolved location: {display}")
                    detected = {
                        "city": city,
                        "region": region,
                        "country": country,
                        "country_code": cc,
                        "display": display,
                        "is_vpn": False,
                        "source": "ip_auto"
                    }
            else:
                reason = raw.get("message", "lookup failed")
                sys_cc = _get_windows_country_code()
                _safe_log(f"[ContextFeed] Auto-location failed ({reason}). Falling back to system country: {sys_cc} (skipping weather).")
                detected = {
                    "city": "",
                    "region": "",
                    "country": sys_cc,
                    "country_code": sys_cc,
                    "display": f"Country: {sys_cc}",
                    "is_vpn": False,
                    "source": "sys_fallback"
                }
    except Exception as e:
        sys_cc = _get_windows_country_code()
        _safe_log(f"[ContextFeed] Auto-location request failed: {e}. Falling back to system country: {sys_cc} (skipping weather).")
        detected = {
            "city": "",
            "region": "",
            "country": sys_cc,
            "country_code": sys_cc,
            "display": f"Country: {sys_cc}",
            "is_vpn": False,
            "source": "sys_fallback"
        }

    _LOCATION_CACHE["data"] = detected
    _LOCATION_CACHE["timestamp"] = now
    return detected


def get_live_weather(location_target: Optional[str] = None) -> Optional[str]:
    """
    Fetches the current weather summary (e.g. 'Patna: ⛅ +33°C')
    from wttr.in with a 2.5-second timeout and 30-minute in-memory cache.
    Only called when a specific city or target is resolved.
    """
    if not location_target or location_target.strip().lower() in ("auto", "none", ""):
        return None

    now = time.time()
    target_clean = location_target.strip()
    cache_key = target_clean.lower()

    if cache_key in _WEATHER_CACHE:
        entry = _WEATHER_CACHE[cache_key]
        if now - entry["timestamp"] < WEATHER_TTL_SEC:
            return entry["data"]

    q = urllib.parse.quote(target_clean)
    url = f"https://wttr.in/{q}?format=3"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
        with urllib.request.urlopen(req, timeout=2.5) as r:
            weather_text = r.read().decode("utf-8", errors="replace").strip()
            if weather_text and "404" not in weather_text and "not found" not in weather_text.lower():
                _WEATHER_CACHE[cache_key] = {"data": weather_text, "timestamp": now}
                return weather_text
    except Exception as e:
        _safe_log(f"[ContextFeed] Weather fetch failed for '{target_clean}': {e}")

    return None


def get_climate_thresholds(country_code: str) -> Tuple[float, float, str]:
    """
    Returns (extreme_heat_celsius, extreme_cold_celsius, climate_zone_label)
    tailored to regional climate baselines so Yuki's reaction thresholds
    are adaptive to what constitutes unusual or extreme weather for that country.
    """
    cc = (country_code or "US").strip().upper()

    # 1. Boreal / Subarctic / Nordic (Cold climates)
    # Summer heat >= 29°C is rare and intense; winter cold is routine, < -8°C is severe freeze
    if cc in ("CA", "RU", "NO", "SE", "FI", "IS", "EE", "LV", "LT"):
        return (29.0, -8.0, "Nordic / Boreal")

    # 2. Temperate Maritime / Western & Central Europe
    # Mild summers (>= 31°C triggers major heat health warnings due to lack of AC);
    # Mild winters (< 0°C is freeze; 8°C - 20°C is ordinary everyday weather)
    if cc in ("GB", "IE", "DE", "NL", "BE", "FR", "PL", "CZ", "AT", "CH", "DK", "NZ", "LU"):
        return (31.0, 0.0, "Temperate Maritime")

    # 3. Tropical / Hot Arid / Equatorial
    # High heat is routine (>= 41°C is intense heatwave);
    # Without central heating, < 13°C feels bitterly cold; 18°C - 35°C is normal
    if cc in ("IN", "PK", "BD", "LK", "NP", "AE", "SA", "QA", "KW", "OM", "BH", "EG", "IQ",
              "SG", "TH", "MY", "PH", "VN", "ID", "NG", "GH", "KE", "BR", "CO"):
        return (41.0, 13.0, "Tropical / Subtropical")

    # 4. Mediterranean / Southern Europe / Subtropical Moderate
    # Hot summers (>= 38°C), mild winters (< 4°C)
    if cc in ("ES", "IT", "GR", "PT", "TR", "IL", "ZA", "AR", "CL"):
        return (38.0, 4.0, "Mediterranean / Mild")

    # 5. Continental / Varied Mixed (US, CN, JP, KR, AU, and fallback default)
    # Extreme heat >= 37°C (~98.6°F); near-freezing chill < 3°C (~37°F)
    return (37.0, 3.0, "Continental / Default")


def analyze_weather(weather_str: Optional[str], country_code: str = "US") -> Dict[str, Any]:
    """
    Parses weather string and evaluates whether conditions are noteworthy or extreme
    based on the user's regional climate thresholds and severe weather phenomena.
    """
    if not weather_str:
        return {
            "is_noteworthy": False,
            "condition": "",
            "temp_c": None,
            "sensation": "none",
            "climate_zone": "Unknown",
            "is_extreme_heat": False,
            "is_extreme_cold": False,
            "is_severe_condition": False,
        }

    condition = weather_str.split(":", 1)[1].strip() if ":" in weather_str else weather_str.strip()
    c_low = condition.lower()

    # 1. Parse temperature (supports °C or °F with conversion to Celsius)
    temp_c: Optional[float] = None
    temp_m = re.search(r'([+-]?\d+(?:\.\d+)?)\s*°?\s*([CFcf])?', condition)
    if temp_m:
        val = float(temp_m.group(1))
        unit = (temp_m.group(2) or "C").upper()
        if unit == "F":
            temp_c = round((val - 32.0) * 5.0 / 9.0, 1)
        else:
            temp_c = round(val, 1)

    # 2. Regional climate thresholds
    heat_thresh, cold_thresh, zone_name = get_climate_thresholds(country_code)

    # 3. Check for severe or dramatic weather phenomena
    # Distinguish severe storms / downpours / snow from mild showers / patchy clouds
    is_severe_condition = any(k in c_low for k in (
        "thunder", "storm", "lightning", "blizzard", "heavy rain", "torrential",
        "downpour", "monsoon", "cyclone", "typhoon", "tornado", "hurricane",
        "hail", "snow", "freezing rain", "sandstorm", "dust storm", "gale"
    )) or any(sym in condition for sym in ("⛈", "🌩", "🌨", "❄", "🌪"))

    # 4. Temperature extremities tailored to country
    is_extreme_heat = (temp_c is not None) and (temp_c >= heat_thresh)
    is_extreme_cold = (temp_c is not None) and (temp_c < cold_thresh)

    is_noteworthy = is_severe_condition or is_extreme_heat or is_extreme_cold

    # 5. Sensation label for dynamic prompting
    if is_extreme_heat:
        sensation = f"sweltering heatwave ({temp_c}°C, unusually hot for {zone_name})"
    elif is_extreme_cold:
        sensation = f"biting cold / freeze ({temp_c}°C, unusually chilly for {zone_name})"
    elif is_severe_condition:
        sensation = "severe weather / stormy conditions"
    else:
        sensation = f"ordinary mild conditions ({temp_c}°C for {zone_name})"

    return {
        "is_noteworthy": is_noteworthy,
        "is_severe_condition": is_severe_condition,
        "is_extreme_heat": is_extreme_heat,
        "is_extreme_cold": is_extreme_cold,
        "temp_c": temp_c,
        "condition": condition,
        "heat_threshold": heat_thresh,
        "cold_threshold": cold_thresh,
        "climate_zone": zone_name,
        "sensation": sensation
    }


# Universal patterns for study materials, exam prep, and test-prep guides
# Domain-agnostic so it works across any field (engineering, medicine, finance, law, tech)
# without hardcoding specific degrees, exams, or industry terms.
_STUDY_MATERIAL_SPAM_PATTERNS = [
    r'\b(?:how\s+to\s+prepare|preparation\s+tips?)\b',
    r'\b(?:exam\s+pattern|syllabus)\b',
    r'\b(?:sample|previous\s+year|model)\s+question\s+papers?\b',
    r'\b(?:answer\s+keys?|cutoff\s+marks?|cut[\s-]?offs?)\b',
    r'\b(?:mock\s+tests?|test\s+series)\b',
    r'^\s*top\s+\d+\b',  # Clickbait listicles like "Top 5...", "Top 10..."
]


def _fetch_rss_titles(url: str, limit: int = 20) -> List[str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=2.5) as r:
            root = ET.fromstring(r.read())
            items = []
            for el in root.findall(".//item")[:limit]:
                t = el.find("title")
                if t is not None and t.text:
                    items.append(html.unescape(t.text.strip()))
            return items
    except Exception as e:
        _safe_log(f"[ContextFeed] RSS fetch failed for {url}: {e}")
        return []


_STOP_WORDS = {"with", "from", "this", "that", "after", "says", "news", "over", "into", "amid", "will", "have", "more"}


def _extract_and_format(raw_title: str) -> Tuple[str, str, set]:
    if " - " in raw_title:
        title_part, pub_part = raw_title.rsplit(" - ", 1)
    else:
        title_part, pub_part = raw_title, ""
    words = set(re.findall(r'\b[a-zA-Z]{4,}\b', title_part.lower())) - _STOP_WORDS
    formatted = f"{title_part.strip()} [Source: {pub_part.strip()}]" if pub_part else title_part.strip()
    return formatted, title_part, words


def _fetch_single_topic_news(topic: str, country_code: str = "US", max_items: int = 4) -> List[str]:
    """Fetches and deduplicates fresh news headlines for a single custom topic."""
    now = time.time()
    topic_clean = (topic or "").strip()
    if not topic_clean:
        return []
    cc = (country_code or "US").strip().upper()
    cache_key = f"topic_{cc}_{topic_clean.lower()}"

    if cache_key in _NEWS_CACHE:
        entry = _NEWS_CACHE[cache_key]
        if now - entry["timestamp"] < NEWS_TTL_SEC:
            return entry["data"]

    clean_q = re.sub(r'[,;]+', ' ', topic_clean).strip()
    has_time_filter = any(w in clean_q.lower() for w in ("when:", "after:", "before:", "year", "2024", "2025", "2026"))
    q_fresh = f"{clean_q} when:14d" if not has_time_filter else clean_q

    q_encoded = urllib.parse.quote(q_fresh)
    url = f"https://news.google.com/rss/search?q={q_encoded}&hl=en&gl={cc}&ceid={cc}:en"

    is_recruitment_query = any(k in topic_clean.lower() for k in (
        'job', 'vacancy', 'vacancies', 'recruit', 'hiring', 'post', 'internship', 'walk-in', 'psu'
    ))

    raw_items = _fetch_rss_titles(url, limit=25)
    # Fallback to broader search if 14-day window had very few items
    if len(raw_items) < 3 and q_fresh != clean_q:
        url_broad = f"https://news.google.com/rss/search?q={urllib.parse.quote(clean_q)}&hl=en&gl={cc}&ceid={cc}:en"
        raw_items = _fetch_rss_titles(url_broad, limit=25)

    headlines: List[str] = []
    seen_title_wordsets: List[set] = []
    for raw in raw_items:
        formatted, title_part, words = _extract_and_format(raw)
        if is_recruitment_query and any(re.search(pat, title_part.lower()) for pat in _STUDY_MATERIAL_SPAM_PATTERNS):
            continue
        if not words:
            continue
        # Pairwise Jaccard overlap check: drop if > 45% overlap with previous headline
        is_dup = False
        for st in seen_title_wordsets:
            inter = len(words & st)
            union = len(words | st)
            if union and (inter / union) > 0.45:
                is_dup = True
                break
        if is_dup:
            continue
        headlines.append(formatted)
        seen_title_wordsets.append(words)
        if len(headlines) >= max_items:
            break

    if headlines:
        _NEWS_CACHE[cache_key] = {"data": headlines, "timestamp": now}
    return headlines


def _fetch_general_news(country_code: str = "US", max_items: int = 4) -> List[str]:
    """Fetches top regional breaking news and technology breakthroughs."""
    now = time.time()
    cc = (country_code or "US").strip().upper()
    cache_key = f"general_{cc}"

    if cache_key in _NEWS_CACHE:
        entry = _NEWS_CACHE[cache_key]
        if now - entry["timestamp"] < NEWS_TTL_SEC:
            return entry["data"]

    main_url = f"https://news.google.com/rss?hl=en&gl={cc}&ceid={cc}:en"
    tech_url = f"https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en&gl={cc}&ceid={cc}:en"

    main_items = _fetch_rss_titles(main_url, limit=15)
    tech_items = _fetch_rss_titles(tech_url, limit=10)

    headlines: List[str] = []
    seen_words: set = set()

    # 1. Add top national/world breaking news (up to 2 items)
    for raw in main_items:
        formatted, _, words = _extract_and_format(raw)
        if len(words & seen_words) >= 2:
            continue
        headlines.append(formatted)
        seen_words.update(words)
        if len(headlines) >= min(2, max_items):
            break

    # 2. Add technology / science breakthroughs (up to 2 items)
    for raw in tech_items:
        formatted, _, words = _extract_and_format(raw)
        if len(words & seen_words) >= 2:
            continue
        headlines.append(formatted)
        seen_words.update(words)
        if len(headlines) >= max_items:
            break

    # Fallback if tech feed was sparse
    if len(headlines) < max_items:
        for raw in main_items:
            formatted, _, words = _extract_and_format(raw)
            if formatted not in headlines:
                headlines.append(formatted)
                if len(headlines) >= max_items:
                    break

    if headlines:
        _NEWS_CACHE[cache_key] = {"data": headlines, "timestamp": now}
    return headlines


def fetch_all_greeting_news(topics: Optional[str] = None, country_code: str = "US") -> Dict[str, Any]:
    """
    Concurrently fetches both custom news topics and general regional/tech news.
    Supports multiple custom topics separated by semicolons (;) or newlines.
    Uses ThreadPoolExecutor for fast parallel execution and individual caching per topic.
    """
    raw_topics = (topics or "").strip()
    topic_list = []
    if raw_topics:
        for part in re.split(r'[;\n]+', raw_topics):
            cleaned = part.strip()
            if cleaned and cleaned not in topic_list:
                topic_list.append(cleaned)
    topic_list = topic_list[:5]  # Cap at 5 topics max

    custom_news: Dict[str, List[str]] = {}
    general_news: List[str] = []

    # Parallel retrieval of all custom topics and general news
    worker_count = max(2, min(6, len(topic_list) + 1))
    with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as executor:
        future_general = executor.submit(_fetch_general_news, country_code, max_items=4)
        topic_futures = {
            executor.submit(_fetch_single_topic_news, t, country_code, max_items=4): t
            for t in topic_list
        }

        try:
            general_news = future_general.result(timeout=4.0)
        except Exception as e:
            _safe_log(f"[ContextFeed] General news thread error: {e}")
            general_news = []

        for fut in concurrent.futures.as_completed(topic_futures, timeout=4.5):
            t_name = topic_futures[fut]
            try:
                t_headlines = fut.result()
                if t_headlines:
                    custom_news[t_name] = t_headlines
            except Exception as e:
                _safe_log(f"[ContextFeed] Topic thread error for '{t_name}': {e}")

    # Build backward-compatible flat headlines list (custom topics first, then general)
    all_headlines: List[str] = []
    for t in topic_list:
        if t in custom_news:
            for item in custom_news[t]:
                if item not in all_headlines:
                    all_headlines.append(item)
    for item in general_news:
        if item not in all_headlines:
            all_headlines.append(item)

    return {
        "custom_news": custom_news,
        "general_news": general_news,
        "all_headlines": all_headlines,
        "topics_searched": topic_list
    }


def get_targeted_news(topics: Optional[str] = None, country_code: str = "US", max_items: int = 5) -> List[str]:
    """Backward compatibility wrapper returning a flat list of headlines."""
    res = fetch_all_greeting_news(topics=topics, country_code=country_code)
    return res.get("all_headlines", [])[:max_items]


def get_startup_context_block(profile: Optional[dict] = None) -> Dict[str, Any]:
    """
    Builds the situational context dictionary (location, weather, custom news, general headlines)
    evaluating user profile settings, toggles, and VPN presence.
    """
    profile = profile or {}
    settings = profile.get("settings", {})

    configured_loc = settings.get("user_location") or getattr(config, "USER_LOCATION", "Auto")
    weather_enabled = bool(settings.get("greeting_weather_enabled", getattr(config, "GREETING_WEATHER_ENABLED", True)))
    news_enabled = bool(settings.get("greeting_news_enabled", getattr(config, "GREETING_NEWS_ENABLED", True)))
    news_topics = str(settings.get("greeting_news_topics", getattr(config, "GREETING_NEWS_TOPICS", "")))

    loc_info = resolve_user_location(configured_loc)
    city = loc_info.get("city", "").strip()
    cc = loc_info.get("country_code", "US")

    # 1. Weather: Only fetched if reliable city/town is available
    weather_str = None
    weather_analysis = None
    if city:
        if weather_enabled:
            weather_str = get_live_weather(city)
            if weather_str:
                _safe_log(f"[ContextFeed] Live weather: {weather_str}")
                weather_analysis = analyze_weather(weather_str, country_code=cc)
                _safe_log(f"[ContextFeed] Weather analyzed ({weather_analysis['climate_zone']}): {weather_analysis['sensation']} (noteworthy={weather_analysis['is_noteworthy']})")
            else:
                _safe_log(f"[ContextFeed] Live weather fetch unavailable for {city}")
    else:
        if weather_enabled:
            _safe_log("[ContextFeed] No reliable city/town available (VPN or auto-detect offline) -> Weather skipped.")

    if not weather_analysis:
        weather_analysis = analyze_weather(None, country_code=cc)

    # 2. News: Parallel fetching for custom topics and general breaking news
    custom_news: Dict[str, List[str]] = {}
    general_news: List[str] = []
    headlines: List[str] = []
    if news_enabled:
        news_bundle = fetch_all_greeting_news(topics=news_topics, country_code=cc)
        custom_news = news_bundle.get("custom_news", {})
        general_news = news_bundle.get("general_news", [])
        headlines = news_bundle.get("all_headlines", [])

        custom_count = sum(len(v) for v in custom_news.values())
        _safe_log(f"[ContextFeed] News ready for region '{cc}': {custom_count} custom headlines ({len(custom_news)} topics), {len(general_news)} general headlines.")

    return {
        "location": loc_info,
        "weather": weather_str,
        "weather_analysis": weather_analysis,
        "headlines": headlines,
        "custom_news": custom_news,
        "general_news": general_news,
        "news_topics": news_topics
    }

