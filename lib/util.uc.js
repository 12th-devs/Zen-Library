// Zen Library — shared helpers.
//
// [audit] This file is a local addition, not upstream (12th-devs/Zen-Library v1.0.0).
//
// It exists because the same three primitives were open-coded across six feature modules,
// and in each case one copy had been fixed and the others had not:
//
//   el()              — was duplicated verbatim in two places in ZenLibrary.uc.js, so every
//                       change to it had to be made twice. It was not, which is how the CSS
//                       escaping below came to be applied at one call site out of four.
//   cssUrl()          — existed as _cssUrlValue() in History.uc.js and was used once.
//   safeExternalUrl() — did not exist here at all. The sibling zen-easel mod has had one
//                       since 0.1; this is the same rule, restated rather than imported so
//                       the two mods stay independent of each other's load order.
//
// Everything in this module is pure and synchronous. It is loaded first by theme.json so
// the feature modules can rely on it being present by the time any of them runs.

"use strict";

(function () {
    if (window.ZenLibraryUtil) return;

    // Every stored URL this mod might navigate to passes through here first.
    //
    // What this exists to stop: history entries, download source URLs and boost domains are
    // all strings that arrive from outside — Places, a server's Content-Disposition, a JSON
    // file — and every one of them ends up as a top-level load. Without a scheme check,
    // javascript:, data:, file:, chrome: and resource: are all reachable, and the callers
    // were passing a *system* triggering principal, which is what would let them run with
    // privilege rather than merely load.
    //
    // Returns the canonical spec, or null.
    const MAX_URL_LENGTH = 4096;

    function safeExternalUrl(raw) {
        if (typeof raw !== "string") return null;
        const trimmed = raw.trim();
        if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;

        let uri;
        try {
            uri = Services.io.newURI(trimmed);
        } catch (e) {
            return null;
        }

        if (uri.scheme !== "https" && uri.scheme !== "http") return null;

        // Embedded credentials render as a title in the list and would be a phishing shape.
        try {
            if (uri.userPass) return null;
        } catch (e) { }

        return uri.spec;
    }

    // Opens a validated URL in a new foreground tab.
    //
    // Deliberately NOT the system principal. A system triggering principal is what lets
    // javascript:, data:, file: and chrome: load with privilege from a string that
    // originated in the history database or in a download's metadata. The scheme gate above
    // already rejects those, and the null principal means a miss in the gate is still not an
    // escalation — two independent reasons the load is safe rather than one.
    function openExternal(win, rawUrl) {
        const spec = safeExternalUrl(rawUrl);
        if (!spec) {
            console.error("[ZenLibrary] refusing to open an unsafe URL:", rawUrl);
            return false;
        }
        try {
            win.gBrowser.selectedTab = win.gBrowser.addTab(spec, {
                triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
                inBackground: false
            });
            return true;
        } catch (e) {
            console.error("[ZenLibrary] could not open", spec, e);
            return false;
        }
    }

    // Escapes a string for use inside a CSS url("...") token.
    //
    // Two separate problems, and the second is the one that actually bites on Windows:
    //
    //   1. A quote closes the token early. Where the result is assigned to .cssText that is
    //      full declaration injection, not merely a broken image — and these strings carry
    //      history URLs and download filenames.
    //   2. A backslash is a CSS escape character. Every Windows path is full of them, so
    //      url("C:\Users\...") silently mangles into something that resolves to nothing.
    //      That is why download icons were blank for most real paths.
    //
    // Newlines and form feeds terminate the token outright, so they go too. Always used with
    // double quotes, which is why ' is not in the set.
    function cssUrl(value) {
        return String(value == null ? "" : value).replace(/["\\\n\r\f]/g, "\\$&");
    }

    // A file's icon, as a CSS url() token. Built from a file: URI rather than from the raw
    // path: moz-icon:// takes a URL, and a bare Windows path is not one — the drive colon,
    // the backslashes, and any %, # or ? in a filename all have to be encoded before the
    // ?size= parameter can be appended without being swallowed.
    function fileIconUrl(path, size = 32) {
        if (!path) return "";
        try {
            const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
            file.initWithPath(path);
            return `moz-icon://${Services.io.newFileURI(file).spec}?size=${size}`;
        } catch (e) {
            return "";
        }
    }

    // Trailing-edge debounce. The search inputs were calling straight through to a recursive
    // filesystem scan on every keystroke; this is what stands between a keypress and that.
    function debounce(fn, ms) {
        let timer = null;
        const wrapped = (...args) => {
            if (timer) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                timer = null;
                fn(...args);
            }, ms);
        };
        wrapped.cancel = () => {
            if (timer) window.clearTimeout(timer);
            timer = null;
        };
        return wrapped;
    }

    // The one element helper. Previously two byte-identical copies in ZenLibrary.uc.js —
    // one on the custom element, one on the module shell — which meant every fix to it had
    // to be applied twice.
    //
    // `innerHTML` is kept because the icon definitions are literal SVG strings written in
    // this codebase, and parsing them is the point. It must never be handed a value that
    // came from a page title, a filename or a URL; those go through `textContent`.
    // Likewise `style` as a string is assigned to cssText, so any URL inside one has to
    // have been through cssUrl() first.
    function el(tag, props = {}, children = []) {
        const node = document.createElement(tag);
        const {
            className, id, textContent, innerHTML, onclick, src, oncontextmenu,
            style, dataset, ...other
        } = props;

        if (className) node.className = className;
        if (id) node.id = id;
        if (textContent !== undefined) node.textContent = textContent;
        if (innerHTML !== undefined) node.innerHTML = innerHTML;
        if (onclick) node.onclick = onclick;
        if (src) node.src = src;
        if (oncontextmenu) node.oncontextmenu = oncontextmenu;

        if (style) {
            if (typeof style === "string") node.style.cssText = style;
            else Object.assign(node.style, style);
        }

        if (dataset) Object.assign(node.dataset, dataset);

        for (const key in other) {
            if (key.startsWith("on")) node[key] = other[key];
            else node.setAttribute(key, other[key]);
        }

        if (children) {
            if (Array.isArray(children)) {
                for (const child of children) {
                    if (child) {
                        node.appendChild(
                            child instanceof Node ? child : document.createTextNode(String(child))
                        );
                    }
                }
            } else if (children instanceof Node) {
                node.appendChild(children);
            } else {
                node.appendChild(document.createTextNode(String(children)));
            }
        }
        return node;
    }

    // FLIP reorder after a card is removed: remaining siblings keep their old
    // screen position for one frame, then ease to the hole the deletion left.
    function flipFrom(firstRects, duration = 280) {
        const easing = "var(--zen-library-easing, cubic-bezier(0.4, 0, 0.2, 1))";
        // Measure every card before writing any style; interleaving forces one reflow per card.
        const moved = [];
        for (const [node, first] of firstRects) {
            if (!node.isConnected) continue;
            const last = node.getBoundingClientRect();
            const dx = first.left - last.left;
            const dy = first.top - last.top;
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
            moved.push([node, dx, dy]);
        }
        if (!moved.length) return;

        for (const [node, dx, dy] of moved) {
            node.style.transition = "none";
            node.style.transform = `translate(${dx}px, ${dy}px)`;
        }
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                for (const [node] of moved) {
                    if (!node.isConnected) continue;
                    node.style.transition = `transform ${duration}ms ${easing}`;
                    node.style.transform = "";
                }
            });
        });
        window.setTimeout(() => {
            for (const [node] of moved) {
                if (!node.isConnected) continue;
                node.style.transition = "";
                node.style.transform = "";
            }
        }, duration + 40);
    }

    function animateCardRemove(card, { siblings, duration = 180 } = {}) {
        if (!card) return Promise.resolve();
        const peers = siblings || [...(card.parentElement?.children || [])].filter(n => n !== card);
        const first = new Map();
        for (const node of peers) {
            if (node?.isConnected) first.set(node, node.getBoundingClientRect());
        }
        card.classList.add("library-card-exiting");
        return new Promise(resolve => {
            window.setTimeout(() => {
                card.remove();
                flipFrom(first);
                resolve();
            }, duration);
        });
    }

    window.ZenLibraryUtil = {
        safeExternalUrl,
        openExternal,
        cssUrl,
        fileIconUrl,
        debounce,
        el,
        animateCardRemove
    };
})();
