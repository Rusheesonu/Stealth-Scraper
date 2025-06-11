import requests
from lxml import html
import re
import json
import random
import time
import base64
import hashlib
from typing import List, Dict, Union

# Playwright imports with error handling
try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
    print("[PLAYWRIGHT] Successfully imported")
except ImportError as e:
    PLAYWRIGHT_AVAILABLE = False
    print(f"[PLAYWRIGHT] Import failed: {e}")

# --- Ultra Stealth chromium args ---
ULTRA_STEALTH_CHROMIUM_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor,IsolateOrigins,site-per-process,TranslateUI,BlinkGenPropertyTrees,AutomationControlled,MediaRouter,OptimizationHints,RendererCodeIntegrity',
    '--disable-blink-features=AutomationControlled',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--disable-translate',
    '--disable-infobars',
    '--disable-component-update',
    '--disable-client-side-phishing-detection',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-notifications',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-breakpad',
    '--disable-canvas-aa',
    '--disable-2d-canvas-clip-aa',
    '--disable-gl-drawing-for-tests',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-zygote',
    '--disable-background-networking',
    '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints,AudioServiceOutOfProcess,IPH_PasswordsAccountStorageIph,TranslateSubFrames,LazyFrameLoading,GlobalMediaControls,DestroyProfileOnBrowserClose,MediaRouter,DialMediaRouteProvider,AcceptCHFrame,AutoExpandDetailsElement,CertificateTransparencyComponentUpdater,AvoidUnnecessaryBeforeUnloadCheckSync,Conversions',
    '--disable-print-preview',
    '--disable-speech-api',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-logging',
    '--disable-gl-extensions',
    '--disable-plugins',
    '--disable-image-animations',
    '--disable-device-discovery-notifications',
    '--use-mock-keychain',
    '--disable-background-mode',
    '--force-color-profile=srgb',
    '--metrics-recording-only',
    '--disable-field-trial-config',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-ipc-flooding-protection',
    '--disable-shared-workers',
    '--disable-checker-imaging',
    '--disable-new-content-rendering-timeout',
    '--disable-threaded-animation',
    '--disable-threaded-scrolling',
    '--disable-in-process-stack-traces',
    '--disable-histogram-customizer',
    '--disable-plugin-power-saver',
    '--disable-message-loop',
    '--renderer-process-limit=1',
    '--extension-process=1',
    '--aggressive-cache-discard',
    '--memory-pressure-off',
    '--max_old_space_size=4096',
    '--no-pings',
    '--no-referrers',
    '--safebrowsing-disable-auto-update',
    '--disable-sync-preferences',
    '--disable-sync-synced-notifications',
    '--disable-office-editing-component-extension',
    '--disable-file-system',
    '--disable-permissions-api',
    '--disable-presentation-api',
    '--disable-remote-fonts',
    '--disable-speech-synthesis-api',
    '--disable-threaded-compositing',
    '--disable-webusb',
    '--disable-webvr',
    '--disable-webgl',
    '--disable-webgl2',
    '--disable-3d-apis',
    '--disable-webrtc',
    '--disable-webrtc-multiple-routes',
    '--disable-webrtc-hw-decoding',
    '--disable-webrtc-hw-encoding',
    '--disable-webrtc-encryption',
    '--window-position=0,0',
    '--force-device-scale-factor=1',
    '--high-dpi-support=1',
    '--force-color-profile=srgb',
    '--disable-lcd-text',
    '--disable-prefer-compositing-to-lcd-text',
]

# Massive realistic user agent pool with fingerprint consistency
USER_AGENTS_POOL = [
    # Chrome Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    
    # Chrome macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    
    # Chrome Linux
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    # Safari macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    
    # Firefox Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    
    # Firefox macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
    
    # Edge Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
]

TIMEZONES = [
    'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'America/Denver',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Singapore',
    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
    'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo', 'America/Mexico_City'
]

