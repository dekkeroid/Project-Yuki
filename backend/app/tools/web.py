import urllib.parse
import urllib.request
import json
import re
import time
import datetime
import html
import xml.etree.ElementTree as ET
import asyncio
import requests
import httpx
from bs4 import BeautifulSoup
from app import config

def get_weather(city: str) -> str:
    """
    Checks the current weather for a given city.
    """
    if not city:
        city = "London"
    
    clean_city = urllib.parse.quote(city.strip())
    # Use wttr.in with formatting (format=3 outputs: "City: condition temperature")
    url = f"https://wttr.in/{clean_city}?format=3"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            weather_text = response.read().decode('utf-8').strip()
            if "page not found" in weather_text.lower() or "404" in weather_text:
                return f"Could not find weather details for '{city}'."
            return weather_text
    except Exception as e:
        return f"Failed to get weather for '{city}': {str(e)}"

# ---------------------------------------------------------------------------
# In-Memory Search Cache (15-Minute TTL)
# ---------------------------------------------------------------------------
_SEARCH_CACHE: dict = {}
_CACHE_TTL_SECONDS = 900  # 15 minutes

AUTHORITY_DOMAINS = (
    "wikipedia.org", "wiktionary.org", "wikiquote.org", "britannica.com",
    "myanimelist.net", "animenewsnetwork.com", "imdb.com", "themoviedb.org", "rottentomatoes.com",
    "reddit.com", "quora.com",
    "developer.mozilla.org", "docs.python.org", "react.dev", "stackoverflow.com", "github.com",
    "testbook.com", "geeksforgeeks.org", "w3schools.com", "tutorialspoint.com", "khanacademy.org", "fandom.com",
    "youtube.com", "youtu.be",
    "cnbc.com", "bloomberg.com", "reuters.com", "marketwatch.com", "tradingeconomics.com", "finance.yahoo.com"
)


# ---------------------------------------------------------------------------
# YouTube Deep Extraction Pipeline
# ---------------------------------------------------------------------------

def is_youtube_url(url: str) -> bool:
    """Check if the provided URL points to YouTube or short youtu.be."""
    if not url or not isinstance(url, str):
        return False
    u_lower = url.lower().strip()
    return "youtube.com" in u_lower or "youtu.be" in u_lower


def parse_youtube_ids(url: str) -> tuple:
    """Extracts (video_id, playlist_id, fetch_url) from various YouTube URL formats."""
    parsed = urllib.parse.urlparse(url)
    qs = urllib.parse.parse_qs(parsed.query)
    video_id = None
    playlist_id = qs.get("list", [None])[0]
    netloc = parsed.netloc.lower()
    path = parsed.path

    if "youtu.be" in netloc:
        video_id = path.lstrip("/").split("?")[0].split("&")[0]
    elif "/shorts/" in path:
        video_id = path.split("/shorts/")[1].split("/")[0].split("?")[0]
    elif "/embed/" in path:
        video_id = path.split("/embed/")[1].split("/")[0].split("?")[0]
    elif "/watch" in path:
        video_id = qs.get("v", [None])[0]

    if video_id:
        fetch_url = f"https://www.youtube.com/watch?v={video_id}"
    elif playlist_id:
        fetch_url = f"https://www.youtube.com/playlist?list={playlist_id}"
    else:
        fetch_url = url

    return video_id, playlist_id, fetch_url


def fetch_youtube_transcript(video_id: str, max_chars: int = 4000) -> str:
    """
    Extracts timestamped speech transcripts from YouTube closed captions / automatic ASR.
    Groups sentences into clean 30-45 second timestamp intervals.
    """
    if not video_id:
        return ""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        api = YouTubeTranscriptApi()
        snippets = None

        # 1. Try finding English or preferred language transcript from list
        try:
            t_list = api.list(video_id)
            target_t = None
            try:
                target_t = t_list.find_transcript(['en', 'en-US', 'en-GB', 'en-CA'])
            except Exception:
                target_t = next(iter(t_list))

            if target_t:
                snippets = target_t.fetch()
        except Exception:
            pass

        # 2. Fallback to direct fetch
        if not snippets:
            try:
                snippets = api.fetch(video_id)
            except Exception:
                pass

        if not snippets:
            return ""

        # Format into clean, aggregated timestamped bullets
        lines = []
        current_block = []
        block_start = 0
        current_block_words = 0

        for item in snippets:
            text = getattr(item, "text", "") if hasattr(item, "text") else item.get("text", "")
            text = text.replace("\n", " ").strip()
            if not text or (text.startswith("[") and text.endswith("]")):
                continue

            start_sec = getattr(item, "start", 0) if hasattr(item, "start") else item.get("start", 0)
            if not current_block:
                block_start = int(start_sec)

            current_block.append(text)
            current_block_words += len(text.split())

            # Group every ~35 words or sentence boundary for clean readability
            if current_block_words >= 35 or text.endswith((".", "!", "?")):
                mins, secs = divmod(block_start, 60)
                hrs, mins = divmod(mins, 60)
                time_str = f"{hrs:02d}:{mins:02d}:{secs:02d}" if hrs else f"{mins:02d}:{secs:02d}"
                lines.append(f"- `[{time_str}]` {' '.join(current_block)}")
                current_block = []
                current_block_words = 0

        if current_block:
            mins, secs = divmod(block_start, 60)
            hrs, mins = divmod(mins, 60)
            time_str = f"{hrs:02d}:{mins:02d}:{secs:02d}" if hrs else f"{mins:02d}:{secs:02d}"
            lines.append(f"- `[{time_str}]` {' '.join(current_block)}")

        md = "\n".join(lines).strip()
        if len(md) > max_chars:
            md = md[:max_chars].strip() + "\n... [Transcript truncated to fit search budget. Call 'jarvis_web_scrape' on this YouTube URL to extract the full transcript]"
        return md
    except Exception:
        return ""


def format_youtube_markdown(title: str, channel: str, channel_url: str, duration: str,
                            views: str, publish_date: str, keywords: list,
                            playlist_title: str, playlist_items: list,
                            description: str, transcript: str = "",
                            max_chars: int = 5000) -> str:
    if not title and not description and not playlist_items and not transcript:
        return ""

    doc_lines = []
    heading = title if title else "YouTube Content"
    doc_lines.append(f"# YouTube: {heading}")
    if channel:
        ch_str = f"**Channel:** [{channel}]({channel_url})" if channel_url else f"**Channel:** {channel}"
        doc_lines.append(ch_str)

    meta_badges = []
    if duration:
        meta_badges.append(f"**Duration:** {duration}")
    if views:
        meta_badges.append(f"**Views:** {views}")
    if publish_date:
        meta_badges.append(f"**Published:** {publish_date}")
    if meta_badges:
        doc_lines.append(" • ".join(meta_badges))

    if keywords:
        doc_lines.append("**Tags:** " + ", ".join(keywords[:10]))

    if playlist_title or playlist_items:
        pl_head = f"## Playlist / Tracklist: {playlist_title}" if playlist_title else "## Playlist Tracks"
        doc_lines.append(f"\n{pl_head}")
        doc_lines.extend(playlist_items)

    if transcript:
        doc_lines.append("\n## Spoken Transcript & Timestamps\n" + transcript)

    if description:
        doc_lines.append("\n## Description\n" + description)

    md = "\n\n".join(doc_lines).strip()
    if len(md) > max_chars:
        md = md[:max_chars].strip() + "\n\n... [Content truncated to fit search budget. Call 'jarvis_web_scrape' on this URL to read up to 15,000+ characters if this page looks promising]"
    return md


