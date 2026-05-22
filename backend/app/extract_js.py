"""In-page JS injected by Playwright to collect extractable elements.

Returns a list of {tag, bbox, xpath, css, text, attrs} for every element
on the page that's visible, inside the viewport, and either has its own
direct text or is a media/interactive element (img, a, button, input).

The picker UI renders these as hover-highlightable overlay boxes on top
of a screenshot of the page. Keeping the traversal entirely in the page
context (rather than doing it server-side on the serialized HTML) means
the bboxes line up pixel-perfect with the screenshot.
"""

COLLECT_ELEMENTS_JS = r"""
(() => {
    // Cap output so pages with 10k+ DOM nodes (Amazon, LinkedIn, etc.)
    // don't blow past CDP's serialization budget. 3000 is enough for the
    // picker to cover the primary content region + a healthy margin.
    const MAX_ELEMENTS = 3000;
    // Tags we always collect even if they have no direct text (media/interactive)
    const ALWAYS = new Set(["A", "IMG", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "VIDEO"]);

    // Tags we skip entirely (structural/invisible/noise)
    const SKIP = new Set([
        "SCRIPT", "STYLE", "META", "LINK", "HEAD", "HTML", "BODY",
        "NOSCRIPT", "TEMPLATE", "SVG", "PATH", "DEFS", "G", "USE",
    ]);

    function directText(el) {
        let t = "";
        for (const n of el.childNodes) {
            if (n.nodeType === Node.TEXT_NODE) t += n.nodeValue;
        }
        return t.trim();
    }

    function isVisible(el) {
        const s = window.getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none" || parseFloat(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return false;
        return true;
    }

    function cssEscape(s) {
        if (window.CSS && CSS.escape) return CSS.escape(s);
        return String(s).replace(/([^\w-])/g, "\\$1");
    }

    // Detect per-element random IDs (UUIDs, long hex, generated SPA
    // container IDs). Amazon puts a fresh UUID on every product wrapper,
    // which poisons sibling detection — two products with the same
    // structure get different selectors because each is rooted at its
    // own unique id. We skip these so the selector walks past them and
    // uses the shared class/tag path instead.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    function isRandomId(id) {
        if (!id) return false;
        if (UUID_RE.test(id)) return true;
        // 16+ char strings of only hex / random-looking chars are usually
        // generated too. Keep semantic ids like "main-content" (no long
        // pure-hex run) usable.
        if (id.length >= 16 && /^[0-9a-f-]+$/i.test(id) && !/-[a-z]{3,}/i.test(id)) return true;
        // Pure-numeric ids are almost always database row ids that rotate
        // as content changes (HN stories "48225297", forum posts, etc).
        // They look stable to the selector builder but anchor it to a
        // SINGLE row — defeats the "click one, get the whole list" magic.
        // Real semantic ids use letters; treat pure digits as random.
        if (/^\d+$/.test(id)) return true;
        return false;
    }

    function buildCssSelector(el) {
        // Prefer id if CSS-safe, unique, AND not a per-element random id.
        if (el.id && /^[a-zA-Z0-9][\w-]*$/.test(el.id) && !isRandomId(el.id) && document.querySelectorAll("#" + el.id).length === 1) {
            return "#" + el.id;
        }
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === Node.ELEMENT_NODE && cur.tagName !== "HTML") {
            let part = cur.tagName.toLowerCase();
            if (cur.id && /^[a-zA-Z0-9][\w-]*$/.test(cur.id) && !isRandomId(cur.id)) {
                parts.unshift("#" + cur.id);
                break;
            }
            // Single useful class to stabilize (skip utility/hash classes)
            const cls = Array.from(cur.classList || []).find(
                c => /^[a-zA-Z][\w-]{1,40}$/.test(c) && !/^(is-|has-|css-|tw-|sc-|_)/.test(c)
            );
            if (cls) part += "." + cssEscape(cls);
            // Disambiguate with nth-of-type
            const parent = cur.parentElement;
            if (parent) {
                const sameTag = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
                if (sameTag.length > 1) {
                    const idx = sameTag.indexOf(cur) + 1;
                    part += `:nth-of-type(${idx})`;
                }
            }
            parts.unshift(part);
            cur = cur.parentElement;
        }
        return parts.join(" > ");
    }

    function buildXPath(el) {
        if (el.id && /^[a-zA-Z0-9][\w-]*$/.test(el.id) && !isRandomId(el.id) && document.querySelectorAll("#" + el.id).length === 1) {
            return `//*[@id="${el.id}"]`;
        }
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === Node.ELEMENT_NODE && cur.tagName !== "HTML") {
            const tag = cur.tagName.toLowerCase();
            const parent = cur.parentElement;
            if (!parent) { parts.unshift(tag); break; }
            const sameTag = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
            const idx = sameTag.indexOf(cur) + 1;
            parts.unshift(sameTag.length > 1 ? `${tag}[${idx}]` : tag);
            cur = parent;
        }
        return "/" + parts.join("/");
    }

    const collected = [];
    const all = document.querySelectorAll("*");
    const scrollY = window.scrollY || 0;
    const scrollX = window.scrollX || 0;

    all.forEach((el, idx) => {
        const tag = el.tagName;
        if (SKIP.has(tag)) return;
        if (!isVisible(el)) return;

        const text = directText(el);
        const isMedia = ALWAYS.has(tag);

        // Keep if element has own text, is a media/interactive el, or is a leaf
        const hasChildren = el.children.length > 0;
        const isLeaf = !hasChildren && text.length > 0;
        if (!isMedia && !isLeaf && text.length === 0) return;

        // Drop giant container boxes (full-width rows with huge height that
        // would just get in the way of clicking finer elements inside)
        const rect = el.getBoundingClientRect();
        if (rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 0.6 && !isMedia) {
            return;
        }

        const attrs = {};
        if (el.getAttribute("href")) attrs.href = el.getAttribute("href");
        if (el.getAttribute("src")) attrs.src = el.getAttribute("src");
        if (el.getAttribute("alt")) attrs.alt = el.getAttribute("alt");
        if (el.getAttribute("title")) attrs.title = el.getAttribute("title");
        if (el.getAttribute("aria-label")) attrs.aria_label = el.getAttribute("aria-label");
        if (el.value !== undefined && el.value !== "") attrs.value = el.value;

        let preview = text;
        if (!preview && attrs.alt) preview = attrs.alt;
        if (!preview && attrs.aria_label) preview = attrs.aria_label;
        if (!preview && attrs.title) preview = attrs.title;
        if (!preview && tag === "IMG" && attrs.src) preview = "[image]";
        if (!preview && tag === "A" && attrs.href) preview = "[link]";

        collected.push({
            id: idx,
            tag: tag.toLowerCase(),
            bbox: {
                x: Math.round(rect.left + scrollX),
                y: Math.round(rect.top + scrollY),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
            },
            xpath: buildXPath(el),
            css: buildCssSelector(el),
            text: preview.slice(0, 200),
            attrs: attrs,
        });
        if (collected.length >= MAX_ELEMENTS) return;
    });

    return {
        elements: collected,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
        },
        page: {
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
        },
        title: document.title,
        url: window.location.href,
    };
})()
"""