SCREEN_RESOLUTIONS = [
    {'width': 1920, 'height': 1080}, {'width': 1366, 'height': 768}, {'width': 1440, 'height': 900},
    {'width': 1536, 'height': 864}, {'width': 1600, 'height': 900}, {'width': 1680, 'height': 1050},
    {'width': 1280, 'height': 720}, {'width': 1280, 'height': 800}, {'width': 2560, 'height': 1440},
    {'width': 3840, 'height': 2160}, {'width': 1920, 'height': 1200}, {'width': 2048, 'height': 1152}
]

def generate_canvas_fingerprint():
    """Generate a realistic canvas fingerprint"""
    fonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Comic Sans MS', 'Trebuchet MS', 'Arial Black', 'Impact']
    text = f"BrowserLeaks,com <canvas> {random.randint(1, 100)} {random.choice(fonts)}"
    return hashlib.md5(text.encode()).hexdigest()[:8]

def generate_webgl_fingerprint():
    """Generate WebGL fingerprint"""
    vendors = ['Intel Inc.', 'NVIDIA Corporation', 'ATI Technologies Inc.', 'ARM', 'Qualcomm']
    renderers = [
        'Intel Iris OpenGL Engine', 'NVIDIA GeForce GTX 1060', 'AMD Radeon RX 580',
        'Intel UHD Graphics 620', 'NVIDIA GeForce RTX 3060', 'AMD Radeon RX 6600 XT',
        'Intel HD Graphics 4000', 'Apple M1', 'Apple M2'
    ]
    return random.choice(vendors), random.choice(renderers)

def get_ultra_random_headers():
    """Generate ultra-realistic headers with proper entropy"""
    ua = random.choice(USER_AGENTS_POOL)
    
    # Extract browser info from UA for consistency
    is_chrome = 'Chrome' in ua
    is_firefox = 'Firefox' in ua
    is_safari = 'Safari' in ua and 'Chrome' not in ua
    is_edge = 'Edg' in ua
    
    headers = {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': random.choice([
            'en-US,en;q=0.9', 'en-GB,en;q=0.9', 'en-US,en;q=0.8,es;q=0.6',
            'en-US,en;q=0.9,fr;q=0.8', 'en-US,en;q=0.9,de;q=0.8',
            'en-US,en;q=0.9,ja;q=0.8', 'en-US,en;q=0.9,zh-CN;q=0.8'
        ]),
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': random.choice(['none', 'same-origin', 'same-site', 'cross-site']),
        'Sec-Fetch-User': '?1',
        'Cache-Control': random.choice(['no-cache', 'max-age=0', 'no-store']),
        'DNT': random.choice(['1', '0']),
    }
    
    # Browser-specific headers
    if is_chrome or is_edge:
        headers['sec-ch-ua'] = f'"Not_A Brand";v="8", "Chromium";v="{random.randint(110, 121)}", "Google Chrome";v="{random.randint(110, 121)}"'
        headers['sec-ch-ua-mobile'] = '?0'
        headers['sec-ch-ua-platform'] = f'"{random.choice(["Windows", "macOS", "Linux"])}"'
        headers['sec-ch-ua-platform-version'] = f'"{random.randint(10, 15)}.{random.randint(0, 5)}.0"'
    
    # Add random optional headers
    if random.random() < 0.3:
        headers['Priority'] = random.choice(['u=0, i', 'u=1, i'])
    
    if random.random() < 0.2:
        headers['Purpose'] = 'prefetch'
    
    return headers

