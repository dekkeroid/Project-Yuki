import urllib.parse
import urllib.request
import json
import re

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

def web_search(query: str) -> str:
    """
    Performs a web search to look up information.
    """
    if not query:
        return "Please specify a query to search for."
    
    # We will use DuckDuckGo's Lite HTML or API endpoint for a fast search fallback
    encoded_query = urllib.parse.quote(query.strip())
    url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=5) as response:
            html = response.read().decode('utf-8', errors='ignore')
            
            # Simple regex parser to extract DuckDuckGo Lite search results
            # Result links look like: <a class="result__snippet" ...>Text</a>
            snippets = re.findall(r'<a class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)
            
            if not snippets:
                # Try finding general result descriptions
                snippets = re.findall(r'<td class="result-snippet"[^>]*>(.*?)</td>', html, re.DOTALL)
                
            if snippets:
                # Clean up HTML tags
                results = []
                for s in snippets[:3]:
                    clean = re.sub(r'<[^>]+>', '', s).strip()
                    clean = clean.replace("&quot;", '"').replace("&amp;", "&").replace("&apos;", "'")
                    results.append(clean)
                return "\n".join([f"- {r}" for r in results])
            else:
                return f"No direct search results found for '{query}'."
    except Exception as e:
        return f"Web search failed: {str(e)}"
