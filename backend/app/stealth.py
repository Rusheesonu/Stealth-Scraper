"""Stealth config — chromium args + JS init script.

Ported from the `stealthio` production stack. nodriver already patches
Chromium at the binary/flag level better than Playwright+stealth-js ever
could, so this is additive — the JS here closes the remaining
fingerprint leaks (webdriver flag, chrome.runtime shape, plugin count,
WebGL vendor, screen dims, hardware spoof, permissions query).
"""

from __future__ import annotations

import sys


# Linux-only args harm us on macOS (Chrome refuses --no-sandbox without
# code-signing entitlements; /dev/shm doesn't exist). Applied only when
# running inside a container / on a CI runner.
_IS_LINUX = sys.platform.startswith("linux")


ULTRA_STEALTH_CHROMIUM_ARGS: list[str] = [
    # Headless — the "new" mode is far less fingerprint-able than old headless.
    "--headless=new",
    "--disable-gpu",

    # Core anti-detection
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--start-maximized",
    "--window-size=1920,1080",

    # Quiet noise that leaks automation markers
    "--disable-sync",
    "--disable-default-apps",
    "--disable-translate",
    "--disable-component-update",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",

    # Real-ish UA. nodriver also spoofs this via CDP but setting here
    # catches any code path that checks before CDP takes over.
    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36",
]

if _IS_LINUX:
    ULTRA_STEALTH_CHROMIUM_ARGS.extend(["--no-sandbox", "--disable-dev-shm-usage"])


# Injected via CDP Page.addScriptToEvaluateOnNewDocument so it runs
# before any page JS, on every navigation. Patches the well-known
# headless fingerprint tells.
ULTRA_STEALTH_JS = r"""
(() => {
    'use strict';

    // 1. WEBDRIVER
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined, configurable: true
    });

    // 2. CHROME RUNTIME — headless Chromium has no chrome.runtime by
    // default; presence is a major "real browser" signal.
    const originalChrome = window.chrome;
    Object.defineProperty(window, 'chrome', {
        get: () => ({
            ...(originalChrome || {}),
            runtime: {
                id: 'abcdefghijklmnopqrstuvwxyz',
                getManifest: () => ({ version: '1.0.0', name: 'Chrome Extension' }),
                getURL: (p) => `chrome-extension://abc/${p}`,
            },
            csi: () => ({}),
            loadTimes: () => ({
                requestTime: Date.now() / 1000,
                startLoadTime: Date.now() / 1000,
            }),
        }),
        configurable: true,
    });

    // 3. PLUGINS + LANGUAGES
    Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5], configurable: true
    });
    Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'], configurable: true
    });

    // 4. PERMISSIONS leak — headless returns "denied" for notifications
    // even when Notification.permission says "default". Fix the mismatch.
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (p) =>
        p.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : origQuery(p);

    // 5. WEBGL VENDOR/RENDERER — headless reports "Google SwiftShader";
    // real machines report Intel/NVIDIA/AMD.
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.call(this, parameter);
    };

    // 6. SCREEN / WINDOW DIMENSIONS — headless defaults to 800x600.
    Object.defineProperty(window, 'innerWidth',  { get: () => 1920 });
    Object.defineProperty(window, 'innerHeight', { get: () => 1080 });
    Object.defineProperty(window, 'outerWidth',  { get: () => 1920 });
    Object.defineProperty(window, 'outerHeight', { get: () => 1080 });

    // 7. HARDWARE SPOOF
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 1 });
})();
"""