# ─────────────────────────────────────────────────────────────────────────
# Structured-data harvester. Returns `{json_ld, og, twitter, microdata}`
# from the page in a single CDP eval. Drives the deterministic-first
# pipeline (2026-05-22 audit item #7): when a page ships JSON-LD or
# OG tags, we can extract canonical field values with confidence 1.0
# WITHOUT any LLM call and WITHOUT any selector hallucination.
#
# Coverage:
#   • JSON-LD     — every <script type="application/ld+json">. Parsed
#                   into a list of objects (caller flattens schema.org
#                   @graph + nested objects).
#   • Open Graph  — <meta property="og:*"> tags. Keyed by the suffix
#                   (e.g. `og:title` → og.title).
#   • Twitter card— <meta name="twitter:*">. Same shape.
#   • Microdata   — every element with `itemprop`. Returned with the
#                   element's CSS selector so the extractor can locate
#                   it later (high-confidence value source).
# ─────────────────────────────────────────────────────────────────────────
COLLECT_STRUCTURED_JS = r"""
(() => {
    function cssPath(el) {
        if (!el || el === document.body) return 'body';
        if (el.id) return '#' + el.id;
        const parts = [];
        let cur = el;
        while (cur && cur !== document.body && parts.length < 6) {
            let part = cur.tagName.toLowerCase();
            if (cur.className && typeof cur.className === 'string') {
                const cls = cur.className.split(/\s+/).filter(Boolean)[0];
                if (cls) part += '.' + cls.replace(/[^a-zA-Z0-9_-]/g, '');
            }
            parts.unshift(part);
            cur = cur.parentElement;
        }
        return parts.join(' > ');
    }

    // JSON-LD — parse every <script type="application/ld+json">.
    // Invalid JSON gets skipped silently; that's fine, the caller
    // already has heuristic + LLM as fallback.
    const jsonLd = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try {
            const parsed = JSON.parse(s.textContent || s.innerText || '');
            if (Array.isArray(parsed)) jsonLd.push(...parsed);
            else if (parsed) jsonLd.push(parsed);
        } catch (e) {
            // Malformed JSON-LD is common (trailing commas, comments);
            // skip silently rather than blow up.
        }
        // Cap to keep payload bounded on pages with dozens of LD scripts.
        if (jsonLd.length >= 12) return;
    });

    // Open Graph + Twitter card meta tags.
    const og = {};
    const twitter = {};
    document.querySelectorAll('meta[property^="og:"], meta[name^="og:"]').forEach(m => {
        const key = (m.getAttribute('property') || m.getAttribute('name') || '').slice(3); // strip "og:"
        const val = m.getAttribute('content') || '';
        if (key && val && !og[key]) og[key] = val;
    });
    document.querySelectorAll('meta[name^="twitter:"], meta[property^="twitter:"]').forEach(m => {
        const key = (m.getAttribute('name') || m.getAttribute('property') || '').slice(8); // strip "twitter:"
        const val = m.getAttribute('content') || '';
        if (key && val && !twitter[key]) twitter[key] = val;
    });

    // Microdata — itemprop on any element. Cap at 50 to keep payload
    // bounded on big templated pages.
    const microdata = [];
    document.querySelectorAll('[itemprop]').forEach(el => {
        if (microdata.length >= 50) return;
        const prop = el.getAttribute('itemprop');
        if (!prop) return;
        // Value extraction varies by tag: meta uses content, img uses
        // src, a uses href, otherwise innerText.
        let val = '';
        const tag = el.tagName.toLowerCase();
        if (tag === 'meta') val = el.getAttribute('content') || '';
        else if (tag === 'img') val = el.getAttribute('src') || el.getAttribute('alt') || '';
        else if (tag === 'a') val = el.getAttribute('href') || (el.innerText || '').trim();
        else if (tag === 'time') val = el.getAttribute('datetime') || (el.innerText || '').trim();
        else val = (el.innerText || el.textContent || '').trim();
        microdata.push({
            prop: prop,
            value: (val || '').slice(0, 500),
            tag: tag,
            css: cssPath(el),
        });
    });

    return {
        json_ld: jsonLd,
        og: og,
        twitter: twitter,
        microdata: microdata,
    };
})()
"""
