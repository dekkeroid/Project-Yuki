import urllib.parse
import urllib.request
import json
import re
import time
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
    "youtube.com", "youtu.be"
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


async def async_extract_youtube_content(client: httpx.AsyncClient, url: str, max_chars: int = 5000) -> str:
    """
    Asynchronously extracts rich metadata, tracklists, transcripts, and description from any YouTube URL.
    """
    if not is_youtube_url(url):
        return ""

    video_id, playlist_id, fetch_url = parse_youtube_ids(url)

    # Layer 1: Official YouTube oEmbed API
    oembed_data = {}
    try:
        oe_url = f"https://www.youtube.com/oembed?url={urllib.parse.quote(url)}&format=json"
        oe_resp = await client.get(oe_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=5.0)
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

    # Layer 2: Extract Spoken Transcript (threaded to keep event loop responsive)
    if video_id:
        transcript_budget = min(max_chars, 4000)
        try:
            transcript = await asyncio.to_thread(fetch_youtube_transcript, video_id, max_chars=transcript_budget)
        except Exception:
            pass

    # Layer 3: Direct Page Fetch & Deep Scraping
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        resp = await client.get(fetch_url, headers=headers, timeout=8.0)
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


def extract_clean_markdown(raw_html: str, max_chars: int = 5000, domain: str = "", query: str = "") -> str:
    """
    Extracts clean, lossless Markdown from HTML content.
    - Strips unwanted tags, interactive forms, metadata boxes, cookie banners, popups, and ad sidebars.
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

    # 1. Strip unwanted and interactive tags completely
    junk_tags = [
        "script", "style", "header", "footer", "nav", "aside", "noscript", 
        "svg", "img", "form", "button", "select", "option", "input", "textarea", "label",
        "fieldset", "legend", "datalist", "optgroup", "iframe", "canvas", "meta", 
        "link", "dialog", "template", "figure", "figcaption", "picture", "source", 
        "audio", "video"
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
        r"\b(cookie|consent|banner|modal|popup|sidebar|sidebar-wrapper|leftside|newsletter|subscribe|author-bio|ad-|advertisement|social-share|share-buttons|disclaimer|breadcrumbs|nav-menu|menu-wrapper|menu|navbar|site-nav|related-posts|related-articles|related-content|recommendations?|recommended|promo-box|latest-news|comments?|reviews?|user-ratings?|poll|voting|footer-widget|site-footer|trending|copyright|privacy-policy)\b",
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
    
    def process_node(node):
        if isinstance(node, NavigableString):
            text = str(node).strip()
            if text:
                lines.append(text + " ")
            return

        if not isinstance(node, Tag):
            return

        tag_name = node.name.lower()

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

        markdown_doc = markdown_doc[:cutoff].strip() + f"\n\n... [Content truncated at {cutoff} characters]"

    return markdown_doc


def clean_html(html_content: str) -> str:
    """
    Backwards-compatible wrapper that converts raw HTML to clean text/markdown.
    """
    return extract_clean_markdown(html_content, max_chars=5000)


async def web_search(query) -> str:
    """
    Performs an async web search using DuckDuckGo HTML search, falling back to Yahoo HTML search.
    Supports both single query string and list/array of multiple queries (searching concurrently).
    - Checks 15-minute in-memory cache for instant zero-latency responses.
    - Authority-First Single Source Strategy: if an authoritative domain (Wikipedia, MAL, IMDb, Reddit, etc.)
      is in the top results, it fetches only that 1 source with the full double character budget (e.g. 10k in advanced).
    - Otherwise, fetches top 2 sources with standard per-page budget.
    """
    # Normalize query input (handles str, list, tuple, dict, etc.)
    if isinstance(query, (list, tuple)):
        query_list = [str(q).strip() for q in query if str(q).strip()]
    elif isinstance(query, dict):
        query_list = [str(v).strip() for v in query.values() if str(v).strip()]
    elif isinstance(query, str):
        query_list = [query.strip()] if query.strip() else []
    elif query:
        query_list = [str(query).strip()]
    else:
        query_list = []

    if not query_list:
        return "Please specify a query to search for."

    cache_key = " | ".join(sorted(q.lower() for q in query_list))
    now = time.time()
    
    # Check In-Memory Cache
    if cache_key in _SEARCH_CACHE:
        cached_time, cached_result = _SEARCH_CACHE[cache_key]
        if now - cached_time < _CACHE_TTL_SECONDS:
            return cached_result

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
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
        encoded_query_clean = urllib.parse.quote(q_clean)

        # 1. Fetch DDG POST (verbatim query matching, highly accurate on quoted/niche facts)
        async def fetch_ddg():
            ddg_urls, ddg_snips = [], []
            try:
                resp = await client.post("https://html.duckduckgo.com/html/", data={"q": q, "b": ""}, headers=headers, timeout=4.0)
                if resp.status_code == 200 and "captcha" not in resp.text.lower() and "anomaly" not in resp.text.lower():
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for result in soup.find_all(class_="result")[:10]:
                        link_el = result.find("a", class_="result__a")
                        desc_el = result.find(class_="result__snippet")
                        if link_el and desc_el:
                            title = link_el.get_text(strip=True)
                            href = link_el.get("href", "")
                            desc = desc_el.get_text(strip=True)

                            parsed = urllib.parse.urlparse(href)
                            qs = urllib.parse.parse_qs(parsed.query)
                            real_url = qs.get("uddg", [href])[0]
                            if real_url.startswith("//"):
                                real_url = "https:" + real_url

                            if real_url.startswith("http") and not real_url.startswith("/") and real_url not in ddg_urls:
                                ddg_urls.append(real_url)
                                ddg_snips.append((title, desc, real_url))
            except Exception as e:
                import sys
                print(f"[web_search] DDG attempt failed for '{q}': {e}", file=sys.stderr)
            return ddg_urls, ddg_snips

        # 2. Fetch Bing (Fast response, high coverage on entities and general topics)
        async def fetch_bing():
            bing_urls, bing_snips = [], []
            try:
                # Only set English locale for Latin queries to avoid Korean/spam fallback; preserve native script for non-Latin
                is_non_latin = bool(re.search(r'[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]', q))
                lang_param = "" if is_non_latin else "&setlang=en-us"
                bing_url = f"https://www.bing.com/search?q={encoded_query_clean}{lang_param}"
                resp = await client.get(bing_url, headers=headers, timeout=4.0)
                if resp.status_code == 200 and resp.text:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for r in soup.find_all("li", class_="b_algo")[:10]:
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

        # Run DDG and Bing in parallel
        (ddg_urls, ddg_snips), (bing_urls, bing_snips) = await asyncio.gather(fetch_ddg(), fetch_bing())

        q_urls = []
        q_snippets = []
        seen_urls = set()

        # Interleave and merge results, prioritizing DDG for exact queries and Bing for authority
        max_results = max(len(ddg_snips), len(bing_snips))
        for i in range(max_results):
            if i < len(ddg_snips):
                t, d, u = ddg_snips[i]
                if u not in seen_urls:
                    seen_urls.add(u)
                    q_urls.append(u)
                    q_snippets.append(f"- {t}: {d} ({u})")
            if i < len(bing_snips):
                t, d, u = bing_snips[i]
                if u not in seen_urls:
                    seen_urls.add(u)
                    q_urls.append(u)
                    q_snippets.append(f"- {t}: {d} ({u})")

        # 3. Fallback: Try Yahoo Search if both returned nothing
        if not q_urls:
            yahoo_url = f"https://search.yahoo.com/search?p={encoded_query_clean}"
            try:
                resp = await client.get(yahoo_url, headers=headers, timeout=4.0)
                if resp.status_code == 200:
                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for algo in soup.find_all("div", class_=lambda c: c and "algo" in c)[:8]:
                        link_el = algo.find("a")
                        desc_el = algo.find("div", class_=lambda c: c and "compText" in c)
                        if link_el and desc_el:
                            title = link_el.get_text(strip=True)
                            href = link_el.get("href", "")
                            desc = desc_el.get_text(strip=True)

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

        return q_urls, q_snippets

    all_urls = []
    all_snippets = []

    async with httpx.AsyncClient(timeout=6.0, verify=False) as client:
        search_tasks = [search_single_query(client, q) for q in query_list]
        search_results = await asyncio.gather(*search_tasks)

        for q_urls, q_snippets in search_results:
            for u in q_urls:
                if u not in all_urls:
                    all_urls.append(u)
            for s in q_snippets:
                if s not in all_snippets:
                    all_snippets.append(s)

        if not all_snippets:
            query_display = ", ".join(f"'{q}'" for q in query_list)
            return f"No search results found for {query_display}."

        # Inject direct query URLs if present in query_list
        for q_item in query_list:
            if q_item.startswith(('http://', 'https://')) and q_item not in all_urls:
                all_urls.insert(0, q_item)

        # Re-rank candidates based on query subtopic terms, synonym clusters, deep links, and explicit requested domains
        full_query = " ".join(query_list)
        q_words = set(re.findall(r'\b[a-zA-Z0-9_]+\b', full_query.lower()))

        synonym_clusters = [
            {"cast", "character", "characters", "voice", "actor", "actors", "staff", "seiyuu", "crew", "fullcredits"},
            {"episode", "episodes", "chapter", "chapters", "season", "guide"},
            {"lyric", "lyrics", "tracklist", "track", "ost", "song"},
            {"documentation", "docs", "guide", "tutorial", "reference", "manual", "api"},
            {"solution", "example", "syntax", "answers"}
        ]

        # Technical/Formula topic boost
        is_formula_or_science = any(w in q_words for w in ("formula", "equation", "law", "theorem", "definition", "engineering", "calculate", "calculation", "derivation", "proof", "method", "unit"))
        if is_formula_or_science:
            synonym_clusters.append({"geeksforgeeks", "testbook", "sanfoundry", "byjus", "unacademy", "vedantu", "tutorialspoint", "w3schools", "sciencedirect", "wikipedia", "engineering"})

        scored_urls = []
        for i, u in enumerate(all_urls):
            score = 100 - i * 5
            u_lower = u.lower()
            parsed_u = urllib.parse.urlparse(u)
            is_root = parsed_u.path.strip("/") == "" or parsed_u.path.strip("/").lower() in ("index.html", "index.php", "home")

            # Heavily demote generic root homepages (e.g. https://www.youtube.com/)
            if is_root:
                score -= 80

            # Boost exact URL match or direct query tokens
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

            # Boost if query explicitly requested domain
            for domain_kw in ("wikipedia", "imdb", "reddit", "quora", "testbook", "github", "fandom", "myanimelist", "animenewsnetwork", "behindthevoiceactors", "btva", "youtube", "geeksforgeeks", "sanfoundry"):
                if domain_kw in q_words and domain_kw in u_lower:
                    score += 50

            # Boost educational / scientific / reference domains for technical formula queries
            if is_formula_or_science:
                for edu_kw in ("testbook", "geeksforgeeks", "sanfoundry", "byjus", "unacademy", "vedantu", "tutorialspoint", "wikipedia.org/wiki/"):
                    if edu_kw in u_lower:
                        score += 45

            # Boost synonym cluster terms found in URL
            for cluster in synonym_clusters:
                if any(w in q_words for w in cluster):
                    if any(w in u_lower for w in cluster):
                        score += 35

            # Boost dedicated character list pages on Wikipedia and encyclopedia pages on ANN
            if "wikipedia.org/wiki/list_of_" in u_lower:
                score += 30
            if "animenewsnetwork.com" in u_lower:
                score += 25

            # Demote BTVA show index pages (they truncate non-English VAs to 'and X others') unless BTVA was explicitly queried
            if "behindthevoiceactors.com" in u_lower and "behindthevoiceactors" not in q_words and "btva" not in q_words:
                score -= 30

            # Demote spinoff remakes if original anime/series exists in candidates
            if "(2017)" in u_lower or "tt1241317" in u_lower or "2017_film" in u_lower:
                if any("tt0877057" in x.lower() or "character" in x.lower() for x in all_urls):
                    score -= 40

            scored_urls.append((score, u))

        scored_urls.sort(key=lambda x: x[0], reverse=True)
        all_urls = [u for _, u in scored_urls]

        # Determine mode-aware character budget
        is_advanced = getattr(config, "TOOL_MODE", "basic") == "advanced"
        base_budget = 5000 if is_advanced else 1000

        # Authority-First Strategy: Check top deep link from authoritative domains (ignoring root homepages)
        top_authority_url = None
        for u in all_urls[:4]:
            parsed_u = urllib.parse.urlparse(u)
            if parsed_u.path.strip("/") == "":
                continue  # Never choose a root homepage as the deep authority source
            domain_part = parsed_u.netloc.lower()
            if any(auth_d in domain_part for auth_d in AUTHORITY_DOMAINS):
                top_authority_url = u
                break

        if top_authority_url:
            # Single authoritative source: Double the budget for this 1 deep link
            target_page_count = 1
            page_budget = base_budget * 2  # 10,000 for Advanced, 2,000 for Basic
            candidate_urls = [top_authority_url] + [u for u in all_urls if u != top_authority_url][:4]
        else:
            # Multi-source mode: 2 sources with standard per-page budget
            target_page_count = 2
            page_budget = base_budget  # 5,000 for Advanced, 1,000 for Basic
            candidate_urls = all_urls[:6]

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

        async def fetch_page(url: str):
            if is_youtube_url(url):
                try:
                    yt_text = await async_extract_youtube_content(client, url, max_chars=page_budget)
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
                    parsed_md = extract_clean_markdown(resp.text, max_chars=page_budget, domain=domain, query=full_query)
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

                            if len(jina_text) > page_budget:
                                cutoff = page_budget
                                last_para = jina_text.rfind("\n", 0, page_budget)
                                if last_para > page_budget * 0.7:
                                    cutoff = last_para
                                jina_text = jina_text[:cutoff].strip() + f"\n\n... [Content truncated at {cutoff} characters]"
                            clean_text = jina_text
                except Exception:
                    pass

            if clean_text and len(clean_text.strip()) >= 80:
                return f"[Source: {domain} ({url})]\n{clean_text}"
            return None

        page_contents = []
        if candidate_urls:
            tasks = [fetch_page(u) for u in candidate_urls]
            fetched = await asyncio.gather(*tasks)
            valid_pages = [f for f in fetched if f]
            page_contents = valid_pages[:target_page_count]

    # Compile final context for the LLM
    context_parts = []
    display_query = " | ".join(query_list)
    context_parts.append(f"Web search results for: \"{display_query}\"")
    context_parts.append("Snippets:\n" + "\n".join(all_snippets))

    if page_contents:
        context_parts.append("\nDetailed Page Contents:\n" + "\n\n".join(page_contents))

    final_result = "\n\n".join(context_parts)
    
    # Save to Cache
    _SEARCH_CACHE[cache_key] = (now, final_result)
    
    return final_result