# Ultra Stealth JavaScript - This is the magic!
ULTRA_STEALTH_JS = """
// ==== ULTIMATE STEALTH SCRIPT ====
(function() {
    'use strict';
    
    console.log('[STEALTH] Ultra stealth mode activated');
    
    // 1. WEBDRIVER DETECTION BYPASS
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true
    });
    
    // Remove webdriver from window
    delete window.webdriver;
    
    // 2. AUTOMATION DETECTION BYPASS
    // Override automation flags
    Object.defineProperty(window, 'chrome', {
        get: () => ({
            runtime: {
                onConnect: undefined,
                onMessage: undefined,
                connect: function() { return {postMessage: function(){}, onMessage: {addListener: function(){}}} }
            },
            csi: function() {},
            loadTimes: function() { return {
                requestTime: Date.now() / 1000 - Math.random(),
                startLoadTime: Date.now() / 1000 - Math.random(),
                commitLoadTime: Date.now() / 1000 - Math.random(),
                finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
                finishLoadTime: Date.now() / 1000 - Math.random(),
                firstPaintTime: Date.now() / 1000 - Math.random(),
                firstPaintAfterLoadTime: Date.now() / 1000 - Math.random(),
                navigationType: 'Other',
                wasFetchedViaSpdy: false,
                wasNpnNegotiated: false,
                npnNegotiatedProtocol: 'unknown',
                wasAlternateProtocolAvailable: false,
                connectionInfo: 'unknown'
            }},
            app: {
                isInstalled: false,
                InstallState: {
                    DISABLED: 'disabled',
                    INSTALLED: 'installed',
                    NOT_INSTALLED: 'not_installed'
                },
                RunningState: {
                    CANNOT_RUN: 'cannot_run',
                    READY_TO_RUN: 'ready_to_run',
                    RUNNING: 'running'
                }
            }
        }),
        configurable: true
    });
    
    // 3. PERMISSION QUERIES BYPASS
    const originalQuery = navigator.permissions.query;
    navigator.permissions.query = function(parameters) {
        if (parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
        }
        return originalQuery ? originalQuery.call(this, parameters) : Promise.resolve({ state: 'granted' });
    };
    
    // 4. PLUGINS FINGERPRINTING BYPASS
    Object.defineProperty(navigator, 'plugins', {
        get: () => {
            const plugins = [];
            const pluginData = [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
            ];
            
            pluginData.forEach((data, index) => {
                plugins[index] = {
                    ...data,
                    length: pluginData.length,
                    item: function(i) { return this[i] },
                    namedItem: function(name) { return this[name] || null },
                    refresh: function() {}
                };
            });
            
            Object.setPrototypeOf(plugins, PluginArray.prototype);
            return plugins;
        },
        configurable: true
    });
    
    // 5. LANGUAGES BYPASS
    Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true
    });
    
    // 6. WEBGL FINGERPRINTING BYPASS
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // VENDOR
        if (parameter === 37445) {
            return 'Intel Inc.';
        }
        // RENDERER  
        if (parameter === 37446) {
            return 'Intel Iris OpenGL Engine';
        }
        // Add more parameter spoofing
        if (parameter === 7936) { // VERSION
            return 'OpenGL ES 2.0 (ANGLE 2.1.0 (git hash: unknown))';
        }
        if (parameter === 7937) { // SHADING_LANGUAGE_VERSION
            return 'OpenGL ES GLSL ES 1.0 (ANGLE 2.1.0 (git hash: unknown))';
        }
        return getParameter.call(this, parameter);
    };
    
    // 7. CANVAS FINGERPRINTING BYPASS
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
        // Add subtle noise to canvas
        const ctx = this.getContext('2d');
        if (ctx) {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
                if (Math.random() < 0.001) {
                    imageData.data[i] = Math.floor(Math.random() * 256);
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }
        return originalToDataURL.apply(this, args);
    };
    
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        const imageData = originalGetImageData.apply(this, args);
        // Add minimal noise
        for (let i = 0; i < imageData.data.length; i += 100) {
            if (Math.random() < 0.01) {
                imageData.data[i] = Math.floor(Math.random() * 256);
            }
        }
        return imageData;
    };
    
    // 8. TIMING ATTACKS BYPASS
    const originalPerformanceNow = Performance.prototype.now;
    Performance.prototype.now = function() {
        return originalPerformanceNow.call(this) + Math.random() * 0.1;
    };
    
    // 9. SCREEN RESOLUTION CONSISTENCY
    Object.defineProperty(screen, 'availWidth', {
        get: () => screen.width,
        configurable: true
    });
    
    Object.defineProperty(screen, 'availHeight', {
        get: () => screen.height - 40, // Account for taskbar
        configurable: true
    });
    
    // 10. MEDIA DEVICES BYPASS
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
        navigator.mediaDevices.enumerateDevices = function() {
            return originalEnumerateDevices.call(this).then(devices => {
                return devices.map(device => ({
                    ...device,
                    label: '',
                    deviceId: 'default'
                }));
            });
        };
    }
    
    // 11. BATTERY API BYPASS
    if (navigator.getBattery) {
        navigator.getBattery = function() {
            return Promise.resolve({
                charging: true,
                chargingTime: 0,
                dischargingTime: Infinity,
                level: Math.random(),
                addEventListener: function() {},
                removeEventListener: function() {},
                dispatchEvent: function() { return true; }
            });
        };
    }
    
    // 12. GEOLOCATION BYPASS
    if (navigator.geolocation) {
        const originalGetCurrentPosition = navigator.geolocation.getCurrentPosition;
        const originalWatchPosition = navigator.geolocation.watchPosition;
        
        navigator.geolocation.getCurrentPosition = function(success, error, options) {
            if (error) {
                error({ code: 1, message: 'User denied the request for Geolocation.' });
            }
        };
        
        navigator.geolocation.watchPosition = function(success, error, options) {
            if (error) {
                error({ code: 1, message: 'User denied the request for Geolocation.' });
            }
            return 0;
        };
    }
    
    // 13. MOUSE MOVEMENT SIMULATION
    let mouseMovements = 0;
    document.addEventListener('mousemove', function() {
        mouseMovements++;
    });
    
    // Simulate human-like mouse movements
    setInterval(() => {
        if (mouseMovements === 0 && Math.random() < 0.1) {
            const event = new MouseEvent('mousemove', {
                clientX: Math.random() * window.innerWidth,
                clientY: Math.random() * window.innerHeight,
                bubbles: true
            });
            document.dispatchEvent(event);
        }
        mouseMovements = 0;
    }, 5000);
    
    // 14. IFRAME DETECTION BYPASS
    Object.defineProperty(window, 'top', {
        get: () => window,
        configurable: true
    });
    
    Object.defineProperty(window, 'parent', {
        get: () => window,
        configurable: true
    });
    
    // 15. HEADLESS DETECTION BYPASS
    Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => Math.max(2, Math.floor(Math.random() * 8) + 1),
        configurable: true
    });
    
    Object.defineProperty(navigator, 'deviceMemory', {
        get: () => [2, 4, 8][Math.floor(Math.random() * 3)],
        configurable: true
    });
    
    // 16. CONNECTION INFORMATION
    Object.defineProperty(navigator, 'connection', {
        get: () => ({
            effectiveType: '4g',
            downlink: 2.0 + Math.random() * 8,
            rtt: Math.floor(Math.random() * 100) + 50,
            saveData: false
        }),
        configurable: true
    });
    
    // 17. USER ACTIVATION BYPASS
    Object.defineProperty(navigator, 'userActivation', {
        get: () => ({
            hasBeenActive: true,
            isActive: true
        }),
        configurable: true
    });
    
    // 18. NOTIFICATION PERMISSION
    Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
        configurable: true
    });
    
    // 19. SPEECH SYNTHESIS BYPASS
    if (window.speechSynthesis) {
        Object.defineProperty(window.speechSynthesis, 'getVoices', {
            value: () => [],
            configurable: true
        });
    }
    
    // 20. ADD REALISTIC ERRORS AND WARNINGS
    const originalError = console.error;
    const originalWarn = console.warn;
    
    // Inject some realistic browser warnings
    setTimeout(() => {
        if (Math.random() < 0.3) {
            originalWarn.call(console, 'The resource was preloaded using link preload but not used within a few seconds.');
        }
    }, Math.random() * 3000 + 1000);
    
    setTimeout(() => {
        if (Math.random() < 0.2) {
            originalWarn.call(console, 'A cookie associated with a cross-site resource was set without the `SameSite` attribute.');
        }
    }, Math.random() * 5000 + 2000);
    
    // 21. MONKEY PATCH COMMON DETECTION METHODS
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        // Don't block, but make it less detectable
        return originalAddEventListener.call(this, type, listener, options);
    };
    
    // 22. MEMORY USAGE REALISM
    Object.defineProperty(performance, 'memory', {
        get: () => ({
            usedJSHeapSize: Math.floor(Math.random() * 50000000) + 10000000,
            totalJSHeapSize: Math.floor(Math.random() * 100000000) + 50000000,
            jsHeapSizeLimit: 2172649472
        }),
        configurable: true
    });
    
    // 23. TIMEZONE CONSISTENCY
    const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function() {
        // Return consistent timezone offset
        return originalGetTimezoneOffset.call(this);
    };
    
    console.log('[STEALTH] All bypasses activated successfully');
    
})();

// Additional stealth for specific detection methods
(function() {
    // Proxy trap for common detection patterns
    const handler = {
        get: function(target, prop) {
            if (prop === 'webdriver' || prop === '__webdriver_script_fn' || prop === '__driver_evaluate' || prop === '__webdriver_evaluate' || prop === '__selenium_evaluate' || prop === '__fxdriver_evaluate' || prop === '__driver_unwrapped' || prop === '__webdriver_unwrapped' || prop === '__selenium_unwrapped' || prop === '__fxdriver_unwrapped' || prop === '_Selenium_IDE_Recorder' || prop === '_selenium' || prop === 'calledSelenium' || prop === '$cdc_asdjflasutopfhvcZLmcfl_' || prop === '$chrome_asyncScriptInfo' || prop === '__$webdriverAsyncExecutor') {
                return undefined;
            }
            return target[prop];
        }
    };
    
    window = new Proxy(window, handler);
    document = new Proxy(document, handler);
})();
"""

