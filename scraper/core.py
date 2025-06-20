import requests
from lxml import html
import re
import json
import random
import time
import base64
import hashlib
import socket
import ssl
from typing import List, Dict, Union
from urllib3.util.ssl_ import create_urllib3_context
from fake_useragent import UserAgent  # Added for better UA generation


# Enhanced Playwright imports with error handling
try:
    from playwright.sync_api import sync_playwright, Route
    #from playwright._impl._api_types import TimeoutError as PlaywrightTimeoutError
    PLAYWRIGHT_AVAILABLE = True
    print("[PLAYWRIGHT] Successfully imported")
except ImportError as e:
    PLAYWRIGHT_AVAILABLE = False
    print(f"[PLAYWRIGHT] Import failed: {e}")

# Import additional stealth plugins
try:
    from selenium_stealth import stealth  # Additional stealth layer when needed
    STEALTH_EXTRA = True
except ImportError:
    STEALTH_EXTRA = False

# --- Quantum Stealth Chromium Args ---
# Organized by category with additional stealth parameters

ULTRA_STEALTH_CHROMIUM_ARGS = [
    # Core stealth
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-web-security',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process,TranslateUI,BlinkGenPropertyTrees,AutomationControlled',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-ipc-flooding-protection',
    '--disable-hang-monitor',
    
    # Networking
    '--disable-sync',
    '--disable-domain-reliability',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--safebrowsing-disable-auto-update',
    '--no-pings',
    '--no-referrers',
    '--disable-notifications',
    '--disable-default-apps',
    
    # Media
    '--mute-audio',
    '--disable-speech-api',
    '--disable-media-session-api',
    '--disable-webrtc',
    '--disable-webrtc-hw-decoding',
    '--disable-webrtc-hw-encoding',
    '--disable-webrtc-encryption',
    
    # Hardware
    '--disable-3d-apis',
    '--disable-accelerated-2d-canvas',
    '--disable-canvas-aa',
    '--disable-gl-drawing-for-tests',
    '--disable-gl-extensions',
    '--disable-webgl',
    '--disable-webgl2',
    '--disable-lcd-text',
    
    # UI
    '--disable-infobars',
    '--disable-popup-blocking',
    '--disable-print-preview',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    
    # Extensions
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-component-update',
    
    # Performance
    '--aggressive-cache-discard',
    '--memory-pressure-off',
    '--renderer-process-limit=1',
    '--extension-process=1',
    
    # Fingerprinting
    '--disable-file-system',
    '--disable-permissions-api',
    '--disable-presentation-api',
    '--disable-remote-fonts',
    '--disable-speech-synthesis-api',
    '--disable-threaded-compositing',
    '--disable-webusb',
    '--disable-webvr',
    
    # Misc
    '--no-first-run',
    '--no-default-browser-check',
    '--no-zygote',
    '--use-mock-keychain',
    '--metrics-recording-only',
    '--disable-field-trial-config',
    '--disable-new-content-rendering-timeout',
    '--disable-threaded-animation',
    '--disable-threaded-scrolling',
    '--window-position=0,0',
    '--force-device-scale-factor=1',
    '--high-dpi-support=1',
    '--disable-logging',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-device-discovery-notifications',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-software-rasterizer',
    '--disable-cloud-import',
    '--disable-gpu-compositing',
    '--disable-smooth-scrolling',
    '--disable-zero-copy',
    '--disable-prompt-on-repost',
    '--disable-renderer-accessibility',
    '--disable-search-geolocation-disclosure',
    '--disable-sync-preferences',
    '--disable-web-resources',
    '--disable-touch-adjustment',
    '--disable-voice-input',
    '--disable-winsta',
    '--enable-aggressive-domstorage-flushing',
    '--enable-parallel-downloading',
    '--enable-potentially-annoying-security-features',
    '--enable-smooth-scrolling',
    '--enable-strict-mixed-content-checking',
    '--enable-tcp-fast-open',
    '--enable-webgl-draft-extensions',
    '--enable-websocket-over-spdy',
    '--force-color-profile=srgb',
    '--ignore-certificate-errors',
    '--ignore-urlfetcher-cert-requests',
    '--media-cache-size=1',
    '--prerender-from-omnibox=disabled',
    '--process-per-site',
    '--reduce-security-for-testing',
    '--remote-debugging-port=0',
    '--ssl-version-min=tls1',
    #'--user-data-dir=/tmp/random-chrome-user-data',
    '--window-size=1366,768'
]

# Enhanced user agent generation with fake-useragent
def get_random_user_agent():
    try:
        ua = UserAgent()
        return ua.random
    except:
        # Fallback to static pool if fake-useragent fails
        return random.choice([
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
        ])


# Enhanced timezone list with proper DST support
TIMEZONES = [
    'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'America/Denver',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Singapore', 'Asia/Dubai',
    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
    'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo', 'America/Mexico_City',
    'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Kolkata', 'Asia/Jakarta'
]

