import urllib.parse
import urllib.request
import json
import re
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

def clean_html(html_content: str) -> str:
    """
    Strips CSS, JS, comments, and boilerplate markup to extract clean page text content.
    """
    # Remove comments
    html = re.sub(r'<!--.*?-->', '', html_content, flags=re.DOTALL)
    # Remove script and style tags and content
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
    # Remove header, footer, nav tags and content
    html = re.sub(r'<header[^>]*>.*?</header>', '', html, flags=re.DOTALL)
    html = re.sub(r'<footer[^>]*>.*?</footer>', '', html, flags=re.DOTALL)
    html = re.sub(r'<nav[^>]*>.*?</nav>', '', html, flags=re.DOTALL)
    html = re.sub(r'<aside[^>]*>.*?</aside>', '', html, flags=re.DOTALL)
    # Extract text from HTML
    text = re.sub(r'<[^>]+>', ' ', html)
    # Decode HTML entities
    text = text.replace("&quot;", '"').replace("&amp;", "&").replace("&apos;", "'").replace("&#x27;", "'").replace("&#x2F;", "/").replace("&nbsp;", " ")
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text

async def web_search(query: str) -> str:
    """
    Performs an async web search using DuckDuckGo HTML search, falling back to Yahoo HTML search.
    It extracts the top 2 organic URLs, fetches their page contents asynchronously in parallel,
    cleans the markup using BeautifulSoup, and returns a detailed context block (snippets + page content)
    to the primary LLM for synthesis.
    """
    if not query:
        return "Please specify a query to search for."

    encoded_query = urllib.parse.quote(query.strip())
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-IN,en;q=0.9'
    }

    urls = []
    snippets_list = []

    async with httpx.AsyncClient() as client:
        # 1. Try DuckDuckGo HTML Search
        ddg_url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
        try:
            resp = await client.get(ddg_url, headers=headers, timeout=5.0)
            if resp.status_code == 200 and "captcha" not in resp.text.lower() and "anomaly" not in resp.text.lower():
                soup = BeautifulSoup(resp.text, "html.parser")
                for result in soup.find_all(class_="result")[:4]:
                    link_el = result.find("a", class_="result__a")
                    desc_el = result.find(class_="result__snippet")
                    if link_el and desc_el:
                        title = link_el.get_text(strip=True)
                        href = link_el.get("href", "")
                        desc = desc_el.get_text(strip=True)

                        # Decode DDG redirect URL
                        parsed = urllib.parse.urlparse(href)
                        qs = urllib.parse.parse_qs(parsed.query)
                        real_url = qs.get("uddg", [href])[0]
                        if real_url.startswith("//"):
                            real_url = "https:" + real_url

                        if real_url and real_url not in urls and not real_url.startswith("/"):
                            urls.append(real_url)

                        snippets_list.append(f"- {title}: {desc} ({real_url})")
        except Exception as e:
            import sys
            print(f"[web_search] DDG attempt failed: {e}", file=sys.stderr)

        # 2. Fallback: Try Yahoo Search if DDG failed or returned nothing
        if not urls:
            yahoo_url = f"https://search.yahoo.com/search?p={encoded_query}"
            try:
                resp = await client.get(yahoo_url, headers=headers, timeout=5.0)
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for algo in soup.find_all("div", class_=lambda c: c and "algo" in c)[:4]:
                        link_el = algo.find("a")
                        desc_el = algo.find("div", class_=lambda c: c and "compText" in c)
                        if link_el and desc_el:
                            title = link_el.get_text(strip=True)
                            href = link_el.get("href", "")
                            desc = desc_el.get_text(strip=True)

                            # Clean up Yahoo redirect URLs if needed
                            if "r.search.yahoo.com" in href:
                                ru_match = re.search(r'/RU=([^/]+)/', href)
                                if ru_match:
                                    href = urllib.parse.unquote(ru_match.group(1))

                            if href and href not in urls and "yahoo.com" not in href:
                                urls.append(href)
                            snippets_list.append(f"- {title}: {desc} ({href})")
            except Exception as e:
                import sys
                print(f"[web_search] Yahoo attempt failed: {e}", file=sys.stderr)

        if not snippets_list:
            return f"No search results found for '{query}'."

        # 3. Asynchronously fetch top 2 organic page contents in parallel
        top_urls = urls[:2]

        async def fetch_page(url: str):
            try:
                parsed_url = urllib.parse.urlparse(url)
                domain = parsed_url.netloc.replace("www.", "")
            except Exception:
                domain = url

            try:
                resp = await client.get(url, headers=headers, follow_redirects=True, timeout=6.0)
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    # Remove scripts, styles, header, footer, nav to get clean content
                    for element in soup(["script", "style", "header", "footer", "nav", "aside"]):
                        element.decompose()

                    text = soup.get_text(separator=" ")
                    # Clean whitespaces
                    cleaned_text = re.sub(r'\s+', ' ', text).strip()
                    # Truncate page content to keep 3B model context window healthy.
                    # 800 chars is ~200 tokens — enough for factual answers without
                    # overwhelming the model's reasoning budget.
                    truncated = cleaned_text[:800]
                    return f"[Source: {domain} ({url})]\n{truncated}"
            except Exception as e:
                import sys
                print(f"[web_search] Failed to fetch {url}: {e}", file=sys.stderr)
            return None

        page_contents = []
        if top_urls:
            import asyncio
            tasks = [fetch_page(u) for u in top_urls]
            fetched = await asyncio.gather(*tasks)
            page_contents = [f for f in fetched if f]

    # 4. Compile final context for the LLM
    context_parts = []
    context_parts.append(f"Web search results for: \"{query}\"")
    context_parts.append("Snippets:\n" + "\n".join(snippets_list))

    if page_contents:
        context_parts.append("\nDetailed Page Contents:\n" + "\n\n".join(page_contents))

    return "\n\n".join(context_parts)


