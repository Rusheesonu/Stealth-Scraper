import requests
from lxml import html
import re
import json
import random
import time
from typing import List, Dict, Union

# Playwright imports with error handling
try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
    print("[PLAYWRIGHT] Successfully imported")
except ImportError as e:
    PLAYWRIGHT_AVAILABLE = False
    print(f"[PLAYWRIGHT] Import failed: {e}")

# --- Stealth chromium args for Playwright ---
STEALTH_CHROMIUM_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process,TranslateUI,BlinkGenPropertyTrees,AutomationControlled',
    '--disable-blink-features=AutomationControlled',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--disable-translate',
    '--disable-infobars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--ignore-certificate-errors',
    '--ignore-certificate-errors-spki-list',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-extensions-with-background-pages',
    '--disable-features=Translate,BackForwardCache,AcceptCHFrame,OptimizationHints',
    '--disable-domain-reliability',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-notifications',
    '--disable-print-preview',
    '--disable-speech-api',
    '--hide-scrollbars',
    '--metrics-recording-only',
    '--no-zygote',
    '--use-mock-keychain',
    '--window-position=0,0',
]

# Some user agent options for rotation
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
]

TIMEZONES = ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney']

def get_random_headers():
    ua = random.choice(USER_AGENTS)
    return {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'DNT': '1',  # Do Not Track header
    }