# Enhanced screen resolutions with device types
SCREEN_RESOLUTIONS = [
    # Desktop
    {'width': 1920, 'height': 1080, 'type': 'desktop'},
    {'width': 1366, 'height': 768, 'type': 'desktop'},
    {'width': 1440, 'height': 900, 'type': 'desktop'},
    {'width': 1536, 'height': 864, 'type': 'desktop'},
    {'width': 1600, 'height': 900, 'type': 'desktop'},
    {'width': 1680, 'height': 1050, 'type': 'desktop'},
    {'width': 1280, 'height': 720, 'type': 'desktop'},
    {'width': 1280, 'height': 800, 'type': 'desktop'},
    {'width': 2560, 'height': 1440, 'type': 'desktop'},
    {'width': 3840, 'height': 2160, 'type': 'desktop'},
    
    # Laptop
    {'width': 1440, 'height': 900, 'type': 'laptop'},
    {'width': 1280, 'height': 800, 'type': 'laptop'},
    {'width': 1366, 'height': 768, 'type': 'laptop'},
    
    # Mobile
    {'width': 414, 'height': 896, 'type': 'mobile'},
    {'width': 375, 'height': 812, 'type': 'mobile'},
    {'width': 360, 'height': 640, 'type': 'mobile'},
    {'width': 412, 'height': 915, 'type': 'mobile'},
]

# Enhanced TLS fingerprinting protection
class StealthHttpAdapter(requests.adapters.HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        context = create_urllib3_context()
        context.set_ciphers("ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384")
        context.options |= ssl.OP_NO_SSLv2
        context.options |= ssl.OP_NO_SSLv3
        context.options |= ssl.OP_NO_TLSv1
        context.options |= ssl.OP_NO_TLSv1_1
        kwargs['ssl_context'] = context
        return super().init_poolmanager(*args, **kwargs)

    def proxy_manager_for(self, *args, **kwargs):
        context = create_urllib3_context()
        context.set_ciphers("ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384")
        context.options |= ssl.OP_NO_SSLv2
        context.options |= ssl.OP_NO_SSLv3
        context.options |= ssl.OP_NO_TLSv1
        context.options |= ssl.OP_NO_TLSv1_1
        kwargs['ssl_context'] = context
        return super().proxy_manager_for(*args, **kwargs)

def generate_canvas_fingerprint():
    """Generate a realistic canvas fingerprint with more entropy"""
    fonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 
             'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Comic Sans MS', 
             'Trebuchet MS', 'Arial Black', 'Impact', 'SF Pro', 'SF Mono',
             'Roboto', 'Open Sans', 'Segoe UI', 'Consolas']
    text = f"BrowserLeaks,com <canvas> {random.randint(1, 1000)} {random.choice(fonts)} {random.randint(1000, 9999)}"
    return hashlib.sha256(text.encode()).hexdigest()[:16]

def generate_webgl_fingerprint():
    """Generate WebGL fingerprint with more realistic combinations"""
    vendors = ['Intel Inc.', 'NVIDIA Corporation', 'ATI Technologies Inc.', 'ARM', 
              'Qualcomm', 'Apple', 'Google Inc.', 'VMware, Inc.', 'Microsoft']
    renderers = [
        'Intel Iris OpenGL Engine', 'NVIDIA GeForce GTX 1060', 'AMD Radeon RX 580',
        'Intel UHD Graphics 620', 'NVIDIA GeForce RTX 3060', 'AMD Radeon RX 6600 XT',
        'Intel HD Graphics 4000', 'Apple M1', 'Apple M2', 'Apple M3',
        'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)',
        'Google SwiftShader', 'Mesa DRI Intel(R) HD Graphics 520 (Skylake GT2)'
    ]
    return random.choice(vendors), random.choice(renderers)

def generate_audio_fingerprint():
    """Generate audio context fingerprint"""
    return hashlib.sha256(str(random.getrandbits(256)).encode()).hexdigest()[:12]

def get_ultra_random_headers():
    """Generate ultra-realistic headers with proper entropy and consistency"""
    ua = get_random_user_agent()
    
    # Extract browser info from UA for consistency
    is_chrome = 'Chrome' in ua and 'Safari' in ua
    is_firefox = 'Firefox' in ua
    is_safari = 'Safari' in ua and 'Chrome' not in ua
    is_edge = 'Edg' in ua
    is_mobile = 'Mobile' in ua or 'iPhone' in ua or 'Android' in ua
    
    # Generate consistent headers based on browser type
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
        'Pragma': 'no-cache' if random.random() < 0.3 else '',
    }
    
    # Remove empty headers
    headers = {k: v for k, v in headers.items() if v}
    
    # Browser-specific headers
    if is_chrome or is_edge:
        chrome_version = re.search(r'Chrome/(\d+)', ua).group(1)
        headers['sec-ch-ua'] = f'"Not_A Brand";v="8", "Chromium";v="{chrome_version}", "Google Chrome";v="{chrome_version}"'
        headers['sec-ch-ua-mobile'] = '?1' if is_mobile else '?0'
        headers['sec-ch-ua-platform'] = f'"{random.choice(["Windows", "macOS", "Linux", "Android", "iOS"])}"'
        headers['sec-ch-ua-platform-version'] = f'"{random.randint(10, 15)}.{random.randint(0, 5)}.0"'
    
    if is_firefox:
        headers['TE'] = 'trailers'
    
    # Add random optional headers
    if random.random() < 0.3:
        headers['Priority'] = random.choice(['u=0, i', 'u=1, i'])
    
    if random.random() < 0.2:
        headers['Purpose'] = 'prefetch'
    
    if random.random() < 0.1:
        headers['Save-Data'] = 'on'
    
    return headers

# Enhanced Ultra Stealth JavaScript with more evasion techniques

