import urllib.parse
import urllib.request
import json
import re
import requests
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

def web_search(query: str) -> str:
    """
    Performs a web search, fetches page content for the top 2 organic URLs,
    and calls the local LLM to synthesize a direct factual overview.
    Falls back to organic snippets list on failure.
    """
    if not query:
        return "Please specify a query to search for."

    encoded_query = urllib.parse.quote(query.strip())
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }

    yahoo_html = None
    urls = []

    # 1. Fetch Yahoo Search HTML and extract top 2 organic URLs
    yahoo_url = f"https://search.yahoo.com/search?p={encoded_query}"
    try:
        req = urllib.request.Request(yahoo_url, headers=headers)
        with urllib.request.urlopen(req, timeout=4) as response:
            yahoo_html = response.read().decode('utf-8', errors='ignore')
            
            # Find organic links inside class="algo" elements
            algo_indices = [m.start() for m in re.finditer(r'class="[^"]*algo[^"]*"', yahoo_html)]
            for i in range(len(algo_indices)):
                start = algo_indices[i]
                end = algo_indices[i+1] if i + 1 < len(algo_indices) else len(yahoo_html)
                end = min(end, start + 3000)
                sub_html = yahoo_html[start:end]
                
                href_match = re.search(r'href="([^"]+)"', sub_html)
                if href_match:
                    href = href_match.group(1)
                    if "r.search.yahoo.com" in href:
                        ru_match = re.search(r'/RU=([^/]+)/', href)
                        if ru_match:
                            href = urllib.parse.unquote(ru_match.group(1))
                    
                    if not href.startswith('/') and "yahoo.com" not in href and href not in urls:
                        urls.append(href)
                        if len(urls) >= 2:
                            break
    except Exception:
        pass

    # 2. Fetch page content and call local LLM for synthesis
    if urls:
        combined_context = ""
        for idx, u in enumerate(urls):
            try:
                # Extract clean website domain name from URL
                try:
                    parsed_url = urllib.parse.urlparse(u)
                    domain = parsed_url.netloc.replace("www.", "")
                except Exception:
                    domain = u

                req = urllib.request.Request(u, headers=headers)
                with urllib.request.urlopen(req, timeout=4) as response:
                    html = response.read().decode('utf-8', errors='ignore')
                    cleaned = clean_html(html)
                    # Limit each page text to 2000 chars to speed up local LLM pre-fill
                    truncated = cleaned[:2000]
                    combined_context += f"[Source: {domain}]\n{truncated}\n\n"
            except Exception:
                pass  # Skip failed pages but try others

        if combined_context.strip():
            # Send to LM Studio
            try:
                payload = {
                    "model": config.LLM_MODEL,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a helpful web search helper. Your task is to look at the provided search page texts and answer the user's query directly and concisely based ONLY on the facts present in the texts. Attribute facts to the source website domain name (e.g. 'wise.com' or 'xe.com') instead of using generic indices. Do not invent any numbers or details. If the texts do not contain the answer, say you don't know."
                        },
                        {
                            "role": "user",
                            "content": f"User query: {query}\n\nWebpage content:\n{combined_context}"
                        }
                    ],
                    "temperature": 0.1,
                    "max_tokens": 150
                }
                resp = requests.post(f"{config.LMSTUDIO_URL}/v1/chat/completions", json=payload, timeout=25)
                resp.raise_for_status()
                resp_data = resp.json()
                synthesis = resp_data["choices"][0]["message"]["content"].strip()
                if synthesis and "don't know" not in synthesis.lower() and "do not know" not in synthesis.lower():
                    return f"[Overview] {synthesis}"
            except Exception:
                pass

    # 3. Fallback: Parse organic snippets from Yahoo HTML if fetched
    if yahoo_html:
        try:
            algo_indices = [m.start() for m in re.finditer(r'class="[^"]*algo[^"]*"', yahoo_html)]
            results = []
            for i in range(len(algo_indices)):
                start = algo_indices[i]
                end = algo_indices[i+1] if i + 1 < len(algo_indices) else len(yahoo_html)
                end = min(end, start + 3000)
                sub_html = yahoo_html[start:end]
                
                comp_match = re.search(r'<div[^>]*class="[^"]*compText[^"]*"[^>]*>(.*?)</div>', sub_html, re.DOTALL)
                if comp_match:
                    clean = re.sub(r'<[^>]+>', '', comp_match.group(1)).strip()
                    clean = clean.replace("&quot;", '"').replace("&amp;", "&").replace("&apos;", "'").replace("&#x27;", "'").replace("&#x2F;", "/")
                    clean = re.sub(r'\s+', ' ', clean)
                    if "Innovative ETP Provider" in clean or "Get In Touch" in clean or "More about" in clean or len(clean) < 30:
                        continue
                    results.append(clean)
                    if len(results) >= 4:
                        break
            if results:
                return "\n".join([f"- {r}" for r in results])
        except Exception:
            pass

    # 4. Secondary Fallback: Query DuckDuckGo HTML for snippets
    ddg_url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
    try:
        req = urllib.request.Request(ddg_url, headers=headers)
        with urllib.request.urlopen(req, timeout=4) as response:
            html = response.read().decode('utf-8', errors='ignore')
            if "anomaly" not in html and "captcha" not in html.lower():
                snippets = re.findall(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)
                if snippets:
                    results = []
                    for s in snippets:
                        clean = re.sub(r'<[^>]+>', '', s).strip()
                        clean = clean.replace("&quot;", '"').replace("&amp;", "&").replace("&apos;", "'").replace("&#x27;", "'").replace("&#x2F;", "/")
                        clean = re.sub(r'\s+', ' ', clean)
                        if len(clean) < 20:
                            continue
                        results.append(clean)
                        if len(results) >= 4:
                            break
                    if results:
                        return "\n".join([f"- {r}" for r in results])
    except Exception:
        pass

    return f"No direct search results found for '{query}'."