def get_human_like_delays():
    """Generate human-like delays"""
    return {
        'navigation_delay': random.uniform(2.0, 5.0),
        'interaction_delay': random.uniform(0.5, 2.0),
        'scroll_delay': random.uniform(0.3, 1.5),
        'typing_delay': random.uniform(0.1, 0.3)
    }

def scrape_url(url: str, rules: List[str], mode: str = "requests") -> Dict[str, Union[str, List[str]]]:
    print(f"[ULTRA_STEALTH] Mode: {mode}")
    print(f"[TARGET] URL: {url}")
    print(f"[RULES] Count: {len(rules)}")
    print(f"[PLAYWRIGHT] Available: {PLAYWRIGHT_AVAILABLE}")

    headers = get_ultra_random_headers()
    text = ''
    tree = None
    is_json = False

    try:
        if mode == "playwright":
            if not PLAYWRIGHT_AVAILABLE:
                return {"error": "Playwright not available. Install with: pip install playwright && playwright install"}

            print("[ULTRA_STEALTH] Launching ultra-stealth browser...")
            
            try:
                with sync_playwright() as p:
                    # Random screen resolution for consistency
                    resolution = random.choice(SCREEN_RESOLUTIONS)
                    timezone = random.choice(TIMEZONES)
                    canvas_fp = generate_canvas_fingerprint()
                    webgl_vendor, webgl_renderer = generate_webgl_fingerprint()
                    
                    print(f"[FINGERPRINT] Resolution: {resolution['width']}x{resolution['height']}")
                    print(f"[FINGERPRINT] Timezone: {timezone}")
                    print(f"[FINGERPRINT] Canvas: {canvas_fp}")
                    print(f"[FINGERPRINT] WebGL: {webgl_vendor} / {webgl_renderer}")

                    # Launch with ultra stealth args
                    # Launch with ultra stealth args
                    browser = p.chromium.launch(
                        headless=True,
                        args=ULTRA_STEALTH_CHROMIUM_ARGS,
                        ignore_default_args=[
                            '--enable-automation',
                            '--enable-blink-features=AutomationControlled'
                        ]
                    )
                    
                    # Create context with realistic fingerprint
                    context = browser.new_context(
                        user_agent=headers['User-Agent'],
                        viewport={'width': resolution['width'], 'height': resolution['height']},
                        screen={'width': resolution['width'], 'height': resolution['height']},
                        timezone_id=timezone,
                        locale='en-US',
                        permissions=['geolocation'],
                        geolocation={'latitude': 40.7128 + random.uniform(-0.1, 0.1), 'longitude': -74.0060 + random.uniform(-0.1, 0.1)},
                        color_scheme='light',
                        extra_http_headers=headers,
                        java_script_enabled=True,
                        accept_downloads=False,
                        has_touch=False,
                        is_mobile=False,
                        device_scale_factor=1.0
                    )
                    
                    # Add ultra stealth scripts
                    context.add_init_script(ULTRA_STEALTH_JS)
                    
                    # Additional fingerprint consistency script
                    fingerprint_script = f"""
                    Object.defineProperty(navigator, 'hardwareConcurrency', {{
                        get: () => {random.randint(2, 16)},
                        configurable: true
                    }});
                    
                    Object.defineProperty(navigator, 'deviceMemory', {{
                        get: () => {random.choice([2, 4, 8, 16])},
                        configurable: true
                    }});
                    
                    // Canvas fingerprint consistency
                    const originalGetContext = HTMLCanvasElement.prototype.getContext;
                    HTMLCanvasElement.prototype.getContext = function(type, ...args) {{
                        const ctx = originalGetContext.call(this, type, ...args);
                        if (type === '2d' && ctx) {{
                            const originalFillText = ctx.fillText;
                            ctx.fillText = function(text, x, y, maxWidth) {{
                                // Add consistent canvas fingerprint
                                originalFillText.call(this, text + '{canvas_fp}', x, y, maxWidth);
                            }};
                        }}
                        return ctx;
                    }};
                    
                    // WebGL consistency
                    const getParameter = WebGLRenderingContext.prototype.getParameter;
                    WebGLRenderingContext.prototype.getParameter = function(parameter) {{
                        if (parameter === 37445) return '{webgl_vendor}';
                        if (parameter === 37446) return '{webgl_renderer}';
                        return getParameter.call(this, parameter);
                    }};
                    """
                    
                    context.add_init_script(fingerprint_script)
                    
                    page = context.new_page()
                    
                    # Human-like delays
                    delays = get_human_like_delays()
                    
                    print(f"[NAVIGATION] Starting with {delays['navigation_delay']:.2f}s delay...")
                    await_time = delays['navigation_delay']
                    time.sleep(await_time)
                    
                    # Navigate with realistic options
                    try:
                        response = page.goto(url, 
                                           wait_until='domcontentloaded',
                                           timeout=30000)
                        
                        print(f"[RESPONSE] Status: {response.status}")
                        
                        # Wait for page to be interactive
                        page.wait_for_load_state('networkidle', timeout=10000)
                        
                        # Human-like behavior simulation
                        print("[BEHAVIOR] Simulating human interactions...")
                        
                        # Random scroll to simulate reading
                        for _ in range(random.randint(1, 3)):
                            scroll_distance = random.randint(200, 800)
                            page.evaluate(f"window.scrollBy(0, {scroll_distance})")
                            time.sleep(random.uniform(0.5, 1.5))
                        
                        # Random mouse movement
                        if random.random() < 0.7:
                            x = random.randint(100, resolution['width'] - 100)
                            y = random.randint(100, resolution['height'] - 100)
                            page.mouse.move(x, y)
                            time.sleep(random.uniform(0.1, 0.5))
                        
                        # Get page content
                        text = page.content()
                        print(f"[SUCCESS] Content length: {len(text)} characters")
                        
                    except Exception as e:
                        print(f"[ERROR] Navigation failed: {e}")
                        text = page.content() if page else ""
                        
                    finally:
                        browser.close()
                        
            except Exception as e:
                print(f"[CRITICAL] Playwright error: {e}")
                return {"error": f"Playwright execution failed: {str(e)}"}
        
        else:
            # Fallback to requests with ultra stealth
            print("[ULTRA_STEALTH] Using requests with maximum stealth...")
            
            session = requests.Session()
            session.headers.update(headers)
            
            # Add connection pooling and realistic behavior
            session.mount('http://', requests.adapters.HTTPAdapter(max_retries=3))
            session.mount('https://', requests.adapters.HTTPAdapter(max_retries=3))
            
            # Human-like delay before request
            time.sleep(random.uniform(1.0, 3.0))
            
            try:
                response = session.get(url, 
                                     timeout=30,
                                     allow_redirects=True,
                                     verify=True,
                                     stream=False)
                
                print(f"[RESPONSE] Status: {response.status_code}")
                print(f"[RESPONSE] Headers: {dict(response.headers)}")
                
                response.raise_for_status()
                text = response.text
                
                # Check if response is JSON
                try:
                    json.loads(text)
                    is_json = True
                    print("[DETECTION] JSON response detected")
                except:
                    is_json = False
                    
            except requests.exceptions.RequestException as e:
                print(f"[ERROR] Request failed: {e}")
                return {"error": f"Request failed: {str(e)}"}

    except Exception as e:
        print(f"[CRITICAL] Scraping failed: {e}")
        return {"error": f"Scraping failed: {str(e)}"}

    if not text:
        return {"error": "No content retrieved"}

    print(f"[PROCESSING] Content type: {'JSON' if is_json else 'HTML'}")
    print(f"[PROCESSING] Processing {len(rules)} extraction rules...")

    # Parse content
    if not is_json:
        try:
            tree = html.fromstring(text)
        except Exception as e:
            print(f"[ERROR] HTML parsing failed: {e}")
            return {"error": f"HTML parsing failed: {str(e)}"}

    # Process extraction rules
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

    # Add metadata
    # results['metadata'] = {
    #     'url': url,
    #     'mode': mode,
    #     'content_length': len(text),
    #     'rules_processed': len(rules),
    #     'success_count': sum(1 for v in results.values() if v is not None and v != []),
    #     'user_agent': headers['User-Agent'],
    #     'timestamp': time.time(),
    #     'content_type': 'json' if is_json else 'html'
    # }
    
    #print(f"[COMPLETE] Extracted {results['metadata']['success_count']}/{len(rules)} rules successfully")
    return results


# Example usage and testing
if __name__ == "__main__":
    # Test with a simple example
    test_url = "https://httpbin.org/user-agent"
    test_rules = [
        "//pre/text()",  # XPath to get user agent
        "$.user-agent"   # JSON path if response is JSON
    ]
    
    print("=== ULTRA STEALTH SCRAPER TEST ===")
    print("Testing both modes...")
    
    # Test requests mode
    print("\n--- REQUESTS MODE ---")
    result_requests = scrape_url(test_url, test_rules, mode="requests")
    print("Results:", json.dumps(result_requests, indent=2))
    
    # Test playwright mode (if available)
    if PLAYWRIGHT_AVAILABLE:
        print("\n--- PLAYWRIGHT MODE ---")
        result_playwright = scrape_url(test_url, test_rules, mode="playwright")
        print("Results:", json.dumps(result_playwright, indent=2))
    else:
        print("\n--- PLAYWRIGHT MODE ---")
        print("Playwright not available. Install with:")
        print("pip install playwright")
        print("playwright install")
