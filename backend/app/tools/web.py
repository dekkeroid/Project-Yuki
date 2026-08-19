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
    "testbook.com", "geeksforgeeks.org", "w3schools.com", "tutorialspoint.com", "khanacademy.org", "fandom.com"
)


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

    async def search_single_query(client: httpx.AsyncClient, q: str):
        encoded_query = urllib.parse.quote(q)
        q_urls = []
        q_snippets = []

        # 1. Try DuckDuckGo HTML Search
        ddg_url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
        try:
            resp = await client.get(ddg_url, headers=headers, timeout=5.0)
            if resp.status_code == 200 and "captcha" not in resp.text.lower() and "anomaly" not in resp.text.lower():
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(resp.text, "html.parser")
                for result in soup.find_all(class_="result")[:8]:
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

                        if real_url and real_url not in q_urls and not real_url.startswith("/"):
                            q_urls.append(real_url)

                        q_snippets.append(f"- {title}: {desc} ({real_url})")
        except Exception as e:
            import sys
            print(f"[web_search] DDG attempt failed for '{q}': {e}", file=sys.stderr)

        # 2. Fallback: Try Yahoo Search if DDG failed or returned nothing
        if not q_urls:
            yahoo_url = f"https://search.yahoo.com/search?p={encoded_query}"
            try:
                resp = await client.get(yahoo_url, headers=headers, timeout=5.0)
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

    async with httpx.AsyncClient(timeout=8.0) as client:
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

        # Re-rank candidates based on query subtopic terms, synonym clusters, and explicit requested domains
        full_query = " ".join(query_list)
        q_words = set(re.findall(r'\b[a-zA-Z0-9_]+\b', full_query.lower()))

        synonym_clusters = [
            {"cast", "character", "characters", "voice", "actor", "actors", "staff", "seiyuu", "crew", "fullcredits"},
            {"episode", "episodes", "chapter", "chapters", "season", "guide"},
            {"lyric", "lyrics", "tracklist", "track", "ost", "song"},
            {"documentation", "docs", "guide", "tutorial", "reference", "manual", "api"},
            {"solution", "example", "syntax", "answers"}
        ]

        scored_urls = []
        for i, u in enumerate(all_urls):
            score = 100 - i * 5
            u_lower = u.lower()

            # Boost if query explicitly requested domain
            for domain_kw in ("wikipedia", "imdb", "reddit", "quora", "testbook", "github", "fandom", "myanimelist", "animenewsnetwork", "behindthevoiceactors", "btva"):
                if domain_kw in q_words and domain_kw in u_lower:
                    score += 50

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

        # Authority-First Strategy: Check if URL #1 or #2 is an authoritative domain
        top_authority_url = None
        for u in all_urls[:2]:
            domain_part = urllib.parse.urlparse(u).netloc.lower()
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
            t_lower = text.lower()
            return any(p in t_lower for p in ("security verification", "verify you are human", "just a moment...", "enable javascript", "access denied", "ddos protection", "checking your browser")) and len(text) < 800

        async def fetch_page(url: str):
            try:
                parsed_url = urllib.parse.urlparse(url)
                domain = parsed_url.netloc.replace("www.", "")
            except Exception:
                domain = url

            clean_text = ""
            # A. Attempt direct fetch
            try:
                resp = await client.get(url, headers=headers, follow_redirects=True, timeout=6.0)
                if resp.status_code == 200 and resp.text:
                    parsed_md = extract_clean_markdown(resp.text, max_chars=page_budget, domain=domain, query=full_query)
                    if not is_bot_blocked(parsed_md):
                        clean_text = parsed_md
            except Exception as e:
                import sys
                print(f"[web_search] Direct fetch failed for {url}: {e}", file=sys.stderr)

            # B. Attempt reader proxy fallback if direct fetch was blocked / empty
            if not clean_text or len(clean_text.strip()) < 80:
                try:
                    jina_url = f"https://r.jina.ai/{url}"
                    jina_resp = await client.get(jina_url, timeout=7.0)
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