def extract_youtube_content(url: str, max_chars: int = 5000) -> str:
    """
    Synchronously extracts rich metadata, tracklists, transcripts, and description from any YouTube URL
    using YouTube's official oEmbed API, player metadata, and closed captions.
    """
    if not is_youtube_url(url):
        return ""

    video_id, playlist_id, fetch_url = parse_youtube_ids(url)

    # Layer 1: Official YouTube oEmbed API
    oembed_data = {}
    try:
        oe_url = f"https://www.youtube.com/oembed?url={urllib.parse.quote(url)}&format=json"
        oe_resp = requests.get(oe_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=5.0)
        if oe_resp.status_code == 200:
            oembed_data = oe_resp.json()
    except Exception:
        pass

    title = oembed_data.get("title", "")
    channel = oembed_data.get("author_name", "")
    channel_url = oembed_data.get("author_url", "")

    views = ""
    duration = ""
    description = ""
    keywords = []
    publish_date = ""
    playlist_title = ""
    playlist_items = []
    transcript = ""

    # Layer 2: Extract Spoken Transcript if video_id is present
    if video_id:
        transcript_budget = min(max_chars, 4000)
        transcript = fetch_youtube_transcript(video_id, max_chars=transcript_budget)

    # Layer 3: Direct Page Fetch & Deep Scraping
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        resp = requests.get(fetch_url, headers=headers, timeout=8.0)
        if resp.status_code == 200:
            html = resp.text

            # 3a. Player response (video details)
            m_player = re.search(r"ytInitialPlayerResponse\s*=\s*({.+?});", html)
            if m_player:
                try:
                    p_data = json.loads(m_player.group(1))
                    v_det = p_data.get("videoDetails", {})
                    title = title or v_det.get("title", "")
                    channel = channel or v_det.get("author", "")
                    description = description or v_det.get("shortDescription", "")
                    publish_date = p_data.get("microformat", {}).get("playerMicroformatRenderer", {}).get("publishDate", "")

                    sec = int(v_det.get("lengthSeconds", "0") or "0")
                    if sec > 0:
                        m, s = divmod(sec, 60)
                        h, m = divmod(m, 60)
                        duration = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

                    vc = v_det.get("viewCount")
                    if vc:
                        try:
                            views = f"{int(vc):,} views"
                        except Exception:
                            views = f"{vc} views"
                    keywords = v_det.get("keywords", []) or []
                except Exception:
                    pass

            # 3b. Initial data (playlist/mix tracks)
            m_init = re.search(r"ytInitialData\s*=\s*({.+?});", html)
            if m_init:
                try:
                    i_data = json.loads(m_init.group(1))
                    pl_obj = i_data.get("contents", {}).get("twoColumnWatchNextResults", {}).get("playlist", {}).get("playlist", {})
                    if pl_obj:
                        playlist_title = pl_obj.get("title", "")
                        for item in pl_obj.get("contents", [])[:15]:
                            r = item.get("playlistPanelVideoRenderer", {})
                            if r:
                                t = r.get("title", {}).get("simpleText", "") or "".join(s.get("text", "") for s in r.get("title", {}).get("runs", []))
                                a = r.get("shortBylineText", {}).get("runs", [{}])[0].get("text", "")
                                d = r.get("lengthText", {}).get("simpleText", "")
                                vid = r.get("videoId", "")
                                if t:
                                    tag = f"- **{t}**" + (f" by {a}" if a else "") + (f" `[{d}]`" if d else "") + (f" (https://youtu.be/{vid})" if vid else "")
                                    playlist_items.append(tag)

                    if not playlist_items:
                        tabs = i_data.get("contents", {}).get("twoColumnBrowseResultsRenderer", {}).get("tabs", [])
                        for tab in tabs:
                            sections = tab.get("tabRenderer", {}).get("content", {}).get("sectionListRenderer", {}).get("contents", [])
                            for sec in sections:
                                items = sec.get("itemSectionRenderer", {}).get("contents", [])
                                for it in items:
                                    vids = it.get("playlistVideoListRenderer", {}).get("contents", [])
                                    for v in vids[:20]:
                                        r = v.get("playlistVideoRenderer", {})
                                        if r:
                                            t = r.get("title", {}).get("simpleText", "") or "".join(s.get("text", "") for s in r.get("title", {}).get("runs", []))
                                            a = r.get("shortBylineText", {}).get("runs", [{}])[0].get("text", "")
                                            d = r.get("lengthText", {}).get("simpleText", "")
                                            vid = r.get("videoId", "")
                                            if t:
                                                playlist_items.append(f"- **{t}**" + (f" by {a}" if a else "") + (f" `[{d}]`" if d else "") + (f" (https://youtu.be/{vid})" if vid else ""))
                except Exception:
                    pass

            # 3c. Fallback OpenGraph / meta tags
            if not title:
                m_og_t = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']', html)
                if m_og_t:
                    title = m_og_t.group(1)
            if not description:
                m_og_d = re.search(r'<meta\s+property=["\']og:description["\']\s+content=["\']([^"\']+)["\']', html)
                if m_og_d:
                    description = m_og_d.group(1)
            if not channel:
                m_ch = re.search(r'<link\s+itemprop=["\']name["\']\s+content=["\']([^"\']+)["\']', html)
                if m_ch:
                    channel = m_ch.group(1)
    except Exception:
        pass

    return format_youtube_markdown(title, channel, channel_url, duration, views,
                                   publish_date, keywords, playlist_title,
                                   playlist_items, description, transcript=transcript,
                                   max_chars=max_chars)

async def async_extract_youtube_content(client: httpx.AsyncClient, url: str, max_chars: int = 5000, need_transcript: bool = False) -> str:
    """
    Asynchronously extracts rich metadata, tracklists, transcripts, and description from any YouTube URL
    using concurrent parallel fetches for oEmbed, HTML details, and optional speech transcripts.
    """
    if not is_youtube_url(url):
        return ""

    video_id, playlist_id, fetch_url = parse_youtube_ids(url)

    # Layer 1: Official YouTube oEmbed API (fast ~200-400ms)
    async def fetch_oe():
        try:
            oe_url = f"https://www.youtube.com/oembed?url={urllib.parse.quote(url)}&format=json"
            oe_resp = await client.get(oe_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=2.5)
            if oe_resp.status_code == 200:
                return oe_resp.json()
        except Exception:
            pass
        return {}

    # Layer 2: Optional Spoken Transcript (only if explicitly needed; strictly bounded to 2.0s timeout)
    async def fetch_tr():
        if not video_id or not need_transcript:
            return ""
        transcript_budget = min(max_chars, 4000)
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(fetch_youtube_transcript, video_id, max_chars=transcript_budget),
                timeout=2.0
            )
        except Exception:
            return ""

    # Layer 3: Direct Page Fetch for rich playlist & video details (fast 2.5s timeout)
    async def fetch_html():
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        }
        try:
            resp = await client.get(fetch_url, headers=headers, timeout=2.5)
            if resp.status_code == 200:
                return resp.text
        except Exception:
            pass
        return ""

    # Run oEmbed, HTML, and optional transcript concurrently in parallel
    oembed_data, transcript, html = await asyncio.gather(fetch_oe(), fetch_tr(), fetch_html())

    title = oembed_data.get("title", "")
    channel = oembed_data.get("author_name", "")
    channel_url = oembed_data.get("author_url", "")

    views = ""
    duration = ""
    description = ""
    keywords = []
    publish_date = ""
    playlist_title = ""
    playlist_items = []

    if html:
        # 3a. Player response (video details)
        m_player = re.search(r"ytInitialPlayerResponse\s*=\s*({.+?});", html)
        if m_player:
            try:
                p_data = json.loads(m_player.group(1))
                v_det = p_data.get("videoDetails", {})
                title = title or v_det.get("title", "")
                channel = channel or v_det.get("author", "")
                description = description or v_det.get("shortDescription", "")
                publish_date = p_data.get("microformat", {}).get("playerMicroformatRenderer", {}).get("publishDate", "")

                sec = int(v_det.get("lengthSeconds", "0") or "0")
                if sec > 0:
                    m, s = divmod(sec, 60)
                    h, m = divmod(m, 60)
                    duration = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"

                vc = v_det.get("viewCount")
                if vc:
                    try:
                        views = f"{int(vc):,} views"
                    except Exception:
                        views = f"{vc} views"
                keywords = v_det.get("keywords", []) or []
            except Exception:
                pass

        # 3b. Initial data (playlist/mix tracks)
        m_init = re.search(r"ytInitialData\s*=\s*({.+?});", html)
        if m_init:
            try:
                i_data = json.loads(m_init.group(1))
                pl_obj = i_data.get("contents", {}).get("twoColumnWatchNextResults", {}).get("playlist", {}).get("playlist", {})
                if pl_obj:
                    playlist_title = pl_obj.get("title", "")
                    for item in pl_obj.get("contents", [])[:15]:
                        r = item.get("playlistPanelVideoRenderer", {})
                        if r:
                            t = r.get("title", {}).get("simpleText", "") or "".join(s.get("text", "") for s in r.get("title", {}).get("runs", []))
                            a = r.get("shortBylineText", {}).get("runs", [{}])[0].get("text", "")
                            d = r.get("lengthText", {}).get("simpleText", "")
                            vid = r.get("videoId", "")
                            if t:
                                tag = f"- **{t}**" + (f" by {a}" if a else "") + (f" `[{d}]`" if d else "") + (f" (https://youtu.be/{vid})" if vid else "")
                                playlist_items.append(tag)

                if not playlist_items:
                    tabs = i_data.get("contents", {}).get("twoColumnBrowseResultsRenderer", {}).get("tabs", [])
                    for tab in tabs:
                        sections = tab.get("tabRenderer", {}).get("content", {}).get("sectionListRenderer", {}).get("contents", [])
                        for sec in sections:
                            items = sec.get("itemSectionRenderer", {}).get("contents", [])
                            for it in items:
                                vids = it.get("playlistVideoListRenderer", {}).get("contents", [])
                                for v in vids[:20]:
                                    r = v.get("playlistVideoRenderer", {})
                                    if r:
                                        t = r.get("title", {}).get("simpleText", "") or "".join(s.get("text", "") for s in r.get("title", {}).get("runs", []))
                                        a = r.get("shortBylineText", {}).get("runs", [{}])[0].get("text", "")
                                        d = r.get("lengthText", {}).get("simpleText", "")
                                        vid = r.get("videoId", "")
                                        if t:
                                            playlist_items.append(f"- **{t}**" + (f" by {a}" if a else "") + (f" `[{d}]`" if d else "") + (f" (https://youtu.be/{vid})" if vid else ""))
            except Exception:
                pass

        # 3c. Fallback OpenGraph / meta tags
        if not title:
            m_og_t = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']', html)
            if m_og_t:
                title = m_og_t.group(1)
        if not description:
            m_og_d = re.search(r'<meta\s+property=["\']og:description["\']\s+content=["\']([^"\']+)["\']', html)
            if m_og_d:
                description = m_og_d.group(1)
        if not channel:
            m_ch = re.search(r'<link\s+itemprop=["\']name["\']\s+content=["\']([^"\']+)["\']', html)
            if m_ch:
                channel = m_ch.group(1)

    return format_youtube_markdown(title, channel, channel_url, duration, views,
                                   publish_date, keywords, playlist_title,
                                   playlist_items, description, transcript=transcript,
                                   max_chars=max_chars)



def prune_crew_sections(text: str) -> str:
    """Strip massive backstage crew lists from credits pages to preserve cast & director info."""
    match = re.search(r'(?im)^(?:\*|\-)?\s*(?:#+\s*)?(?:Makeup Department|Art Department|Camera and Electrical|Visual Effects|Sound Department|Transportation Department|Special Effects|Stunts|Second Unit Directors)\b', text)
    if match and match.start() > 300:
        return text[:match.start()].strip()
    return text


