import requests
from lxml import html
import re
import json
from typing import List, Dict, Union

# Playwright imports with error handling
try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
    print("[PLAYWRIGHT] Successfully imported")
except ImportError as e:
    PLAYWRIGHT_AVAILABLE = False
    print(f"[PLAYWRIGHT] Import failed: {e}")


def scrape_url(url: str, rules: List[str], mode: str = "requests") -> Dict[str, Union[str, List[str]]]:
    print(f"[SCRAPE_MODE] → {mode}")
    print(f"[TARGET_URL] → {url}")
    print(f"[RULES] → {rules}")
    print(f"[PLAYWRIGHT_AVAILABLE] → {PLAYWRIGHT_AVAILABLE}")
    
    # Enhanced headers
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }

    text = ''
    tree = None
    is_json = False

    try:
        if mode == "playwright":
            if not PLAYWRIGHT_AVAILABLE:
                return {"error": "Playwright not available. Please install: pip install playwright && playwright install"}
            
            print("[PLAYWRIGHT] Starting browser...")
            try:
                with sync_playwright() as p:
                    # Launch with more options for stability
                    browser = p.chromium.launch(
                        headless=True,
                        args=[
                            '--no-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-gpu',
                            '--disable-web-security',
                            '--disable-features=VizDisplayCompositor'
                        ]
                    )
                    
                    # Create context with headers
                    context = browser.new_context(
                        user_agent=headers['User-Agent'],
                        viewport={'width': 1920, 'height': 1080},
                        ignore_https_errors=True
                    )
                    
                    page = context.new_page()
                    
                    print(f"[PLAYWRIGHT] Navigating to: {url}")
                    
                    # Navigate with better error handling
                    try:
                        response = page.goto(
                            url, 
                            timeout=30000,
                            wait_until='domcontentloaded'
                        )
                        
                        if response is None:
                            browser.close()
                            return {"error": "Failed to load page - no response"}
                        
                        if response.status >= 400:
                            browser.close()
                            return {"error": f"HTTP {response.status}: Failed to load page"}
                        
                        print(f"[PLAYWRIGHT] Page loaded with status: {response.status}")
                        
                        # Wait for any dynamic content
                        page.wait_for_timeout(2000)
                        
                        # Get content
                        text = page.content()
                        
                        # Check content type more safely
                        try:
                            content_type = page.evaluate("() => document.contentType || document.querySelector('meta[http-equiv=\"content-type\"]')?.content || ''")
                            is_json = 'application/json' in str(content_type).lower()
                        except Exception:
                            is_json = False
                        
                        print(f"[PLAYWRIGHT] Content type detected: {content_type}, is_json: {is_json}")
                        print(f"[PLAYWRIGHT] Content length: {len(text)}")
                        
                        if not is_json and text:
                            try:
                                tree = html.fromstring(text.encode('utf-8'))
                                print("[PLAYWRIGHT] HTML tree parsed successfully")
                            except Exception as e:
                                print(f"[PLAYWRIGHT] HTML parse error: {e}")
                                tree = None
                        
                    except Exception as nav_error:
                        browser.close()
                        return {"error": f"Navigation failed: {str(nav_error)}"}
                    
                    browser.close()
                    print("[PLAYWRIGHT] Browser closed successfully")
                    
            except Exception as e:
                print(f"[PLAYWRIGHT] Error: {str(e)}")
                return {"error": f"Playwright error: {str(e)}"}
        
        else:  # Default to requests
            print("[REQUESTS] Making HTTP request...")
            try:
                response = requests.get(url, headers=headers, timeout=30)
                response.raise_for_status()
                
                content_type = response.headers.get('Content-Type', '').lower()
                is_json = 'application/json' in content_type
                text = response.text
                
                print(f"[REQUESTS] Status: {response.status_code}")
                print(f"[REQUESTS] Content type: {content_type}, is_json: {is_json}")
                print(f"[REQUESTS] Content length: {len(text)}")
                
                if not is_json and text:
                    try:
                        tree = html.fromstring(response.content)
                        print("[REQUESTS] HTML tree parsed successfully")
                    except Exception as e:
                        print(f"[REQUESTS] HTML parse error: {e}")
                        tree = None
                        
            except Exception as e:
                print(f"[REQUESTS] Error: {str(e)}")
                return {"error": f"Requests error: {str(e)}"}
    
    except Exception as e:
        print(f"[GENERAL] Unexpected error: {str(e)}")
        return {"error": f"Unexpected scraping error: {str(e)}"}

    # Validate we got content
    if not text:
        return {"error": "No content retrieved from URL"}

    results = {}
    print(f"[EXTRACTION] Processing {len(rules)} rules...")

    for i, rule in enumerate(rules):
        print(f"[RULE {i+1}] Processing: {rule}")
        
        if ':' in rule:
            key, expr = map(str.strip, rule.split(':', 1))
        else:
            key, expr = rule.strip(), None

        if not key:
            results[f"rule_{i+1}"] = "Empty key name"
            continue

        try:
            if is_json:
                print(f"[JSON MODE] Extracting {key} with expression: {expr}")
                try:
                    data = json.loads(text)
                    if not expr:
                        results[key] = data.get(key, 'No data found')
                    else:
                        # Try JSONPath-like extraction
                        if expr.startswith('$.'):
                            path_parts = expr[2:].split('.')
                            value = data
                            for part in path_parts:
                                if '[' in part and ']' in part:
                                    array_name, index_part = part.split('[', 1)
                                    index = int(index_part.rstrip(']'))
                                    value = value[array_name][index]
                                else:
                                    value = value[part]
                            results[key] = str(value)
                        else:
                            # Fallback to regex
                            matches = re.findall(expr, text)
                            results[key] = ', '.join(matches) if matches else 'No matches found'
                except json.JSONDecodeError as e:
                    results[key] = f"JSON parse error: {e}"
                except (KeyError, IndexError, TypeError) as e:
                    results[key] = f"JSON extraction error: {e}"
                except Exception as e:
                    results[key] = f"JSON error: {e}"
            else:
                # HTML/XML mode
                if expr:
                    # XPath expressions
                    if expr.startswith('//') or expr.startswith('.//') or expr.startswith('/') or expr.startswith('('):
                        print(f"[XPATH] Extracting {key} with XPath: {expr}")
                        if tree is None:
                            results[key] = 'HTML parse error - invalid content'
                            continue
                        try:
                            elems = tree.xpath(expr)
                            if not elems:
                                results[key] = 'No data found'
                            elif len(elems) == 1:
                                if hasattr(elems[0], 'text_content'):
                                    results[key] = elems[0].text_content().strip()
                                else:
                                    results[key] = str(elems[0]).strip()
                            else:
                                # Multiple elements - return as list
                                extracted = []
                                for elem in elems[:10]:  # Limit to first 10
                                    if hasattr(elem, 'text_content'):
                                        extracted.append(elem.text_content().strip())
                                    else:
                                        extracted.append(str(elem).strip())
                                results[key] = extracted
                        except Exception as e:
                            results[key] = f"XPath error: {e}"
                    
                    # CSS Selectors (basic support)
                    elif any(char in expr for char in ['#', '[', '>', '~', '+']):
                        print(f"[CSS] Extracting {key} with CSS: {expr}")
                        if tree is None:
                            results[key] = 'HTML parse error - invalid content'
                            continue
                        try:
                            elems = tree.cssselect(expr)
                            if not elems:
                                results[key] = 'No data found'
                            elif len(elems) == 1:
                                results[key] = elems[0].text_content().strip()
                            else:
                                results[key] = [elem.text_content().strip() for elem in elems[:10]]
                        except Exception as e:
                            results[key] = f"CSS selector error: {e}"
                    
                    # Regex fallback
                    else:
                        print(f"[REGEX] Extracting {key} with regex: {expr}")
                        try:
                            matches = re.findall(expr, text, re.IGNORECASE | re.DOTALL)
                            if matches:
                                if len(matches) == 1:
                                    results[key] = matches[0] if isinstance(matches[0], str) else str(matches[0])
                                else:
                                    results[key] = matches[:10]  # Limit results
                            else:
                                results[key] = 'No matches found'
                        except Exception as e:
                            results[key] = f"Regex error: {e}"
                else:
                    results[key] = 'No extraction rule provided'
        
        except Exception as e:
            results[key] = f"Extraction error: {str(e)}"
            print(f"[ERROR] Rule {i+1} failed: {e}")

    print(f"[SCRAPE RESULT] Extracted {len(results)} fields")
    print("[RESULTS]", results)
    return results