ULTRA_STEALTH_JS = """
// ==== QUANTUM STEALTH SCRIPT ====
(function() {
    'use strict';
    
    // 1. WEBDRIVER DETECTION BYPASS (Enhanced)
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
        enumerable: false
    });
    
    // Remove all known automation properties
    const automationProps = ['webdriver', '__webdriver_script_fn', '__driver_evaluate', 
                           '__webdriver_evaluate', '__selenium_evaluate', '__fxdriver_evaluate',
                           '__driver_unwrapped', '__webdriver_unwrapped', '__selenium_unwrapped',
                           '__fxdriver_unwrapped', '_Selenium_IDE_Recorder', '_selenium',
                           'calledSelenium', '$cdc_asdjflasutopfhvcZLmcfl_', 
                           '$chrome_asyncScriptInfo', '__$webdriverAsyncExecutor'];
    
    automationProps.forEach(prop => {
        try {
            delete window[prop];
            delete document[prop];
        } catch(e) {}
    });
    
    // 2. AUTOMATION DETECTION BYPASS (Enhanced)
    const originalChrome = window.chrome;
    Object.defineProperty(window, 'chrome', {
        get: () => ({
            ...(originalChrome || {}),
            runtime: {
                id: 'abcdefghijklmnopqrstuvwxyz',
                onConnect: undefined,
                onMessage: undefined,
                connect: function() { 
                    return {
                        postMessage: function(){}, 
                        onMessage: {addListener: function(){}},
                        disconnect: function(){},
                        name: 'chrome-extension'
                    } 
                },
                sendMessage: function(){},
                getManifest: function() {
                    return {
                        version: '1.0.0',
                        name: 'Chrome Extension'
                    };
                },
                getURL: function(path) { return `chrome-extension://${this.id}/${path}`; }
            },
            csi: function() { return {}; },
            loadTimes: function() { 
                return {
                    requestTime: Date.now() / 1000 - Math.random(),
                    startLoadTime: Date.now() / 1000 - Math.random() * 2,
                    commitLoadTime: Date.now() / 1000 - Math.random() * 1.5,
                    finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
                    finishLoadTime: Date.now() / 1000 - Math.random() * 0.5,
                    firstPaintTime: Date.now() / 1000 - Math.random() * 0.3,
                    firstPaintAfterLoadTime: Date.now() / 1000 - Math.random() * 0.2,
                    navigationType: 'Other',
                    wasFetchedViaSpdy: false,
                    wasNpnNegotiated: false,
                    npnNegotiatedProtocol: 'unknown',
                    wasAlternateProtocolAvailable: false,
                    connectionInfo: 'unknown'
                };
            },
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
            },
            storage: {
                sync: {
                    get: function() {},
                    set: function() {},
                    remove: function() {},
                    clear: function() {}
                },
                local: {
                    get: function() {},
                    set: function() {},
                    remove: function() {},
                    clear: function() {}
                }
            }
        }),
        configurable: true,
        enumerable: false
    });
    
    // 3. PERMISSION QUERIES BYPASS (Enhanced)
    const originalQuery = navigator.permissions.query;
    navigator.permissions.query = function(parameters) {
        if (parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
        }
        if (parameters.name === 'geolocation') {
            return Promise.resolve({ state: 'prompt' });
        }
        return originalQuery ? originalQuery.call(this, parameters) : Promise.resolve({ state: 'granted' });
    };
    
    // 4. PLUGINS FINGERPRINTING BYPASS (Enhanced)
    const pluginData = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
    ];
    
    Object.defineProperty(navigator, 'plugins', {
        get: () => {
            const plugins = [];
            
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
        configurable: true,
        enumerable: false
    });
    
    Object.defineProperty(navigator, 'mimeTypes', {
        get: () => {
            const mimeTypes = [
                { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: pluginData[0] },
                { type: 'text/pdf', suffixes: 'pdf', description: '', enabledPlugin: pluginData[0] }
            ];
            
            Object.setPrototypeOf(mimeTypes, MimeTypeArray.prototype);
            return mimeTypes;
        },
        configurable: true,
        enumerable: false
    });
    
    // 5. LANGUAGES BYPASS (Enhanced)
    const languages = ['en-US', 'en'];
    Object.defineProperty(navigator, 'language', {
        get: () => languages[0],
        configurable: true,
        enumerable: false
    });
    
    Object.defineProperty(navigator, 'languages', {
        get: () => languages,
        configurable: true,
        enumerable: false
    });
    
    // 6. WEBGL FINGERPRINTING BYPASS (Enhanced)
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
            return 'WebGL 2.0 (OpenGL ES 3.0 Chromium)';
        }
        if (parameter === 7937) { // SHADING_LANGUAGE_VERSION
            return 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)';
        }
        if (parameter === 3415) { // MAX_RENDERBUFFER_SIZE
            return 16384;
        }
        if (parameter === 3414) { // MAX_TEXTURE_SIZE
            return 16384;
        }
        return getParameter.call(this, parameter);
    };
    
    // Override getSupportedExtensions
    const originalGetSupportedExtensions = WebGLRenderingContext.prototype.getSupportedExtensions;
    WebGLRenderingContext.prototype.getSupportedExtensions = function() {
        const extensions = originalGetSupportedExtensions ? originalGetSupportedExtensions.call(this) : [];
        return extensions.concat([
            'ANGLE_instanced_arrays',
            'EXT_blend_minmax',
            'EXT_color_buffer_half_float',
            'EXT_disjoint_timer_query',
            'EXT_frag_depth',
            'EXT_shader_texture_lod',
            'EXT_sRGB',
            'EXT_texture_filter_anisotropic',
            'OES_element_index_uint',
            'OES_standard_derivatives',
            'OES_texture_float',
            'OES_texture_float_linear',
            'OES_texture_half_float',
            'OES_texture_half_float_linear',
            'OES_vertex_array_object',
            'WEBGL_color_buffer_float',
            'WEBGL_compressed_texture_s3tc',
            'WEBGL_debug_renderer_info',
            'WEBGL_debug_shaders',
            'WEBGL_depth_texture',
            'WEBGL_draw_buffers',
            'WEBGL_lose_context'
        ]);
    };
    
    // 7. CANVAS FINGERPRINTING BYPASS (Enhanced)
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
        // Add subtle noise to canvas
        const ctx = this.getContext('2d');
        if (ctx) {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
                if (Math.random() < 0.001) {
                    imageData.data[i] = Math.floor(Math.random() * 256);
                    imageData.data[i+1] = Math.floor(Math.random() * 256);
                    imageData.data[i+2] = Math.floor(Math.random() * 256);
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
                imageData.data[i+1] = Math.floor(Math.random() * 256);
                imageData.data[i+2] = Math.floor(Math.random() * 256);
            }
        }
        return imageData;
    };
    
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
        // Add slight variation to text rendering
        const jitterX = Math.random() * 0.5 - 0.25;
        const jitterY = Math.random() * 0.5 - 0.25;
        return originalFillText.call(this, text, x + jitterX, y + jitterY, maxWidth);
    };
    
    // 8. TIMING ATTACKS BYPASS (Enhanced)
    const originalPerformanceNow = Performance.prototype.now;
    Performance.prototype.now = function() {
        return originalPerformanceNow.call(this) + Math.random() * 0.1 - 0.05;
    };
    
    // Override performance timing
    if (window.performance && window.performance.timing) {
        const timing = window.performance.timing;
        const now = Date.now();
        
        Object.defineProperties(timing, {
            'navigationStart': { value: now - Math.random() * 5000 - 1000 },
            'unloadEventStart': { value: 0 },
            'unloadEventEnd': { value: 0 },
            'redirectStart': { value: 0 },
            'redirectEnd': { value: 0 },
            'fetchStart': { value: now - Math.random() * 4000 - 800 },
            'domainLookupStart': { value: now - Math.random() * 3000 - 600 },
            'domainLookupEnd': { value: now - Math.random() * 2900 - 500 },
            'connectStart': { value: now - Math.random() * 2800 - 400 },
            'connectEnd': { value: now - Math.random() * 2700 - 300 },
            'secureConnectionStart': { value: now - Math.random() * 2600 - 200 },
            'requestStart': { value: now - Math.random() * 2500 - 100 },
            'responseStart': { value: now - Math.random() * 2000 - 50 },
            'responseEnd': { value: now - Math.random() * 1000 - 20 },
            'domLoading': { value: now - Math.random() * 900 - 10 },
            'domInteractive': { value: now - Math.random() * 800 - 5 },
            'domContentLoadedEventStart': { value: now - Math.random() * 700 - 2 },
            'domContentLoadedEventEnd': { value: now - Math.random() * 600 - 1 },
            'domComplete': { value: now - Math.random() * 500 },
            'loadEventStart': { value: now - Math.random() * 400 },
            'loadEventEnd': { value: now - Math.random() * 300 }
        });
    }
    
    // 9. SCREEN RESOLUTION CONSISTENCY (Enhanced)
    const screenProps = ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth'];
    screenProps.forEach(prop => {
        Object.defineProperty(screen, prop, {
            get: function() {
                if (prop === 'availWidth') return this.width;
                if (prop === 'availHeight') return this.height - (Math.random() < 0.5 ? 40 : 80);
                if (prop === 'colorDepth' || prop === 'pixelDepth') return 24;
                return window.innerWidth > window.innerHeight ? 
                    Math.max(window.innerWidth, window.innerHeight) : 
                    Math.min(window.innerWidth, window.innerHeight);
            },
            configurable: true,
            enumerable: false
        });
    });
    
    // 10. MEDIA DEVICES BYPASS (Enhanced)
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
        navigator.mediaDevices.enumerateDevices = function() {
            return originalEnumerateDevices.call(this).then(devices => {
                return devices.map(device => ({
                    ...device,
                    label: '',
                    deviceId: 'default',
                    groupId: 'default-group'
                }));
            });
        };
        
        // Override getUserMedia
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = function(constraints) {
            return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        };
    }
    
    // 11. BATTERY API BYPASS (Enhanced)
    if (navigator.getBattery) {
        navigator.getBattery = function() {
            return Promise.resolve({
                charging: Math.random() > 0.3,
                chargingTime: Math.random() > 0.3 ? 0 : Math.floor(Math.random() * 3600),
                dischargingTime: Math.random() > 0.3 ? Infinity : Math.floor(Math.random() * 7200),
                level: Math.random(),
                addEventListener: function() {},
                removeEventListener: function() {},
                dispatchEvent: function() { return true; },
                onchargingchange: null,
                onchargingtimechange: null,
                ondischargingtimechange: null,
                onlevelchange: null
            });
        };
    }
    
    // 12. GEOLOCATION BYPASS (Enhanced)
    if (navigator.geolocation) {
        const originalGetCurrentPosition = navigator.geolocation.getCurrentPosition;
        const originalWatchPosition = navigator.geolocation.watchPosition;
        
        navigator.geolocation.getCurrentPosition = function(success, error, options) {
            if (error) {
                error({ code: 1, message: 'User denied the request for Geolocation.' });
            } else if (success) {
                success({
                    coords: {
                        latitude: 37.7749 + (Math.random() * 0.01 - 0.005),
                        longitude: -122.4194 + (Math.random() * 0.01 - 0.005),
                        accuracy: 50 + Math.random() * 100,
                        altitude: null,
                        altitudeAccuracy: null,
                        heading: null,
                        speed: null
                    },
                    timestamp: Date.now()
                });
            }
        };
        
        navigator.geolocation.watchPosition = function(success, error, options) {
            if (error) {
                error({ code: 1, message: 'User denied the request for Geolocation.' });
            }
            return Math.floor(Math.random() * 1000) + 1;
        };
    }
    
    // 13. MOUSE MOVEMENT SIMULATION (Enhanced)
    let mouseMovements = 0;
    let lastMouseX = 0;
    let lastMouseY = 0;
    
    document.addEventListener('mousemove', function(e) {
        mouseMovements++;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });
    
    // Simulate human-like mouse movements with Bezier curves
    setInterval(() => {
        if (mouseMovements === 0 && Math.random() < 0.1) {
            const targetX = Math.random() * window.innerWidth;
            const targetY = Math.random() * window.innerHeight;
            
            // Simulate smooth movement
            const steps = 10;
            for (let i = 1; i <= steps; i++) {
                setTimeout(() => {
                    const t = i / steps;
                    // Bezier curve for natural movement
                    const x = lastMouseX + (targetX - lastMouseX) * t;
                    const y = lastMouseY + (targetY - lastMouseY) * t;
                    
                    const event = new MouseEvent('mousemove', {
                        clientX: x,
                        clientY: y,
                        bubbles: true,
                        view: window
                    });
                    document.dispatchEvent(event);
                }, i * 50);
            }
        }
        mouseMovements = 0;
    }, 5000 + Math.random() * 5000);
    
    // 14. IFRAME DETECTION BYPASS (Enhanced)
    Object.defineProperty(window, 'top', {
        get: () => window,
        configurable: true,
        enumerable: false
    });
    
    Object.defineProperty(window, 'parent', {
        get: () => window,
        configurable: true,
        enumerable: false
    });
    
    Object.defineProperty(window, 'self', {
        get: () => window,
        configurable: true,
        enumerable: false
    });
    
    // 15. HEADLESS DETECTION BYPASS (Enhanced)
    Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => Math.max(2, Math.floor(Math.random() * 8) + 1),
        configurable: true,
        enumerable: false
    });
    
    Object.defineProperty(navigator, 'deviceMemory', {
        get: () => [2, 4, 8, 16][Math.floor(Math.random() * 4)],
        configurable: true,
        enumerable: false
    });
    
    // 16. CONNECTION INFORMATION (Enhanced)
    const connectionTypes = ['4g', 'wifi', '3g', '2g', 'ethernet'];
    Object.defineProperty(navigator, 'connection', {
        get: () => ({
            effectiveType: connectionTypes[Math.floor(Math.random() * connectionTypes.length)],
            downlink: 2.0 + Math.random() * 8,
            rtt: Math.floor(Math.random() * 100) + 50,
            saveData: false,
            type: connectionTypes[Math.floor(Math.random() * connectionTypes.length)],
            onchange: null,
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; }
        }),
        configurable: true,
        enumerable: false
    });
    
    // 17. USER ACTIVATION BYPASS (Enhanced)
    Object.defineProperty(navigator, 'userActivation', {
        get: () => ({
            hasBeenActive: true,
            isActive: true,
            onchange: null,
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; }
        }),
        configurable: true,
        enumerable: false
    });
    
    // 18. NOTIFICATION PERMISSION (Enhanced)
    Object.defineProperty(Notification, 'permission', {
        get: () => ['default', 'denied', 'granted'][Math.floor(Math.random() * 3)],
        configurable: true,
        enumerable: false
    });
    
    // 19. SPEECH SYNTHESIS BYPASS (Enhanced)
    if (window.speechSynthesis) {
        const voices = [
            { voiceURI: 'Microsoft David - English (United States)', name: 'Microsoft David', lang: 'en-US', localService: true, default: true },
            { voiceURI: 'Microsoft Zira - English (United States)', name: 'Microsoft Zira', lang: 'en-US', localService: true, default: false },
            { voiceURI: 'Google US English', name: 'Google US English', lang: 'en-US', localService: false, default: false }
        ];
        
        Object.defineProperty(window.speechSynthesis, 'getVoices', {
            value: () => voices,
            configurable: true,
            enumerable: false
        });
        
        const originalSpeak = window.speechSynthesis.speak;
        window.speechSynthesis.speak = function(utterance) {
            return originalSpeak.call(this, utterance);
        };
    }
    
    // 20. ADD REALISTIC ERRORS AND WARNINGS (Enhanced)
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalLog = console.log;
    
    // Inject some realistic browser warnings
    setTimeout(() => {
        if (Math.random() < 0.3) {
            originalWarn.call(console, 'The resource was preloaded using link preload but not used within a few seconds.');
        }
        if (Math.random() < 0.2) {
            originalWarn.call(console, 'A cookie associated with a cross-site resource was set without the `SameSite` attribute.');
        }
        if (Math.random() < 0.1) {
            originalError.call(console, 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT');
        }
    }, Math.random() * 5000 + 2000);
    
    // 21. MONKEY PATCH COMMON DETECTION METHODS (Enhanced)
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        // Don't block, but make it less detectable
        return originalAddEventListener.call(this, type, listener, options);
    };
    
    // 22. MEMORY USAGE REALISM (Enhanced)
    Object.defineProperty(performance, 'memory', {
        get: () => ({
            usedJSHeapSize: Math.floor(Math.random() * 50000000) + 10000000,
            totalJSHeapSize: Math.floor(Math.random() * 100000000) + 50000000,
            jsHeapSizeLimit: 2172649472,
            onchange: null,
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; }
        }),
        configurable: true,
        enumerable: false
    });
    
    // 23. TIMEZONE CONSISTENCY (Enhanced)
    const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function() {
        // Return consistent timezone offset
        return originalGetTimezoneOffset.call(this);
    };
    
    // 24. AUDIO CONTEXT FINGERPRINTING BYPASS
    if (window.AudioContext || window.webkitAudioContext) {
        const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
        
        window.AudioContext = function() {
            const audioContext = new OriginalAudioContext();
            
            // Override createAnalyser
            const originalCreateAnalyser = audioContext.createAnalyser;
            audioContext.createAnalyser = function() {
                const analyser = originalCreateAnalyser.call(this);
                
                // Override getFloatTimeDomainData
                const originalGetFloatTimeDomainData = analyser.getFloatTimeDomainData;
                analyser.getFloatTimeDomainData = function(array) {
                    originalGetFloatTimeDomainData.call(this, array);
                    // Add slight noise
                    for (let i = 0; i < array.length; i++) {
                        array[i] += (Math.random() * 0.0001 - 0.00005);
                    }
                };
                
                return analyser;
            };
            
            return audioContext;
        };
    }
    
    // 25. PROXY DETECTION BYPASS
    Object.defineProperty(window, 'Proxy', {
        value: Proxy,
        writable: false,
        configurable: false,
        enumerable: false
    });
    
    // 26. BROWSER PLUGIN DETECTION BYPASS
    Object.defineProperty(navigator, 'javaEnabled', {
        value: function() { return false; },
        writable: false,
        configurable: false,
        enumerable: false
    });
    
    Object.defineProperty(navigator, 'pdfViewerEnabled', {
        value: true,
        writable: false,
        configurable: false,
        enumerable: false
    });
    
    // 27. BROWSER THEME DETECTION BYPASS
    Object.defineProperty(window, 'matchMedia', {
        value: function(query) {
            return {
                matches: query.includes('prefers-color-scheme: dark') ? false : true,
                media: query,
                onchange: null,
                addEventListener: function() {},
                removeEventListener: function() {},
                dispatchEvent: function() { return true; }
            };
        },
        writable: false,
        configurable: false,
        enumerable: false
    });
    
    // 28. BROWSER STORAGE DETECTION BYPASS
    Object.defineProperty(window, 'localStorage', {
        get: function() {
            return {
                length: 0,
                clear: function() {},
                getItem: function() { return null; },
                key: function() { return null; },
                removeItem: function() {},
                setItem: function() {},
                __proto__: Storage.prototype
            };
        },
        configurable: false,
        enumerable: false
    });
    
    Object.defineProperty(window, 'sessionStorage', {
        get: function() {
            return {
                length: 0,
                clear: function() {},
                getItem: function() { return null; },
                key: function() { return null; },
                removeItem: function() {},
                setItem: function() {},
                __proto__: Storage.prototype
            };
        },
        configurable: false,
        enumerable: false
    });
    
    console.log('[STEALTH] All bypasses activated successfully');
})();

// Additional stealth for specific detection methods
(function() {
    // Proxy trap for common detection patterns
    const handler = {
        get: function(target, prop) {
            // Block all known automation properties
            const automationProps = ['webdriver', '__webdriver_script_fn', '__driver_evaluate', 
                                  '__webdriver_evaluate', '__selenium_evaluate', '__fxdriver_evaluate',
                                  '__driver_unwrapped', '__webdriver_unwrapped', '__selenium_unwrapped',
                                  '__fxdriver_unwrapped', '_Selenium_IDE_Recorder', '_selenium',
                                  'calledSelenium', '$cdc_asdjflasutopfhvcZLmcfl_', 
                                  '$chrome_asyncScriptInfo', '__$webdriverAsyncExecutor'];
            
            if (automationProps.includes(prop)) {
                return undefined;
            }
            
            // Special handling for common detection methods
            if (prop === 'toString') {
                return function() { return '[object Window]'; };
            }
            
            if (prop === 'constructor') {
                return {
                    name: 'Window',
                    prototype: Window.prototype
                };
            }
            
            return target[prop];
        },
        set: function(target, prop, value) {
            target[prop] = value;
            return true;
        },
        has: function(target, prop) {
            return prop in target;
        }
    };
    
    window = new Proxy(window, handler);
    document = new Proxy(document, handler);
    navigator = new Proxy(navigator, handler);
})();

// Final touch - override Function.prototype.toString to hide injected code
(function() {
    const originalToString = Function.prototype.toString;
    
    Function.prototype.toString = function() {
        if (this.name === 'toString' || this.name === 'Function') {
            return originalToString.call(this);
        }
        
        // Return generic function string for stealth
        return `function ${this.name || ''}() { [native code] }`;
    };
})();
"""