def anchor_by_query(text: str, query: str) -> str:
    """If user asks for a specific section (e.g. cast/characters/voice/episodes), jump straight to that heading."""
    if not query:
        return text
    q_lower = query.lower()
    subtopic_patterns = []
    if any(k in q_lower for k in ("cast", "character", "voice", "actor", "seiyuu", "va")):
        # Prioritize specific sub-headings like '### Cast' or '## Main characters' before generic 'Full cast & crew'
        subtopic_patterns.append(r'(?im)^#{2,4}\s+(?:\[)?(Main characters|Characters & Voice Actors|Voice Cast|Series Cast|Cast|Characters)\b')
        subtopic_patterns.append(r'(?im)^#{1,4}\s+(?:\[)?(Cast\s*&?\s*crew|Full cast)\b')
    elif any(k in q_lower for k in ("episode", "season", "chapter")):
        subtopic_patterns.append(r'(?im)^#{1,4}\s+(?:\[)?(Episodes|Episode list|Season \d+|Chapters)\b')
    elif any(k in q_lower for k in ("plot", "synopsis", "story")):
        subtopic_patterns.append(r'(?im)^#{1,4}\s+(?:\[)?(Plot|Synopsis|Storyline|Overview)\b')

    for pat in subtopic_patterns:
        m = re.search(pat, text)
        if m and 0 < m.start() < 16000:
            return text[m.start():].strip()
    return text


def _extract_image_candidate(img_tag, page_url: str = "") -> Optional[tuple[str, str]]:
    """
    Extracts a clean, valid (caption, absolute_url) from an <img> or <picture> tag.
    Returns None if the image is an icon, tracking pixel, base64 data URI, ad, or avatar.
    """
    if not img_tag or not hasattr(img_tag, "get"):
        return None

    # 1. Resolve candidate URL from lazy-load / srcset / src attributes
    raw_src = (
        img_tag.get("data-src") or
        img_tag.get("data-original") or
        img_tag.get("data-lazy-src") or
        img_tag.get("data-highres") or
        img_tag.get("data-full-url") or
        img_tag.get("src") or
        ""
    ).strip()

    # If srcset is provided and no direct src, parse the highest resolution candidate
    if not raw_src and img_tag.get("srcset"):
        srcset = img_tag.get("srcset", "").strip()
        candidates = [c.strip().split()[0] for c in srcset.split(",") if c.strip()]
        if candidates:
            raw_src = candidates[-1]

    if not raw_src:
        return None

    # 2. Reject Base64, blob, file, javascript schemes
    raw_lower = raw_src.lower()
    if raw_lower.startswith(("data:", "blob:", "javascript:", "file:", "about:")):
        return None

    # 3. Resolve relative URLs to absolute HTTP/HTTPS
    if page_url:
        full_url = urllib.parse.urljoin(page_url, raw_src)
    else:
        full_url = raw_src

    if not full_url.startswith(("http://", "https://")):
        return None

    url_lower = full_url.lower()

    # 4. Check dimension attributes if explicitly present (filter tiny icons/pixels)
    try:
        w_val = img_tag.get("width")
        h_val = img_tag.get("height")
        w = int(re.sub(r'\D', '', str(w_val))) if w_val else None
        h = int(re.sub(r'\D', '', str(h_val))) if h_val else None
        if (w is not None and w < 80) or (h is not None and h < 80):
            return None
    except Exception:
        pass

    # 5. Blacklist filter: icons, avatars, tracking pixels, badges, logos, ad banners
    img_class = " ".join(img_tag.get("class", [])) if isinstance(img_tag.get("class"), list) else str(img_tag.get("class", ""))
    img_id = str(img_tag.get("id", ""))
    img_alt = str(img_tag.get("alt", "")).strip()
    img_title = str(img_tag.get("title", "")).strip()

    junk_img_pattern = re.compile(
        r"\b(icon|logo|avatar|gravatar|user|author|pixel|spacer|tracker|tracking|spinner|badge|banner|emoji|button|social|share|advert|ad-|placeholder|1x1|thumb-tiny)\b",
        re.I
    )
    if junk_img_pattern.search(url_lower) or junk_img_pattern.search(img_class) or junk_img_pattern.search(img_id):
        # Allow if alt specifically describes real content (>15 chars) and URL is from a known good CDN
        if not (len(img_alt) > 15 and any(cdn in url_lower for cdn in ("unsplash.com", "wikimedia.org", "wikipedia.org", "wp-content/uploads", "media", "images", "cdn"))):
            return None

    # 6. Extract Caption
    caption = ""
    parent = img_tag.parent
    if parent and parent.name == "figure":
        figcaption = parent.find("figcaption")
        if figcaption:
            caption = figcaption.get_text(separator=" ", strip=True)

    if not caption:
        caption = img_alt or img_title or ""

    # Clean caption: remove brackets, extra whitespace, "image of", etc.
    caption = re.sub(r'[\[\]\r\n\t]+', ' ', caption).strip()
    if caption.lower().startswith("image of ") or caption.lower().startswith("photo of "):
        caption = caption[9:].strip()

    if not caption:
        caption = "Image"

    return (caption, full_url)


def extract_clean_markdown(raw_html: str, max_chars: int = 5000, domain: str = "", query: str = "", page_url: str = "") -> str:
    """
    Extracts clean, lossless Markdown from HTML content.
    - Strips unwanted tags, interactive forms, metadata boxes, cookie banners, popups, and ad sidebars.
    - Preserves high-value content images with resolved absolute URLs and clean captions.
    - Applies domain-specific pre-cleaners for Reddit, Quora, Wikipedia, IMDb, etc.
    - Targets core content containers (<article>, <main>, .post-content, etc.).
    - Converts headings, bullet lists, code blocks, and tables to structured Markdown.
    - Scrubs bracketed superscript citations ([1], [citation needed]).
    - Anchors to requested sections (cast/characters/episodes) and prunes backstage crew.
    - Preserves sentence/paragraph boundaries when applying character budgets.
    """
    if not raw_html or not isinstance(raw_html, str):
        return ""

    try:
        from bs4 import BeautifulSoup, NavigableString, Tag
        soup = BeautifulSoup(raw_html, "html.parser")
    except Exception:
        return raw_html[:max_chars]

    # 1. Strip unwanted and interactive tags completely (keeping img/figure/picture for content extraction)
    junk_tags = [
        "script", "style", "header", "footer", "nav", "aside", "noscript", 
        "svg", "form", "button", "select", "option", "input", "textarea", "label",
        "fieldset", "legend", "datalist", "optgroup", "iframe", "canvas", "meta", 
        "link", "dialog", "template", "source", "audio", "video"
    ]
    for tag in soup(junk_tags):
        tag.decompose()

    # 2. Domain-Specific Custom Pre-Cleaning
    d_lower = domain.lower() if domain else ""
    
    if "reddit.com" in d_lower:
        for el in soup.find_all(class_=re.compile(r"\b(promoted|promotedlink|subreddit-header|award|karma|shreddit-async-loader)\b", re.I)):
            el.decompose()
            
    elif "quora.com" in d_lower:
        for el in soup.find_all(class_=re.compile(r"\b(modal|signup|open_in_app|related_questions|promoted)\b", re.I)):
            el.decompose()
            
    elif "wikipedia.org" in d_lower:
        for el in soup.find_all(["sup", "span", "div"], class_=re.compile(r"\b(reference|hatnote|mw-editsection|reflist|ambox|navbox|catlinks|metadata)\b", re.I)):
            el.decompose()

    # 3. Strip general web boilerplate elements
    for el in soup.find_all(class_=re.compile(r"\b(ambox|navbox|mw-jump-link|mw-editsection|reflist|catlinks|metadata|infobox|sistersitebox|toc|sidebar|sidebar-wrapper|borderClass|leftside|anime-detail-header-stats|cookie-banner|cookie-consent|advertisement|newsletter|social-share|menu|top-menu|navbar|site-nav)\b", re.I)):
        if el.name not in ("body", "html", "main", "article"):
            el.decompose()

    boilerplate_pattern = re.compile(
        r"\b(cookie|consent|banner|modal|popup|sidebar|sidebar-wrapper|leftside|newsletter|subscribe|author-bio|ad-|advertisement|social-share|share-buttons|disclaimer|breadcrumbs|nav-menu|menu-wrapper|menu|navbar|site-nav|related-posts|related-articles|related-content|recommendations?|recommended|promo-box|latest-news|comments?|reviews?|user-ratings?|poll|voting|footer-widget|site-footer|trending|copyright|privacy-policy|copy-btn|copy-box|copy-button|btn|button-wrapper|action-bar|toolbar|interactive-box|drafter)\b",
        re.I
    )
    for el in soup.find_all(attrs={"class": boilerplate_pattern}):
        if el.name not in ("body", "html", "main", "article"):
            el.decompose()

    for el in soup.find_all(attrs={"id": boilerplate_pattern}):
        if el.name not in ("body", "html", "main", "article"):
            el.decompose()

    # 4. Decompose off-topic trailing sections safely
    offtopic_pattern = re.compile(
        r"(?i)^(you might also like|latest news|related (posts|articles|news|anime|shows|topics|content)|comments|user comments|leave a reply|discussion|popular now|trending|recent posts|recommended for you|trending this week|check out more)$"
    )
    for h in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
        h_text = h.get_text(strip=True)
        if len(h_text) < 40 and offtopic_pattern.match(h_text):
            parent = h.parent
            if parent and parent.name in ("aside", "nav") and parent.name not in ("body", "html", "main", "article"):
                parent.decompose()
            elif parent and any(k in str(parent.get("class", "")).lower() for k in ("sidebar", "widget", "comment", "related", "footer")):
                parent.decompose()
            else:
                curr = h
                while curr:
                    nxt = curr.next_sibling
                    curr.decompose()
                    curr = nxt

    # 5. Locate Core Content Container
    target_container = None
    body_len = len(soup.body.get_text(strip=True)) if soup.body else 0
    content_selectors = [
        "article",
        "main",
        "[role='main']",
        ".mw-parser-output",
        "#main-content",
        "#content",
        ".main-content",
        ".post-content",
        ".article-body",
        ".entry-content",
        ".markdown-body",
        ".story-body",
        "#bodyContent",
        "#main_content"
    ]
    for sel in content_selectors:
        found = soup.select_one(sel)
        if found:
            text_len = len(found.get_text(strip=True))
            if text_len > 300 and (body_len == 0 or text_len >= body_len * 0.35):
                target_container = found
                break

    root = target_container if target_container else (soup.body if soup.body else soup)

    # 6. Clean conversion to Markdown blocks
    lines = []
    seen_image_urls = set()
    extracted_images = []
    max_content_images = 5
    
    def process_node(node):
        if isinstance(node, NavigableString):
            text = str(node).strip()
            if text:
                lines.append(text + " ")
            return

        if not isinstance(node, Tag):
            return

        tag_name = node.name.lower()

        # Handle Content Images and Figures
        if tag_name in ("img", "figure", "picture"):
            if len(extracted_images) < max_content_images:
                target_img = node if tag_name == "img" else node.find("img")
                if target_img:
                    candidate = _extract_image_candidate(target_img, page_url)
                    if candidate:
                        caption, img_url = candidate
                        if img_url not in seen_image_urls:
                            seen_image_urls.add(img_url)
                            extracted_images.append(candidate)
                            lines.append(f"\n\n![{caption}]({img_url})\n\n")
            return

        if tag_name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag_name[1])
            htext = node.get_text(separator=" ", strip=True)
            if htext:
                lines.append(f"\n\n{'#' * level} {htext}\n\n")
            return

        if tag_name == "li":
            litext = node.get_text(separator=" ", strip=True)
            if litext:
                lines.append(f"\n- {litext}\n")
            return

        if tag_name == "pre":
            code = node.get_text(strip=True)
            if code:
                lines.append(f"\n```\n{code}\n```\n")
            return

        if tag_name == "tr":
            cells = [c.get_text(separator=" ", strip=True) for c in node.find_all(["td", "th"])]
            if any(cells):
                lines.append("\n| " + " | ".join(cells) + " |\n")
            return

        if tag_name in ("p", "blockquote"):
            ptext = node.get_text(separator=" ", strip=True)
            if ptext:
                if tag_name == "blockquote":
                    lines.append(f"\n> {ptext}\n\n")
                else:
                    lines.append(f"\n{ptext}\n\n")
            return

        for child in node.children:
            process_node(child)

    process_node(root)

    # 7. Clean, format & normalize markdown text
    raw_doc = "".join(lines)
    raw_doc = raw_doc.replace("&quot;", '"').replace("&amp;", "&").replace("&apos;", "'").replace("&#x27;", "'").replace("&#x2F;", "/").replace("&nbsp;", " ")
    
    # Global Citation Scrubbing: Strip [1], [2], [citation needed], [edit]
    raw_doc = re.sub(r'\[(?:\d+|citation needed|edit|note \d+)\]', '', raw_doc, flags=re.IGNORECASE)

    # Prune backstage crew if present
    raw_doc = prune_crew_sections(raw_doc)

    # Query-aware section anchor jump
    if query:
        raw_doc = anchor_by_query(raw_doc, query)

    cleaned_lines = []
    for l in raw_doc.splitlines():
        cl = re.sub(r'[ \t]+', ' ', l).strip()
        if cl:
            cleaned_lines.append(cl)

    markdown_doc = "\n".join(cleaned_lines)
    markdown_doc = re.sub(r'\n{3,}', '\n\n', markdown_doc).strip()

    # 8. Apply Mode Budget at sentence/paragraph boundary
    if len(markdown_doc) > max_chars:
        cutoff = max_chars
        last_para = markdown_doc.rfind("\n", 0, max_chars)
        last_sentence = max(markdown_doc.rfind(". ", 0, max_chars), markdown_doc.rfind("! ", 0, max_chars), markdown_doc.rfind("? ", 0, max_chars))
        
        if last_para > max_chars * 0.7:
            cutoff = last_para
        elif last_sentence > max_chars * 0.7:
            cutoff = last_sentence + 1

        markdown_doc = markdown_doc[:cutoff].strip() + f"\n\n... [Content truncated at {cutoff} characters. Call 'jarvis_web_scrape' on this URL to read up to 15,000+ characters if this page looks promising]"

    return markdown_doc


