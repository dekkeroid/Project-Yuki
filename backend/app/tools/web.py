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
    
    encoded_query = urllib.parse.quote(query.strip())
    url = f"https://search.yahoo.com/search?p={encoded_query}"
    
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            html = response.read().decode('utf-8', errors='ignore')
            
            # Yahoo snippets look like: <div class="compText aGrid"> or class="compText"
            snippets = re.findall(r'<div[^>]*class="[^"]*compText[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
            
            if snippets:
                # Clean up HTML tags and filter UI clutter
                results = []
                for s in snippets:
                    clean = re.sub(r'<[^>]+>', '', s).strip()
                    clean = clean.replace("&quot;", '"').replace("&amp;", "&").replace("&apos;", "'")
                    
                    # Skip common UI clutter and metadata links under 20 chars
                    if len(clean) < 20 or "show more" in clean.lower() or "more results" in clean.lower() or "hide details" in clean.lower():
                        continue
                    results.append(clean)
                    if len(results) >= 3:
                        break
                
                if results:
                    return "\n".join([f"- {r}" for r in results])
                else:
                    return f"No direct search results found for '{query}'."
    except Exception as e:
        return f"Web search failed: {str(e)}"