def get_human_like_delays():
    """Generate human-like delays with more realistic patterns"""
    return {
        'navigation_delay': random.uniform(1.5, 4.0) + random.random() * 2,  # Initial delay with random variation
        'interaction_delay': random.uniform(0.3, 1.5) * (1 + random.random()),  # Variable interaction delay
        'scroll_delay': random.uniform(0.2, 1.0) * (0.8 + random.random() * 0.4),  # Smooth scrolling
        'typing_delay': random.uniform(0.08, 0.25) * (0.9 + random.random() * 0.2),  # Natural typing rhythm
        'thinking_delay': random.uniform(0.5, 3.0) * (0.8 + random.random() * 0.4),  # Time between actions
        'page_load_delay': random.uniform(0.5, 2.0)  # Additional delay after page load
    }

def intercept_request(route: Route):
    """Intercept and modify requests for stealth"""
    # Block common tracking and fingerprinting scripts
    blocked_resources = [
        'fingerprint2.js', 'fingerprintjs2', 'clientjs', 'evercookie',
        'detect.js', 'modernizr', 'track', 'analytics', 'google-analytics',
        'googletagmanager', 'facebook.net', 'doubleclick.net',
        'hotjar.com', 'mouseflow.com', 'fullstory.com', 'sessioncam.com',
        'clicktale.net', 'inspectlet.com', 'luckyorange.com', 'yandex.ru/metrika',
        'mixpanel.com', 'amplitude.com', 'heap.io', 'piwik.js', 'matomo.js',
        'crazyegg.com', 'mouseflow.com', 'rollbar.com', 'raygun.io'
    ]
    
    if any(resource in route.request.url for resource in blocked_resources):
        print(f"[STEALTH] Blocked tracking resource: {route.request.url}")
        return route.abort()
    
    # Continue with the request
    route.continue_()