def scrape_url(url: str, rules: List[str], mode: str = "requests") -> Dict[str, Union[str, List[str]]]:
    print(f"[SCRAPE_MODE] → {mode}")
    print(f"[TARGET_URL] → {url}")
    print(f"[RULES] → {rules}")
    print(f"[PLAYWRIGHT_AVAILABLE] → {PLAYWRIGHT_AVAILABLE}")

    headers = get_random_headers()
    text = ''
    tree = None
    is_json = False

    try:
        if mode == "playwright":
            if not PLAYWRIGHT_AVAILABLE:
                return {"error": "Playwright not available. Please install: pip install playwright && playwright install"}

            print("[PLAYWRIGHT] Starting browser with stealth args...")
            try:
                with sync_playwright() as p:
                    viewport_width = random.choice([1200, 1366, 1440, 1600, 1920])
                    viewport_height = random.choice([700, 768, 800, 900, 1080])
                    timezone = random.choice(TIMEZONES)

                    browser = p.chromium.launch(
                        headless=True,
                        args=STEALTH_CHROMIUM_ARGS,
                        ignore_default_args=["--enable-automation"],
                        chromium_sandbox=False,
                    )

                    context = browser.new_context(
                        user_agent=headers['User-Agent'],
                        viewport={'width': viewport_width, 'height': viewport_height},
                        timezone_id=timezone,
                        locale='en-US',
                        ignore_https_errors=True,
                    )

                    page = context.new_page()

                    # Stealth JS patches before any scripts run
                    page.add_init_script("""
                        Object.defineProperty(navigator, 'webdriver', { get: () => false });
                        Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
                        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                        window.chrome = { runtime: {} };
                        const originalQuery = window.navigator.permissions.query;
                        window.navigator.permissions.query = parameters =>
                            parameters.name === 'notifications' ?
                            Promise.resolve({ state: Notification.permission }) :
                            originalQuery(parameters);
                        const getParameter = WebGLRenderingContext.prototype.getParameter;
                        WebGLRenderingContext.prototype.getParameter = function(parameter) {
                            if(parameter === 37445) return 'Intel Inc.';
                            if(parameter === 37446) return 'Intel Iris OpenGL Engine';
                            return getParameter(parameter);
                        };
                    """)

                    # Random delay before navigation
                    delay = random.uniform(1.5, 3.5)
                    print(f"[PLAYWRIGHT] Sleeping before navigation: {delay:.2f}s")
                    time.sleep(delay)

                    print(f"[PLAYWRIGHT] Navigating to: {url}")
                    response = page.goto(url, timeout=30000, wait_until='domcontentloaded')

                    if response is None:
                        browser.close()
                        return {"error": "Failed to load page - no response"}

                    if response.status >= 400:
                        browser.close()
                        return {"error": f"HTTP {response.status}: Failed to load page"}

                    print(f"[PLAYWRIGHT] Page loaded with status: {response.status}")

                    # Wait for dynamic content to stabilize
                    time.sleep(random.uniform(2, 4))

                    text = page.content()

                    # Try detect content type safely
                    try:
                        content_type = page.evaluate("() => document.contentType || document.querySelector('meta[http-equiv=\"content-type\"]')?.content || ''")
                        is_json = 'application/json' in str(content_type).lower()
                    except Exception:
                        content_type = ''
                        is_json = False

                    print(f"[PLAYWRIGHT] Content-Type: {content_type}, is_json={is_json}")
                    print(f"[PLAYWRIGHT] Content length: {len(text)}")

                    if not is_json and text:
                        try:
                            tree = html.fromstring(text.encode('utf-8'))
                            print("[PLAYWRIGHT] Parsed HTML tree successfully")
                        except Exception as e:
                            print(f"[PLAYWRIGHT] HTML parse error: {e}")
                            tree = None

                    browser.close()
                    print("[PLAYWRIGHT] Browser closed")

            except Exception as e:
                print(f"[PLAYWRIGHT] Error: {str(e)}")
                return {"error": f"Playwright error: {str(e)}"}

        else:  # fallback to requests
            print("[REQUESTS] Making HTTP request...")
            try:
                response = requests.get(url, headers=headers, timeout=30)
                response.raise_for_status()

                content_type = response.headers.get('Content-Type', '').lower()
                is_json = 'application/json' in content_type
                text = response.text

                print(f"[REQUESTS] Status: {response.status_code}")
                print(f"[REQUESTS] Content-Type: {content_type}, is_json={is_json}")
                print(f"[REQUESTS] Content length: {len(text)}")

                if not is_json and text:
                    try:
                        tree = html.fromstring(response.content)
                        print("[REQUESTS] Parsed HTML tree successfully")
                    except Exception as e:
                        print(f"[REQUESTS] HTML parse error: {e}")
                        tree = None

            except Exception as e:
                print(f"[REQUESTS] Error: {str(e)}")
                return {"error": f"Requests error: {str(e)}"}

    except Exception as e:
        print(f"[GENERAL] Unexpected error: {str(e)}")
        return {"error": f"Unexpected scraping error: {str(e)}"}

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
                        # JSONPath-like
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
                            matches = re.findall(expr, text)
                            results[key] = ', '.join(matches) if matches else 'No matches found'
                except json.JSONDecodeError as e:
                    results[key] = f"JSON parse error: {e}"
                except (KeyError, IndexError, TypeError) as e:
                    results[key] = f"JSON extraction error: {e}"
                except Exception as e:
                    results[key] = f"JSON error: {e}"
            else:
                if expr:
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
                                extracted = []
                                for elem in elems[:10]:
                                    if hasattr(elem, 'text_content'):
                                        extracted.append(elem.text_content().strip())
                                    else:
                                        extracted.append(str(elem).strip())
                                results[key] = extracted
                        except Exception as e:
                            results[key] = f"XPath error: {e}"
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
                                extracted = [e.text_content().strip() for e in elems[:10]]
                                results[key] = extracted
                        except Exception as e:
                            results[key] = f"CSS selector error: {e}"
                    else:
                        print(f"[REGEX] Extracting {key} with regex: {expr}")
                        matches = re.findall(expr, text)
                        if not matches:
                            results[key] = 'No matches found'
                        elif len(matches) == 1:
                            results[key] = matches[0].strip() if isinstance(matches[0], str) else str(matches[0])
                        else:
                            results[key] = matches[:10]
                else:
                    print(f"[NO_EXPRESSION] Extracting {key} with simple regex")
                    matches = re.findall(key, text)
                    if not matches:
                        results[key] = 'No matches found'
                    elif len(matches) == 1:
                        results[key] = matches[0].strip() if isinstance(matches[0], str) else str(matches[0])
                    else:
                        results[key] = matches[:10]
        except Exception as e:
            results[key] = f"Extraction error: {e}"

    print(f"[RESULTS] Extraction complete")
    return results


# Example usage:
if __name__ == '__main__':
    url = "https://example.com"
    rules = [
        "title://title/text()",
        "header: //h1/text()",
        "paragraphs: //p/text()",
        "emails:\\b[\\w.%+-]+@[\\w.-]+\\.[a-zA-Z]{2,6}\\b"
    ]
    mode = "playwright"  # or "requests"

    result = scrape_url(url, rules, mode)
    print(json.dumps(result, indent=2))