def clean_html(html_content: str, page_url: str = "") -> str:
    """
    Backwards-compatible wrapper that converts raw HTML to clean text/markdown.
    """
    return extract_clean_markdown(html_content, max_chars=5000, page_url=page_url)


async def web_search(
    query,
    search_mode: str = "text_and_snippet",
    country_code: Optional[str] = None,
    **kwargs
) -> str:
    """
    Performs an async web search supporting three specialized modes:
    - search_mode="text_and_snippet" (Default): Organic web search returning 8 snippets + automatically deep-scraping top pages.
    - search_mode="news": Real-time news search (Google News RSS with Bing News fallback) with exact timestamps, sources, snippets, and deep article scrape.
    - search_mode="image": Visual search retrieving direct high-resolution image URLs with dimensions, titles, and sources.
    - Checks 15-minute in-memory cache for instant zero-latency responses.
    """
    # Normalize mode (with internal fallback for legacy image_search argument)
    mode_raw = (search_mode or kwargs.get("mode") or "text_and_snippet").strip().lower()
    if kwargs.get("image_search") is True or mode_raw in ("image", "images", "img", "photo", "photos"):
        effective_mode = "image"
    elif mode_raw in ("news", "breaking", "headlines"):
        effective_mode = "news"
    else:
        effective_mode = "text_and_snippet"

    # Normalize query input (handles str, list, tuple, dict, compound pipe strings)
    raw_list = []
    if isinstance(query, (list, tuple)):
        raw_list = [str(q).strip() for q in query if str(q).strip()]
    elif isinstance(query, dict):
        raw_list = [str(v).strip() for v in query.values() if str(v).strip()]
    elif isinstance(query, str):
        raw_list = [query.strip()] if query.strip() else []
    elif query:
        raw_list = [str(query).strip()]

    query_list = []
    for item in raw_list:
        # Auto-split compound query strings separated by pipes: e.g. "query 1 | query 2"
        if " | " in item or " || " in item:
            sub_queries = re.split(r'\s*\|{1,2}\s*', item)
            for sq in sub_queries:
                sq_clean = re.sub(r'["""]+', '"', sq.strip()).strip()
                if sq_clean and sq_clean not in query_list:
                    query_list.append(sq_clean)
        else:
            sq_clean = re.sub(r'["""]+', '"', item.strip()).strip()
            if sq_clean and sq_clean not in query_list:
                query_list.append(sq_clean)

    if not query_list:
        return "Please specify a query to search for."

    cache_key = f"{' | '.join(sorted(q.lower() for q in query_list))} [mode={effective_mode}]"
    now = time.time()
    
    # Check In-Memory Cache
    if cache_key in _SEARCH_CACHE:
        cached_time, cached_result = _SEARCH_CACHE[cache_key]
        if now - cached_time < _CACHE_TTL_SECONDS:
            return cached_result

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://html.duckduckgo.com/',
        'Origin': 'https://html.duckduckgo.com',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
    }

    def decode_bing_url(bing_url: str) -> str:
        if "bing.com/ck/a" in bing_url and "&u=" in bing_url:
            import base64
            try:
                parsed = urllib.parse.urlparse(bing_url)
                qs = urllib.parse.parse_qs(parsed.query)
                u_val = qs.get("u", [""])[0]
                if u_val.startswith("a1"):
                    b64_str = u_val[2:]
                    b64_str += "=" * ((4 - len(b64_str) % 4) % 4)
                    return base64.urlsafe_b64decode(b64_str).decode("utf-8")
            except Exception:
                pass
        return bing_url

    async def search_single_query(client: httpx.AsyncClient, q: str):
        # Prepare both verbatim query (for DDG quotes/boolean) and cleaned query (for Bing to avoid quote-spam bug)
        q_clean = re.sub(r'[\'"]', ' ', q)
        q_clean = re.sub(r'\s+', ' ', q_clean).strip()
        encoded_query_clean = urllib.parse.quote_plus(q_clean)

        # 1. Primary Engine: DuckDuckGo (Dual-Layer: Direct HTML + TLS-fingerprinted ddgs)
        async def fetch_ddg():
            ddg_urls, ddg_snips = [], []
            ddg_post_query = q_clean if (q.startswith(('"', "'")) and q.endswith(('"', "'"))) or " | " in q else q

            # Layer A: Direct HTML POST with modern browser headers and SafeSearch off (kp=-1, p=-1)
            try:
                resp = await client.post("https://html.duckduckgo.com/html/", data={"q": ddg_post_query, "b": "", "kp": "-1", "p": "-1"}, headers=headers, timeout=4.0)
                if resp.status_code == 200 and "captcha" not in resp.text.lower() and "anomaly" not in resp.text.lower():
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for result in soup.find_all(class_="result")[:12]:
                        link_el = result.find("a", class_="result__a")
                        desc_el = result.find(class_="result__snippet")
                        if link_el and desc_el:
                            title = link_el.get_text(strip=True)
                            href = link_el.get("href", "")
                            desc = desc_el.get_text(strip=True)

                            parsed = urllib.parse.urlparse(href)
                            qs = urllib.parse.parse_qs(parsed.query)
                            actual_url = qs.get("uddg", [None])[0] or href
                            if actual_url.startswith("http") and "duckduckgo.com" not in actual_url and actual_url not in ddg_urls:
                                ddg_urls.append(actual_url)
                                ddg_snips.append((title, desc, actual_url))
            except Exception as e:
                import sys
                print(f"[web_search] Direct DDG HTML attempt failed for '{q}': {e}", file=sys.stderr)

            # Layer B: ddgs fallback using primp TLS fingerprint impersonation
            if not ddg_urls:
                try:
                    def _do_ddgs():
                        try:
                            from ddgs import DDGS
                        except ImportError:
                            from duckduckgo_search import DDGS
                        with DDGS(timeout=4) as ddgs_client:
                            return list(ddgs_client.text(q_clean, safesearch="off", max_results=10))

                    results = await asyncio.to_thread(_do_ddgs)
                    for r in results:
                        u = r.get("href") or r.get("link")
                        t = r.get("title", "")
                        b = r.get("body") or r.get("snippet", "")
                        if u and u.startswith("http") and u not in ddg_urls:
                            ddg_urls.append(u)
                            ddg_snips.append((t, b, u))
                except Exception as e:
                    import sys
                    print(f"[web_search] DDGS fallback attempt failed for '{q}': {e}", file=sys.stderr)

            return ddg_urls, ddg_snips

        # 2. Secondary Fallback: Bing Search (with dedicated clean headers to prevent bot deflection)
        async def fetch_bing():
            bing_urls, bing_snips = [], []
            try:
                # Script-adaptive market/locale targeting
                if re.search(r'[\u3040-\u30FF\u31F0-\u31FF]', q):
                    lang_param = "&setmkt=ja-jp&setlang=ja-jp"
                elif re.search(r'[\u4E00-\u9FFF]', q) and not re.search(r'[a-zA-Z]', q):
                    lang_param = "&setmkt=zh-cn&setlang=zh-cn"
                elif re.search(r'[\u0900-\u097F]', q):
                    lang_param = "&setmkt=en-in&setlang=hi"
                elif re.search(r'[\uAC00-\uD7AF]', q):
                    lang_param = "&setmkt=ko-kr&setlang=ko-kr"
                else:
                    lang_param = "&setmkt=en-us&setlang=en-us"

                bing_headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=10; SRCHD=AF=NOFORM;',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1',
                }

                bing_url = f"https://www.bing.com/search?q={encoded_query_clean}&adlt=off{lang_param}"
                resp = await client.get(bing_url, headers=bing_headers, timeout=4.0)
                if resp.status_code == 200 and resp.text:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(resp.text, "html.parser")
                    main_results = soup.find("ol", id="b_results") or soup
                    for r in main_results.find_all("li", class_="b_algo")[:10]:
                        h2 = r.find("h2")
                        if not h2:
                            continue
                        a = h2.find("a")
                        if not a:
                            continue
                        title = a.get_text(strip=True)
                        raw_href = a.get("href", "")
                        real_href = decode_bing_url(raw_href)
                        snippet_el = r.find("p") or r.find(class_="b_caption")
                        snippet = snippet_el.get_text(strip=True) if snippet_el else ""

                        if real_href and real_href.startswith("http") and "bing.com" not in real_href and real_href not in bing_urls:
                            bing_urls.append(real_href)
                            bing_snips.append((title, snippet, real_href))
            except Exception as e:
                import sys
                print(f"[web_search] Bing attempt failed for '{q}': {e}", file=sys.stderr)
            return bing_urls, bing_snips

        q_urls = []
        q_snippets = []
        seen_urls = set()
        engine_used = "DuckDuckGo"

        # Step 1: Run primary DuckDuckGo search
        ddg_urls, ddg_snips = await fetch_ddg()
        for t, d, u in ddg_snips:
            if u not in seen_urls:
                seen_urls.add(u)
                q_urls.append(u)
                q_snippets.append(f"- {t}: {d} ({u})")

        # Step 2: If DuckDuckGo returned 0 results across both layers, fall back to Bing
        if not q_urls:
            engine_used = "Bing (DuckDuckGo empty / blocked)"
            is_latin_query = not bool(re.search(r'[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]', q))

            def is_junk_snippet(title_str, url_str):
                low = url_str.lower()
                if is_latin_query and any(x in low for x in [".52pojie.cn", "52pojie.cn", "baidu.com", "zhihu.com", "csdn.net", "jb51.net", "cr173.com"]):
                    return True
                return False

            bing_urls, bing_snips = await fetch_bing()
            for t, d, u in bing_snips:
                if u not in seen_urls and not is_junk_snippet(t, u):
                    seen_urls.add(u)
                    q_urls.append(u)
                    q_snippets.append(f"- {t}: {d} ({u})")

        # Step 3: Tertiary Fallback: Try Yahoo Search if still empty
        if not q_urls:
            engine_used = "Yahoo (DDG & Bing empty)"
            try:
                def _do_yahoo_fallback():
                    try:
                        import primp
                        p_client = primp.Client(impersonate="random")
                        return p_client.get(f"https://search.yahoo.com/search?p={encoded_query_clean}")
                    except Exception:
                        return None

                p_resp = await asyncio.to_thread(_do_yahoo_fallback)
                html_text = p_resp.text if p_resp and p_resp.status_code == 200 else ""
                if not html_text and client:
                    resp = await client.get(f"https://search.yahoo.com/search?p={encoded_query_clean}", headers=headers, timeout=4.0)
                    if resp.status_code == 200:
                        html_text = resp.text

                if html_text:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(html_text, "html.parser")
                    for item in soup.select("div.algo, #web ol > li, div.dd")[:8]:
                        link_el = item.find("a")
                        desc_el = item.find(class_=lambda c: c and any(k in c for k in ["compText", "fz-m", "s-desc"])) or item.find("p")
                        if link_el:
                            title = link_el.get_text(strip=True)
                            href = link_el.get("href", "")
                            desc = desc_el.get_text(strip=True) if desc_el else ""

                            if "r.search.yahoo.com" in href:
                                ru_match = re.search(r'/RU=([^/]+)/', href)
                                if ru_match:
                                    href = urllib.parse.unquote(ru_match.group(1))

                            if href and href not in q_urls and "yahoo.com" not in href:
                                q_urls.append(href)
                                q_snippets.append(f"- {title}: {desc} ({href})")
            except Exception as e:
                import sys
                print(f"[web_search] Yahoo attempt failed for '{q}': {e}", file=sys.stderr)

        # Step 4: Final Emergency Fallback: Wikipedia Search API (ONLY if ALL primary web searches returned zero results)
        if not q_urls:
            engine_used = "Wikipedia Search API (Emergency Fallback - Web Engines Empty)"
            try:
                wiki_search_url = f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(q_clean)}&utf8=&format=json"
                w_resp = await client.get(wiki_search_url, headers={"User-Agent": "ProjectYuki/2.0 (AI Assistant)"}, timeout=2.5)
                if w_resp.status_code == 200:
                    w_data = w_resp.json()
                    for item in w_data.get("query", {}).get("search", [])[:3]:
                        w_title = item.get("title", "")
                        w_snippet_raw = item.get("snippet", "")
                        w_snippet = re.sub(r'<[^>]+>', '', w_snippet_raw).replace('&quot;', '"').replace('&#039;', "'").strip()
                        w_page_title = w_title.replace(" ", "_")
                        w_url = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(w_page_title)}"
                        if w_url not in seen_urls and w_snippet:
                            seen_urls.add(w_url)
                            q_urls.append(w_url)
                            q_snippets.append(f"- {w_title} - Wikipedia: {w_snippet} ({w_url})")
            except Exception:
                pass

        return q_urls, q_snippets, engine_used

    full_query = " ".join(query_list)
    display_query = " | ".join(query_list)
    is_advanced = getattr(config, "TOOL_MODE", "basic") == "advanced"
    base_budget = 5000 if is_advanced else 1000

    async with httpx.AsyncClient(timeout=6.0, verify=False) as client:
        def is_bot_blocked(text: str) -> bool:
            if not text:
                return True
            t_lower = text.lower()
            blocked_phrases = (
                "security verification", "verify you are human", "just a moment...",
                "enable javascript", "access denied", "ddos protection", "checking your browser",
                "error 403", "403: forbidden", "403 forbidden", "error 404", "404 not found",
                "error 429", "too many requests", "you've been blocked", "blocked by network security",
                "log in to your reddit account", "target url returned error", "use your developer token",
                "rate limit exceeded", "unusual traffic from your computer", "pardon our interruption",
                "please complete the security check", "cf-browser-verification", "ray id:", "attention required! | cloudflare"
            )
            return any(p in t_lower for p in blocked_phrases) and len(text) < 1500

        async def fetch_page(url: str, custom_budget: Optional[int] = None):
            budget = custom_budget or base_budget
            if is_youtube_url(url):
                try:
                    need_tr = any(kw in full_query.lower() for kw in ("transcript", "lyrics", "subtitles", "say in", "said in", "speech", "caption", "words", "dialogue"))
                    yt_text = await async_extract_youtube_content(client, url, max_chars=budget, need_transcript=need_tr)
                    if yt_text and len(yt_text.strip()) >= 50:
                        return f"[Source: YouTube ({url})]\n{yt_text}"
                except Exception as e:
                    import sys
                    print(f"[web_search] YouTube deep fetch failed for {url}: {e}", file=sys.stderr)

            try:
                parsed_url = urllib.parse.urlparse(url)
                domain = parsed_url.netloc.replace("www.", "")
            except Exception:
                domain = url

            clean_text = ""
            # A. Attempt direct fetch (fast 3.5s timeout)
            try:
                resp = await client.get(url, headers=headers, follow_redirects=True, timeout=3.5)
                if resp.status_code == 200 and resp.text:
                    parsed_md = extract_clean_markdown(resp.text, max_chars=budget, domain=domain, query=full_query, page_url=url)
                    if not is_bot_blocked(parsed_md):
                        clean_text = parsed_md
            except Exception as e:
                import sys
                print(f"[web_search] Direct fetch failed for {url}: {e}", file=sys.stderr)

            # B. Attempt reader proxy fallback if direct fetch was blocked / empty (fast 3.5s timeout)
            if not clean_text or len(clean_text.strip()) < 80:
                try:
                    jina_url = f"https://r.jina.ai/{url}"
                    jina_resp = await client.get(jina_url, timeout=3.5)
                    if jina_resp.status_code == 200 and jina_resp.text.strip():
                        jina_text = jina_resp.text.strip()
                        if not is_bot_blocked(jina_text):
                            # Strip Jina header metadata
                            jina_text = re.sub(r'^(Title:.*?\n|URL Source:.*?\n|Markdown Content:\s*)+', '', jina_text, flags=re.MULTILINE | re.IGNORECASE).strip()
                            # Prune backstage crew
                            jina_text = prune_crew_sections(jina_text)
                            # Global citation scrubbing
                            jina_text = re.sub(r'\[(?:\d+|citation needed|edit|note \d+)\]', '', jina_text, flags=re.IGNORECASE)
                            # Query-aware section anchor jump
                            if full_query:
                                jina_text = anchor_by_query(jina_text, full_query)

                            if len(jina_text) > budget:
                                cutoff = budget
                                last_para = jina_text.rfind("\n", 0, budget)
                                if last_para > budget * 0.7:
                                    cutoff = last_para
                                jina_text = jina_text[:cutoff].strip() + f"\n\n... [Content truncated at {cutoff} characters. Call 'jarvis_web_scrape' on this URL to read up to 15,000+ characters if this page looks promising]"
                            clean_text = jina_text
                except Exception:
                    pass

            if clean_text and len(clean_text.strip()) >= 80:
                return f"[Source: {domain} ({url})]\n{clean_text}"
            return None

        # Helper 1: Image Search Functions
        async def fetch_wiki_summary_image(client: httpx.AsyncClient, entity_name: str) -> Optional[dict]:
            """Fetches canonical Wikipedia summary portrait/flag/image if available."""
            try:
                clean_title = entity_name.strip().replace(" ", "_")
                url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(clean_title)}"
                resp = await client.get(url, headers={"User-Agent": "ProjectYuki/2.0 (AI Assistant)"}, timeout=2.5)
                if resp.status_code == 200:
                    data = resp.json()
                    img_src = data.get("originalimage", {}).get("source") or data.get("thumbnail", {}).get("source")
                    desc = data.get("description", "")
                    title = data.get("title", entity_name)
                    if img_src and img_src.startswith(("http://", "https://")):
                        return {
                            "title": f"Canonical Wikipedia: {title}" + (f" ({desc})" if desc else ""),
                            "image": img_src,
                            "url": data.get("content_urls", {}).get("desktop", {}).get("page", f"https://en.wikipedia.org/wiki/{clean_title}"),
                            "width": data.get("thumbnail", {}).get("width"),
                            "height": data.get("thumbnail", {}).get("height"),
                        }
            except Exception:
                pass
            return None

        async def fetch_image_results(client: httpx.AsyncClient, q: str, limit: int = 20) -> list[dict]:
            img_results = []
            seen_urls = set()

            is_nsfw = bool(re.search(
                r'\b(hentai|porn|porno|xxx|rule34|r34|nsfw|nude|naked|sex|lewd|ecchi|gore|erotic|milf|waifu\s+nsfw|boobs|ass|tits)\b',
                q, re.I
            ))

            async def _fetch_bing_images():
                b_imgs = []
                try:
                    bing_img_headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=20;',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                    }
                    encoded_img_q = urllib.parse.quote_plus(q)
                    url = f"https://www.bing.com/images/search?q={encoded_img_q}&adlt=off&form=HDRSC2&first=1"
                    resp = await client.get(url, headers=bing_img_headers, timeout=4.5)
                    if resp.status_code == 200 and resp.text:
                        from bs4 import BeautifulSoup
                        soup = BeautifulSoup(resp.text, "html.parser")
                        for a in soup.find_all("a", class_="iusc"):
                            m_raw = a.get("m")
                            if not m_raw:
                                continue
                            try:
                                m_data = json.loads(m_raw)
                                murl = m_data.get("murl")
                                turl = m_data.get("turl")
                                purl = m_data.get("purl")
                                t = m_data.get("t", "")
                                desc = m_data.get("desc", "")
                                title_text = t or desc or "Image"
                                if murl and murl.startswith(("http://", "https://")) and murl not in seen_urls:
                                    seen_urls.add(murl)
                                    b_imgs.append({"title": title_text, "image": murl, "thumb": turl, "url": purl, "source": "Bing"})
                                    if len(b_imgs) >= limit:
                                        break
                            except Exception:
                                pass
                except Exception:
                    pass
                return b_imgs

            async def _fetch_ddg_images():
                d_imgs = []
                try:
                    def _do_ddgs_images():
                        try:
                            from ddgs import DDGS
                        except ImportError:
                            from duckduckgo_search import DDGS
                        with DDGS(timeout=5) as ddgs_client:
                            return list(ddgs_client.images(q, safesearch="off", max_results=limit))
                    raw = await asyncio.to_thread(_do_ddgs_images)
                    for item in raw:
                        murl = item.get("image")
                        t = item.get("title", "").strip()
                        purl = item.get("url", "").strip()
                        turl = item.get("thumbnail", "").strip()
                        w = item.get("width")
                        h = item.get("height")
                        if murl and murl.startswith(("http://", "https://")) and murl not in seen_urls:
                            seen_urls.add(murl)
                            d_imgs.append({"title": t, "image": murl, "thumb": turl, "url": purl, "width": w, "height": h, "source": "DuckDuckGo"})
                            if len(d_imgs) >= limit:
                                break
                except Exception:
                    pass
                return d_imgs

            if is_nsfw:
                img_results = await _fetch_bing_images()
                if len(img_results) < 3:
                    ddg_results = await _fetch_ddg_images()
                    img_results.extend(ddg_results)
            else:
                img_results = await _fetch_ddg_images()
                if len(img_results) < 3:
                    bing_results = await _fetch_bing_images()
                    img_results.extend(bing_results)

            return img_results[:limit]

        async def fetch_entity_image_bundle(client: httpx.AsyncClient, q: str, limit: int = 4) -> tuple[str, list[dict]]:
            """Fetches Wikipedia canonical image (if any) + Bing image results for a single query."""
            wiki_task = fetch_wiki_summary_image(client, q)
            bing_task = fetch_image_results(client, q, limit=limit)
            wiki_res, bing_res = await asyncio.gather(wiki_task, bing_task)
            
            combined = []
            if wiki_res:
                combined.append(wiki_res)
            for img in bing_res:
                if wiki_res and img.get("image") == wiki_res.get("image"):
                    continue
                combined.append(img)
                if len(combined) >= limit + (1 if wiki_res else 0):
                    break
            return q, combined

        # Helper 2: News Search Functions
        def parse_relative_time(pub_date_str: str) -> str:
            if not pub_date_str:
                return ""
            try:
                dt = email.utils.parsedate_to_datetime(pub_date_str)
                if dt:
                    now_dt = datetime.datetime.now(datetime.timezone.utc)
                    diff = now_dt - dt.astimezone(datetime.timezone.utc)
                    total_seconds = int(diff.total_seconds())
                    if total_seconds < 0:
                        return "Just now"
                    if total_seconds < 60:
                        return f"{total_seconds}s ago"
                    minutes = total_seconds // 60
                    if minutes < 60:
                        return f"{minutes}m ago"
                    hours = minutes // 60
                    if hours < 24:
                        return f"{hours}h ago"
                    days = hours // 24
                    if days == 1:
                        return "Yesterday"
                    if days < 30:
                        return f"{days}d ago"
                    return dt.strftime("%b %d, %Y")
            except Exception:
                pass
            return pub_date_str[:16]

        async def fetch_news_for_query(client: httpx.AsyncClient, q: str, country_code: Optional[str] = None) -> tuple[list[dict], str]:
            cc = (country_code or "US").strip().upper()
            if len(cc) != 2:
                cc = "US"
            
            # Smart Freshness Guard: If query has no explicit temporal operator, add when:14d for genuinely recent news
            has_time_filter = any(w in q.lower() for w in ("when:", "after:", "before:", "year", "2024", "2025"))
            q_fresh = f"{q} when:14d" if not has_time_filter else q

            encoded_q = urllib.parse.quote(q_fresh)
            encoded_q_broad = urllib.parse.quote(q)
            encoded_bing_q = urllib.parse.quote_plus(q)
            g_url = f"https://news.google.com/rss/search?q={encoded_q}&hl=en&gl={cc}&ceid={cc}:en"
            g_url_broad = f"https://news.google.com/rss/search?q={encoded_q_broad}&hl=en&gl={cc}&ceid={cc}:en"
            b_url = f"https://www.bing.com/news/search?q={encoded_bing_q}&format=rss"

            news_headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
            }

            def _parse_g_items(items):
                parsed = []
                for it in items:
                    t = it.find("title")
                    l = it.find("link")
                    d = it.find("pubDate")
                    src_el = it.find("source")
                    pub = src_el.text.strip() if src_el is not None and src_el.text else ""
                    raw_title = t.text.strip() if t is not None and t.text else ""
                    if not raw_title:
                        continue
                    clean_t = html.unescape(raw_title)
                    if " - " in clean_t:
                        title_part, pub_part = clean_t.rsplit(" - ", 1)
                    else:
                        title_part, pub_part = clean_t, pub
                    link = l.text.strip() if l is not None and l.text else ""
                    pub_date = d.text.strip() if d is not None and d.text else ""
                    parsed.append({
                        "title": title_part.strip(),
                        "publisher": pub_part.strip() or pub,
                        "snippet": "",
                        "link": link,
                        "time": parse_relative_time(pub_date),
                    })
                return parsed

            def _parse_b_items(items):
                parsed = []
                for it in items:
                    t = it.find("title")
                    l = it.find("link")
                    desc = it.find("description")
                    d = it.find("pubDate")
                    src_el = it.find("{http://schemas.microsoft.com/search/local/news}source") or it.find("source")
                    pub = src_el.text.strip() if src_el is not None and src_el.text else ""
                    raw_title = t.text.strip() if t is not None and t.text else ""
                    if not raw_title:
                        continue
                    clean_t = html.unescape(raw_title)
                    if " - " in clean_t:
                        title_part, pub_part = clean_t.rsplit(" - ", 1)
                    else:
                        title_part, pub_part = clean_t, pub
                    snip_raw = desc.text.strip() if desc is not None and desc.text else ""
                    clean_snip = re.sub(r'<[^>]+>', '', snip_raw) if snip_raw else ""
                    link = l.text.strip() if l is not None and l.text else ""
                    pub_date = d.text.strip() if d is not None and d.text else ""
                    parsed.append({
                        "title": title_part.strip(),
                        "publisher": pub_part.strip() or pub,
                        "snippet": html.unescape(clean_snip).strip(),
                        "link": link,
                        "time": parse_relative_time(pub_date),
                    })
                return parsed

            # Step 1: Query Primary Engine: Google News RSS (higher relevance, global coverage, exact timestamps)
            engine_name = "Google News RSS"
            try:
                r = await client.get(g_url, headers=news_headers, follow_redirects=True, timeout=5.0)
                if r.status_code == 200 and r.text:
                    root = ET.fromstring(r.text)
                    g_items = root.findall(".//item")[:15]
                    parsed_g = _parse_g_items(g_items)
                    if len(parsed_g) >= 3:
                        return parsed_g, engine_name

                # If 14-day window had < 3 items, try broader search without time constraint
                if q_fresh != q:
                    r_broad = await client.get(g_url_broad, headers=news_headers, follow_redirects=True, timeout=5.0)
                    if r_broad.status_code == 200 and r_broad.text:
                        root = ET.fromstring(r_broad.text)
                        g_items = root.findall(".//item")[:15]
                        parsed_g = _parse_g_items(g_items)
                        if len(parsed_g) >= 3:
                            return parsed_g, engine_name
            except Exception as e:
                import sys
                print(f"[web_search] Google News RSS primary attempt failed for '{q}': {e}", file=sys.stderr)

            # Step 2: Fallback Engine: Bing News RSS (if Google News returned <3 items or failed)
            engine_name = "Bing News RSS (Fallback)"
            try:
                r = await client.get(b_url, headers=news_headers, follow_redirects=True, timeout=5.0)
                if r.status_code == 200 and r.text:
                    root = ET.fromstring(r.text)
                    b_items = root.findall(".//item")[:15]
                    parsed_b = _parse_b_items(b_items)
                    if parsed_b:
                        return parsed_b, engine_name
            except Exception as e:
                import sys
                print(f"[web_search] Bing News RSS fallback attempt failed for '{q}': {e}", file=sys.stderr)

            return [], "None"

        # Mode Branch 1: Image Search
        if effective_mode == "image":
            per_query_limit = max(4, 20 // len(query_list))
            tasks = [fetch_entity_image_bundle(client, q, limit=per_query_limit) for q in query_list]
            image_search_by_query = await asyncio.gather(*tasks)

            context_parts = [f"Image search results for: \"{display_query}\""]
            has_images = False
            for q_title, img_list in image_search_by_query:
                if not img_list:
                    continue
                has_images = True
                if len(image_search_by_query) > 1:
                    context_parts.append(f"\n### Verified Images for \"{q_title}\":")
                else:
                    context_parts.append(f"\n### Verified Images ({len(img_list)} Photos):")
                for i, img in enumerate(img_list, 1):
                    title = img.get('title') or f"Image {i}"
                    img_url = img.get('image')
                    dim = f" [{img['width']}x{img['height']}]" if img.get('width') and img.get('height') else ""
                    context_parts.append(f"{i}. {img_url} ({title}{dim})")

            final_result = "\n\n".join(context_parts) if has_images else f"No images found for {display_query}."
            _SEARCH_CACHE[cache_key] = (now, final_result)
            return final_result

        # Mode Branch 2: News Search
        elif effective_mode == "news":
            news_tasks = [fetch_news_for_query(client, q, country_code=country_code) for q in query_list]
            news_results = await asyncio.gather(*news_tasks)

            all_news = []
            news_engines = []
            seen_titles = set()
            stop_words = {"with", "from", "this", "that", "after", "says", "news", "over", "into", "amid", "will", "have", "about"}

            for q_news, q_eng in news_results:
                if q_eng and q_eng != "None" and q_eng not in news_engines:
                    news_engines.append(q_eng)
                for item in q_news:
                    title = item.get("title", "").strip()
                    if not title:
                        continue
                    words = set(re.findall(r'\b[a-zA-Z]{4,}\b', title.lower())) - stop_words
                    if not words:
                        continue
                    # Jaccard overlap check: only drop if > 45% of distinct non-stop words overlap
                    is_dup = False
                    for st in seen_titles:
                        inter = len(words & st)
                        union = len(words | st)
                        if union and (inter / union) > 0.45:
                            is_dup = True
                            break
                    if is_dup:
                        continue
                    seen_titles.add(frozenset(words))
                    all_news.append(item)

            if not all_news:
                # Resilient fallback: Query general web search with news keyword
                fb_urls, fb_snips, fb_eng = await search_single_query(client, f"{display_query} news")
                if fb_snips:
                    final_result = f"Breaking News & Updates for: \"{display_query}\" [Web Engine Fallback: {fb_eng}]\n\n" + "\n".join(fb_snips[:6])
                    _SEARCH_CACHE[cache_key] = (now, final_result)
                    return final_result
                final_result = f"No recent news or headlines found for '{display_query}'."
                _SEARCH_CACHE[cache_key] = (now, final_result)
                return final_result

            # Deep scrape the top 1-2 candidate articles
            deep_scraped_articles = []
            scrape_candidates = [it["link"] for it in all_news if it.get("link") and it["link"].startswith(("http://", "https://"))][:2]
            if scrape_candidates:
                scrape_tasks = [fetch_page(u, custom_budget=base_budget) for u in scrape_candidates]
                scraped_res = await asyncio.gather(*scrape_tasks)
                deep_scraped_articles = [s for s in scraped_res if s]

            eng_header = f" [Engine: {', '.join(news_engines)}]" if news_engines else ""
            context_parts = [f"Breaking News & Updates for: \"{display_query}\"{eng_header}"]
            context_parts.append("### Latest Headlines & Coverage:")
            for idx, it in enumerate(all_news[:10], 1):
                pub = f" [Source: {it['publisher']}]" if it.get('publisher') else ""
                tm = f" [{it['time']}]" if it.get('time') else ""
                line = f"{idx}. {it['title']}{pub}{tm}"
                if it.get('snippet'):
                    line += f"\n   Summary: {it['snippet']}"
                if it.get('link'):
                    line += f"\n   Link: {it['link']}"
                context_parts.append(line)

            if deep_scraped_articles:
                context_parts.append("\n### Detailed News Coverage:\n" + "\n\n".join(deep_scraped_articles))

            final_result = "\n\n".join(context_parts)
            _SEARCH_CACHE[cache_key] = (now, final_result)
            return final_result

        # Mode Branch 3: Standard Organic Search (text_and_snippet)
        else:
            all_urls = []
            all_snippets = []
            engines_used = []

            async def _execute_with_stagger(index: int, query_item: str):
                if index > 0:
                    await asyncio.sleep(index * 0.15)
                return await search_single_query(client, query_item)

            search_tasks = [_execute_with_stagger(i, q) for i, q in enumerate(query_list)]
            search_results = await asyncio.gather(*search_tasks)

            for q_urls, q_snippets, eng in search_results:
                if eng and eng not in engines_used:
                    engines_used.append(eng)
                for u in q_urls:
                    if u not in all_urls:
                        all_urls.append(u)
                for s in q_snippets:
                    if s not in all_snippets:
                        all_snippets.append(s)

            if not all_snippets:
                query_display = ", ".join(f"'{q}'" for q in query_list)
                return f"No search results found for {query_display}."

            for q_item in query_list:
                if q_item.startswith(('http://', 'https://')) and q_item not in all_urls:
                    all_urls.insert(0, q_item)

            q_words = set(re.findall(r'\b[a-zA-Z0-9_]+\b', full_query.lower()))

            synonym_clusters = [
                {"cast", "character", "characters", "voice", "actor", "actors", "staff", "seiyuu", "crew", "fullcredits"},
                {"episode", "episodes", "chapter", "chapters", "season", "guide"},
                {"lyric", "lyrics", "tracklist", "track", "ost", "song"},
                {"documentation", "docs", "guide", "tutorial", "reference", "manual", "api"},
                {"solution", "example", "syntax", "answers"}
            ]

            is_formula_or_science = any(w in q_words for w in ("formula", "equation", "law", "theorem", "definition", "engineering", "calculate", "calculation", "derivation", "proof", "method", "unit"))
            if is_formula_or_science:
                synonym_clusters.append({"geeksforgeeks", "testbook", "sanfoundry", "byjus", "unacademy", "vedantu", "tutorialspoint", "w3schools", "sciencedirect", "wikipedia", "engineering"})

            scored_urls = []
            for i, u in enumerate(all_urls):
                score = 100 - i * 5
                u_lower = u.lower()
                parsed_u = urllib.parse.urlparse(u)
                is_root = parsed_u.path.strip("/") == "" or parsed_u.path.strip("/").lower() in ("index.html", "index.php", "home")

                if is_root:
                    score -= 80

                for q_item in query_list:
                    if q_item.lower() == u_lower:
                        score += 200
                    elif is_youtube_url(q_item):
                        vid_id, pl_id, _ = parse_youtube_ids(q_item)
                        if vid_id and vid_id in u:
                            score += 150
                        if pl_id and pl_id in u:
                            score += 60
                    elif len(q_item) >= 6 and q_item.lower() in u_lower:
                        score += 50

                for domain_kw in ("wikipedia", "imdb", "reddit", "quora", "testbook", "github", "fandom", "myanimelist", "animenewsnetwork", "behindthevoiceactors", "btva", "youtube", "geeksforgeeks", "sanfoundry"):
                    if domain_kw in q_words and domain_kw in u_lower:
                        score += 50

                if is_formula_or_science:
                    for edu_kw in ("testbook", "geeksforgeeks", "sanfoundry", "byjus", "unacademy", "vedantu", "tutorialspoint", "wikipedia.org/wiki/"):
                        if edu_kw in u_lower:
                            score += 45

                for cluster in synonym_clusters:
                    if any(w in q_words for w in cluster):
                        if any(w in u_lower for w in cluster):
                            score += 35

                if "wikipedia.org/wiki/list_of_" in u_lower:
                    score += 30
                if "animenewsnetwork.com" in u_lower:
                    score += 25

                if "behindthevoiceactors.com" in u_lower and "behindthevoiceactors" not in q_words and "btva" not in q_words:
                    score -= 30

                if "(2017)" in u_lower or "tt1241317" in u_lower or "2017_film" in u_lower:
                    if any("tt0877057" in x.lower() or "character" in x.lower() for x in all_urls):
                        score -= 40

                scored_urls.append((score, u))

            scored_urls.sort(key=lambda x: x[0], reverse=True)
            all_urls = [u for _, u in scored_urls]

            is_news_or_market = any(w in q_words for w in ("news", "latest", "today", "yesterday", "current", "yields", "yield", "treasury", "treasuries", "market", "markets", "stocks", "bonds", "crypto", "price", "prices", "earnings"))
            top_authority_url = None
            for u in all_urls[:5]:
                parsed_u = urllib.parse.urlparse(u)
                if parsed_u.path.strip("/") == "":
                    continue
                domain_part = parsed_u.netloc.lower()
                if is_news_or_market and any(wiki_d in domain_part for wiki_d in ("wikipedia.org", "wiktionary.org", "wikiquote.org", "britannica.com")):
                    continue
                if any(auth_d in domain_part for auth_d in AUTHORITY_DOMAINS):
                    meaningful_q_words = [w for w in q_words if len(w) > 2 and w not in ("in", "on", "at", "the", "a", "an", "and", "or", "for", "of", "to", "with", "is", "was", "are", "were")]
                    if len(meaningful_q_words) >= 2 and not any(w in u.lower() for w in meaningful_q_words):
                        continue
                    top_authority_url = u
                    break

            if top_authority_url:
                target_page_count = 1
                current_page_budget = base_budget * 2
                candidate_urls = [top_authority_url] + [u for u in all_urls if u != top_authority_url][:4]
            else:
                target_page_count = 2
                current_page_budget = base_budget
                candidate_urls = all_urls[:6]

            page_contents = []
            if candidate_urls:
                tasks = [fetch_page(u, custom_budget=current_page_budget) for u in candidate_urls]
                fetched = await asyncio.gather(*tasks)
                valid_pages = [f for f in fetched if f]
                page_contents = valid_pages[:target_page_count]

            context_parts = []
            eng_header = f" [Engine: {', '.join(engines_used)}]" if engines_used else ""
            context_parts.append(f"Web search results for: \"{display_query}\"{eng_header}")
            context_parts.append("Snippets:\n" + "\n".join(all_snippets))
            if page_contents:
                context_parts.append("\nDetailed Page Contents:\n" + "\n\n".join(page_contents))

            final_result = "\n\n".join(context_parts)
            _SEARCH_CACHE[cache_key] = (now, final_result)
            return final_result



async def compare_search_engines(query: str) -> dict:
    """
    Executes live multi-engine comparison across:
    - DuckDuckGo Text vs. Bing Text vs. Yahoo Text
    - DuckDuckGo Images vs. Bing Images (both SafeSearch off)
    - Yuki Synthesized Agent Context
    """
    q_clean = re.sub(r'[\'"]', ' ', query).strip()
    encoded_q = urllib.parse.quote_plus(q_clean)

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://html.duckduckgo.com/',
        'Origin': 'https://html.duckduckgo.com',
    }

    bing_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=10; SRCHD=AF=NOFORM;',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
    }

    async with httpx.AsyncClient(timeout=8.0, verify=False) as client:
        # 1. DuckDuckGo Text
        async def get_ddg_text():
            results = []
            try:
                def _do_ddgs():
                    try:
                        from ddgs import DDGS
                    except ImportError:
                        from duckduckgo_search import DDGS
                    with DDGS(timeout=5) as ddgs_client:
                        return list(ddgs_client.text(q_clean, safesearch="off", max_results=10))
                raw = await asyncio.to_thread(_do_ddgs)
                for r in raw:
                    results.append({
                        "title": r.get("title", ""),
                        "snippet": r.get("body", ""),
                        "url": r.get("href", "")
                    })
            except Exception as e:
                results.append({"title": f"Error querying DDG: {e}", "snippet": "", "url": ""})
            return results

        # 2. Bing Text
        async def get_bing_text():
            results = []
            try:
                b_url = f"https://www.bing.com/search?q={encoded_q}&adlt=off&setmkt=en-us&setlang=en-us"
                resp = await client.get(b_url, headers=bing_headers)
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    main_results = soup.find("ol", id="b_results") or soup
                    for r in main_results.find_all("li", class_="b_algo")[:10]:
                        h2 = r.find("h2")
                        p = r.find("p") or r.find(class_="b_caption")
                        if h2 and h2.find("a"):
                            a = h2.find("a")
                            raw_href = a.get("href", "")
                            if "bing.com/ck/a" in raw_href and "&u=" in raw_href:
                                import base64
                                try:
                                    qs = urllib.parse.parse_qs(urllib.parse.urlparse(raw_href).query)
                                    u_val = qs.get("u", [""])[0]
                                    if u_val.startswith("a1"):
                                        b64_str = u_val[2:] + "=" * ((4 - len(u_val[2:]) % 4) % 4)
                                        raw_href = base64.urlsafe_b64decode(b64_str).decode("utf-8")
                                except Exception:
                                    pass
                            results.append({
                                "title": a.get_text(strip=True),
                                "snippet": p.get_text(strip=True) if p else "",
                                "url": raw_href
                            })
            except Exception as e:
                results.append({"title": f"Error querying Bing: {e}", "snippet": "", "url": ""})
            return results

        # 3. Yahoo Text
        async def get_yahoo_text():
            results = []
            try:
                def _do_yahoo_compare():
                    try:
                        import primp
                        p_client = primp.Client(impersonate="random")
                        return p_client.get(f"https://search.yahoo.com/search?p={encoded_q}")
                    except Exception:
                        return None

                p_resp = await asyncio.to_thread(_do_yahoo_compare)
                html_text = p_resp.text if p_resp and p_resp.status_code == 200 else ""
                if not html_text:
                    resp = await client.get(f"https://search.yahoo.com/search?p={encoded_q}", headers=headers)
                    if resp.status_code == 200:
                        html_text = resp.text

                if html_text:
                    soup = BeautifulSoup(html_text, "html.parser")
                    seen_y_urls = set()
                    for item in soup.select("div.algo, #web ol > li, div.dd"):
                        link_el = item.find("a")
                        desc_el = item.find(class_=lambda c: c and any(k in c for k in ["compText", "fz-m", "s-desc"])) or item.find("p")
                        if link_el:
                            href = link_el.get("href", "")
                            if "r.search.yahoo.com" in href:
                                ru_match = re.search(r'/RU=([^/]+)/', href)
                                if ru_match:
                                    href = urllib.parse.unquote(ru_match.group(1))
                            title = link_el.get_text(strip=True)
                            if href and "yahoo.com" not in href and href not in seen_y_urls and len(title) > 3:
                                seen_y_urls.add(href)
                                desc = desc_el.get_text(strip=True) if desc_el else ""
                                results.append({
                                    "title": title,
                                    "snippet": desc,
                                    "url": href
                                })
                                if len(results) >= 8:
                                    break
            except Exception as e:
                results.append({"title": f"Error querying Yahoo: {e}", "snippet": "", "url": ""})
            return results

        # 4. DuckDuckGo Images
        async def get_ddg_images():
            results = []
            try:
                def _do_ddgs_img():
                    try:
                        from ddgs import DDGS
                    except ImportError:
                        from duckduckgo_search import DDGS
                    with DDGS(timeout=5) as ddgs_client:
                        return list(ddgs_client.images(q_clean, safesearch="off", max_results=12))
                raw = await asyncio.to_thread(_do_ddgs_img)
                for r in raw:
                    results.append({
                        "title": r.get("title", ""),
                        "image": r.get("image", ""),
                        "url": r.get("url", ""),
                        "width": r.get("width"),
                        "height": r.get("height"),
                        "source": r.get("source", "")
                    })
            except Exception as e:
                pass
            return results

        # 5. Bing Images
        async def get_bing_images():
            results = []
            try:
                b_url = f"https://www.bing.com/images/search?q={encoded_q}&adlt=off&form=HDRSC2&first=1"
                resp = await client.get(b_url, headers=headers, cookies={"SRCHHPGUSR": "ADLT=OFF"})
                if resp.status_code == 200 and resp.text:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for a in soup.find_all("a", class_="iusc")[:12]:
                        m = a.get("m")
                        if m:
                            try:
                                mj = json.loads(m)
                                results.append({
                                    "title": mj.get("t", "").strip(),
                                    "image": mj.get("murl", "").strip(),
                                    "url": mj.get("purl", "").strip(),
                                    "width": mj.get("width"),
                                    "height": mj.get("height"),
                                    "source": "Bing Scrape"
                                })
                            except Exception:
                                pass
            except Exception as e:
                pass
            return results

        # 6. Yuki Agent View
        async def get_yuki_result():
            try:
                return await web_search(query)
            except Exception as e:
                return f"Error executing web_search: {e}"

        ddg_t, bing_t, yahoo_t, ddg_i, bing_i, yuki_res = await asyncio.gather(
            get_ddg_text(),
            get_bing_text(),
            get_yahoo_text(),
            get_ddg_images(),
            get_bing_images(),
            get_yuki_result()
        )

        return {
            "query": query,
            "text": {
                "duckduckgo": ddg_t,
                "bing": bing_t,
                "yahoo": yahoo_t
            },
            "images": {
                "duckduckgo": ddg_i,
                "bing": bing_i
            },
            "yuki_context": yuki_res
        }