def scrape_url(url: str, rules: List[str], mode: str = "requests") -> Dict[str, Union[str, List[str]]]:
    print(f"[QUANTUM_STEALTH] Mode: {mode}")
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

            print("[QUANTUM_STEALTH] Launching quantum-stealth browser...")
            
            try:
                with sync_playwright() as p:
                    # Random screen resolution for consistency
                    resolution = random.choice(SCREEN_RESOLUTIONS)
                    timezone = random.choice(TIMEZONES)
                    canvas_fp = generate_canvas_fingerprint()
                    webgl_vendor, webgl_renderer = generate_webgl_fingerprint()
                    audio_fp = generate_audio_fingerprint()
                    
                    print(f"[FINGERPRINT] Resolution: {resolution['width']}x{resolution['height']}")
                    print(f"[FINGERPRINT] Timezone: {timezone}")
                    print(f"[FINGERPRINT] Canvas: {canvas_fp}")
                    print(f"[FINGERPRINT] WebGL: {webgl_vendor} / {webgl_renderer}")
                    print(f"[FINGERPRINT] Audio: {audio_fp}")

                    # Launch with quantum stealth args
                    browser = p.chromium.launch(
                        headless=True,
                        args=ULTRA_STEALTH_CHROMIUM_ARGS,
                        ignore_default_args=[
                            '--enable-automation',
                            '--enable-blink-features=AutomationControlled',
                            '--disable-extensions',
                            '--disable-component-extensions-with-background-pages'
                        ],
                        executable_path=p.chromium.executable_path,
                        handle_sigint=False,
                        handle_sigterm=False,
                        handle_sighup=False
                    )
                    
                    # Create context with realistic fingerprint
                    context = browser.new_context(
                        user_agent=headers['User-Agent'],
                        viewport={'width': resolution['width'], 'height': resolution['height']},
                        screen={'width': resolution['width'], 'height': resolution['height']},
                        timezone_id=timezone,
                        locale='en-US',
                        permissions=['geolocation'],
                        geolocation={
                            'latitude': 40.7128 + random.uniform(-0.1, 0.1), 
                            'longitude': -74.0060 + random.uniform(-0.1, 0.1),
                            'accuracy': 50 + random.random() * 100
                        },
                        color_scheme='light',
                        extra_http_headers=headers,
                        java_script_enabled=True,
                        accept_downloads=False,
                        has_touch=False,
                        is_mobile=resolution['type'] == 'mobile',
                        device_scale_factor=1.0,
                        http_credentials=None,
                        ignore_https_errors=False,
                        offline=False,
                        record_har_path=None,
                        record_video_dir=None,
                        storage_state=None,
                        strict_selectors=False,
                        service_workers='block',
                        proxy=None
                    )
                    
                    # Add quantum stealth scripts
                    context.add_init_script(ULTRA_STEALTH_JS)
                    
                    # Additional fingerprint consistency script
                    fingerprint_script = f"""
                    // Enhanced fingerprint consistency
                    Object.defineProperty(navigator, 'hardwareConcurrency', {{
                        get: () => {random.randint(2, 16)},
                        configurable: false,
                        enumerable: false
                    }});
                    
                    Object.defineProperty(navigator, 'deviceMemory', {{
                        get: () => {random.choice([2, 4, 8, 16])},
                        configurable: false,
                        enumerable: false
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
                    
                    // Audio fingerprint consistency
                    if (window.AudioContext || window.webkitAudioContext) {{
                        const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
                        window.AudioContext = function() {{
                            const audioContext = new OriginalAudioContext();
                            
                            // Override createAnalyser
                            const originalCreateAnalyser = audioContext.createAnalyser;
                            audioContext.createAnalyser = function() {{
                                const analyser = originalCreateAnalyser.call(this);
                                
                                // Override getFloatTimeDomainData
                                const originalGetFloatTimeDomainData = analyser.getFloatTimeDomainData;
                                analyser.getFloatTimeDomainData = function(array) {{
                                    originalGetFloatTimeDomainData.call(this, array);
                                    // Add consistent noise pattern
                                    for (let i = 0; i < array.length; i++) {{
                                        array[i] += (parseInt('{audio_fp}'.charCodeAt(i % '{audio_fp}'.length).toString(16)) / 100000);
                                    }}
                                }};
                                
                                return analyser;
                            }};
                            
                            return audioContext;
                        }};
                    }}
                    """
                    
                    context.add_init_script(fingerprint_script)
                    
                    # Route requests to block tracking
                    context.route('**/*', intercept_request)
                    
                    page = context.new_page()
                    
                    # Human-like delays
                    delays = get_human_like_delays()
                    
                    print(f"[NAVIGATION] Starting with {delays['navigation_delay']:.2f}s delay...")
                    time.sleep(delays['navigation_delay'])
                    
                    # Navigate with realistic options
                    try:
                        response = page.goto(url, 
                                           wait_until='domcontentloaded',
                                           timeout=30000,
                                           referer=headers.get('Referer', 'https://www.google.com/'))
                        
                        print(f"[RESPONSE] Status: {response.status if response else 'No response'}")
                        
                        # Wait for page to be interactive with human-like delay
                        page.wait_for_load_state('networkidle', timeout=10000)
                        time.sleep(delays['page_load_delay'])
                        
                        # Human-like behavior simulation
                        print("[BEHAVIOR] Simulating human interactions...")
                        
                        # Random scroll to simulate reading
                        # for _ in range(random.randint(1, 3)):
                        #     scroll_distance = random.randint(200, 800)
                        #     scroll_duration = random.randint(300, 1000)
                        #     page.evaluate(f"""
                        #         window.scrollBy({{
                        #             top: {scroll_distance},
                        #             left: 0,
                        #             behavior: 'smooth'
                        #         }});
                        #     """)
                        #     time.sleep(delays['scroll_delay'])
                        
                        # # Random mouse movement with more human-like patterns
                        # if random.random() < 0.7:
                        #     x = random.randint(100, resolution['width'] - 100)
                        #     y = random.randint(100, resolution['height'] - 100)
                        #     page.mouse.move(x, y, steps=random.randint(5, 15))
                        #     time.sleep(delays['interaction_delay'])
                        
                        # # Random clicks (25% chance)
                        # if random.random() < 0.25:
                        #     click_x = random.randint(100, resolution['width'] - 100)
                        #     click_y = random.randint(100, resolution['height'] - 100)
                        #     page.mouse.click(click_x, click_y, delay=random.randint(50, 200))
                        #     time.sleep(delays['thinking_delay'])
                        
                        # Get page content
                        text = page.content()
                        print(f"[SUCCESS] Content length: {len(text)} characters")
                        
                    except Exception as e:
                        print(f"[ERROR] Navigation failed: {e}")
                        text = page.content() if page else ""
                        
                    finally:
                        # Close browser with random delay
                        time.sleep(random.uniform(0.5, 2.0))
                        browser.close()
                        
            except Exception as e:
                print(f"[CRITICAL] Playwright error: {e}")
                return {"error": f"Playwright execution failed: {str(e)}"}
        
        else:
            # Fallback to requests with maximum stealth
            print("[QUANTUM_STEALTH] Using requests with quantum stealth...")
            
            session = requests.Session()
            session.headers.update(headers)
            
            # Add stealth TLS fingerprinting protection
            session.mount('https://', StealthHttpAdapter())
            session.mount('http://', StealthHttpAdapter())
            
            # Configure connection pooling and realistic behavior
            adapter = requests.adapters.HTTPAdapter(
                max_retries=3,
                pool_connections=10,
                pool_maxsize=10,
                pool_block=False
            )
            session.mount('https://', adapter)
            session.mount('http://', adapter)
            
            # Human-like delay before request
            time.sleep(random.uniform(1.0, 3.0))
            
            try:
                # Randomize IP headers if needed
                if random.random() < 0.5:
                    session.headers.update({
                        'X-Forwarded-For': f"{random.randint(1, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 255)}",
                        'Client-IP': f"{random.randint(1, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 255)}"
                    })
                
                response = session.get(url, 
                                     timeout=30,
                                     allow_redirects=True,
                                     verify=True,
                                     stream=False,
                                     proxies=None)
                
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

    return results


# Example usage and testing
if __name__ == "__main__":
    # Test with a simple example
    test_url = "https://httpbin.org/user-agent"
    test_rules = [
        "//pre/text()",  # XPath to get user agent
        "$.user-agent"   # JSON path if response is JSON
    ]
    
    print("=== QUANTUM STEALTH SCRAPER TEST ===")
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
