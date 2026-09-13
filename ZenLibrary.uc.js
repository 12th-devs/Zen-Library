"use strict";

(function () {
    // Cleanup previous instance
    if (window.gZenLibrary && window.gZenLibrary.destroy) {
        window.gZenLibrary.destroy();
    }

    const _ucScriptPath = Components.stack.filename;

    // The one list of sections. Adding one means a new entry here, its sidebar icon below,
    // an `update()` dispatch branch, an `applyTargetWidth` case if it sizes itself, and a
    // theme.json script entry.
    const SECTIONS = {
        downloads: { global: "ZenLibraryDownloads", script: "features/Downloads.uc.js" },
        history:   { global: "ZenLibraryHistory",   script: "features/History.uc.js" },
        media:     { global: "ZenLibraryMedia",     script: "features/Media.uc.js" },
        spaces:    { global: "ZenLibrarySpaces",    script: "features/Spaces.uc.js" },
        boosts:    { global: "ZenLibraryBoosts",    script: "features/Boosts.uc.js" },
        easels:    { global: "ZenLibraryEasels",    script: "features/Easels.uc.js" }
    };
    const SECTION_IDS = Object.keys(SECTIONS);
    const DEFAULT_TAB = "downloads";

    // Load feature modules that may not have been loaded yet
    const _loadFeatureIfMissing = (windowProp, relPath) => {
        if (window[windowProp]) return;
        try {
            const scriptPath = _ucScriptPath.replace(/[^/\\]*\.uc\.js(\?.*)?$/i, relPath);
            Services.scriptloader.loadSubScript(scriptPath, window);
        } catch (e) {
            console.error(`[ZenLibrary] Failed to load ${relPath}:`, e);
        }
    };

    // [audit] MAINT-1 — the shared helpers must exist before anything else runs. theme.json
    // loads them first, but this covers a partial rebuild where only this file was reloaded.
    _loadFeatureIfMissing("ZenLibraryUtil", "lib/util.uc.js");
    for (const { global, script } of Object.values(SECTIONS)) _loadFeatureIfMissing(global, script);

    /**
     * Reusable Component for Library Items
     * Moved here to ensure it is defined before use by feature modules
     */
    class ZenLibraryItem extends HTMLElement {
        constructor() {
            super();
            // Use Light DOM to inherit global ZenLibrary.css styles
        }

        connectedCallback() {
            if (this.hasAttribute('rendered')) return;
            this.render();
            this.setAttribute('rendered', 'true');
        }

        static get observedAttributes() {
            return ['title', 'subtitle', 'hover-subtitle', 'time', 'icon', 'status'];
        }

        attributeChangedCallback(name, oldValue, newValue) {
            if (this._structureCreated) {
                this.updateValues();
            }
        }

        set data(item) {
            this._item = item;
            if (this._structureCreated) {
                this.updateValues();
            } else {
                this.render(); // Render structure if not already
            }
        }

        get data() { return this._item; }

        render() {
            // If already rendered structure, just update values
            if (this._structureCreated) {
                this.updateValues();
                return;
            }

            this.innerHTML = "";
            this.className = "library-list-item";

            // Check status for deleted/disabled state
            if (this._item && this._item.status === 'deleted') {
                this.classList.add('deleted');
            }
            if (this.hasAttribute('pop-in')) {
                this.classList.add('pop-in');
            }

            // Main container for left side (Icon + Info)
            const mainGroup = document.createElement('div');
            mainGroup.style.display = "flex";
            mainGroup.style.alignItems = "center";
            mainGroup.style.flex = "1";
            mainGroup.style.minWidth = "0"; // Text overflow fix
            mainGroup.style.gap = "8px"; // Match .library-list-item gap

            // Icon Container
            const iconContainer = document.createElement('div');
            iconContainer.className = "item-icon-container";
            const icon = document.createElement('div');
            icon.className = "item-icon";
            iconContainer.appendChild(icon);

            // Info Container
            const info = document.createElement('div');
            info.className = "item-info";
            const title = document.createElement('div');
            title.className = "item-title";
            const subtitle = document.createElement('div');
            subtitle.className = "item-url";
            info.appendChild(title);
            info.appendChild(subtitle);

            mainGroup.appendChild(iconContainer);
            mainGroup.appendChild(info);
            this.appendChild(mainGroup);

            // Time
            const time = document.createElement('div');
            time.className = "item-time";
            this.appendChild(time);

            this._elements = { icon, title, subtitle, time };
            this._structureCreated = true;
            this.updateValues();
        }

        updateValues() {
            if (!this._elements || !this._structureCreated) return;

            const iconUrl = this.getAttribute('icon') || (this._item ? this._item.icon : '');
            const titleVal = this.getAttribute('title') || (this._item ? this._item.title : '');
            const subtitleVal = this.getAttribute('subtitle') || (this._item ? this._item.subtitle : '');
            const hoverSubtitleVal = this.getAttribute('hover-subtitle') || (this._item ? this._item.hoverSubtitle : '');
            const timeVal = this.getAttribute('time') || (this._item ? this._item.time : '');

            // [audit] SEC-3 — was url('${iconUrl}') with no escaping, fed page-icon:<history
            // uri> and moz-icon://<download path>. A visited URL containing a quote could
            // close the token and append a second url(), making this privileged document
            // fetch an attacker-chosen host every time the library opened. cssUrl() escapes
            // quotes and backslashes; the double-quoted form is what it is written for.
            if (iconUrl) {
                this._elements.icon.style.backgroundImage =
                    `url("${window.ZenLibraryUtil.cssUrl(iconUrl)}")`;
            }
            this._elements.title.textContent = titleVal;
            // A hover subtitle swaps in on :hover / [menu-open] (core.css). Built here, not by the
            // section, because every attribute change re-runs this and would flatten it to text.
            if (hoverSubtitleVal) {
                const rest = document.createElement('span');
                rest.className = "item-subtitle-rest";
                rest.textContent = subtitleVal;
                const hover = document.createElement('span');
                hover.className = "item-subtitle-hover";
                hover.textContent = hoverSubtitleVal;
                this._elements.subtitle.replaceChildren(rest, hover);
            } else {
                this._elements.subtitle.textContent = subtitleVal;
            }
            this._elements.time.textContent = timeVal;

            // Update status class based on _item data
            if (this._item && this._item.status === 'deleted') {
                this.classList.add('deleted');
            } else {
                this.classList.remove('deleted');
            }
        }

        appendSecondaryAction(element) {
            this.appendChild(element);
        }
    }

    if (!customElements.get('zen-library-item')) {
        try {
            customElements.define('zen-library-item', ZenLibraryItem);
        } catch (e) {
            console.error("ZenLibrary: Failed to register zen-library-item custom element:", e);
        }
    }
    window.ZenLibraryItem = ZenLibraryItem;

    // Shared state between the controller and the panel; History is the only writer (SET_HISTORY).
    class ZenStore {
        constructor(initialState = {}) {
            this._state = initialState;
            this._listeners = [];
        }

        getState() {
            return this._state;
        }

        subscribe(listener) {
            this._listeners.push(listener);
            return () => {
                this._listeners = this._listeners.filter(l => l !== listener);
            };
        }

        dispatch(action) {
            this._state = this._reducer(this._state, action);
            this._listeners.forEach(listener => listener(this._state));
        }

        _reducer(state, action) {
            switch (action.type) {
                case 'SET_HISTORY':
                    return { ...state, history: action.payload };
                default:
                    return state;
            }
        }
    }

    class ZenLibraryElement extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this._activeTab = (window.gZenLibrary && window.gZenLibrary.lastActiveTab) || DEFAULT_TAB;
            this._initialized = false;

            // Use shared store if available, otherwise create local (fallback)
            this.store = (window.gZenLibrary && window.gZenLibrary.store) ? window.gZenLibrary.store : new ZenStore({
                history: []
            });

            this._sidebarItemEls = {};
            for (const id of SECTION_IDS) this._adoptModule(id);
        }

        // One instance per section per window. The controller's persistent copy (created 2 s
        // after load, so it can prefetch) is preferred; when the panel opens before that, the
        // instance built here is handed back to the controller so destroy() still finds it —
        // History's Places listener, Boosts' observers and Media's blob URLs all live on it.
        _adoptModule(id) {
            const controller = window.gZenLibrary;
            const modules = controller?.getModules?.();
            let module = modules?.[id] || this[id] || null;
            if (!module) {
                const Ctor = window[SECTIONS[id].global];
                if (!Ctor) return null;
                module = new Ctor(this);
                if (modules && !modules[id]) modules[id] = module;
            }
            module.library = this;
            this[id] = module;
            return module;
        }

        get activeTab() { return this._activeTab; }
        set activeTab(val) {
            if (this._activeTab === val) return;
            if (this.media && typeof this.media._stopCurrentAudio === "function") {
                this.media._stopCurrentAudio();
            }
            // Leaving History collapses its filter panel, so returning never
            // lands on a stale open filter state.
            if (this._activeTab === "history") {
                this.history?.resetControls?.();
            }
            this._activeTab = val;
            if (window.gZenLibrary) {
                window.gZenLibrary.lastActiveTab = val;
                window.gZenLibrary._writeLastActiveTab?.(val);
            }
            this.setAttribute("active-tab", val);
            this.style.setProperty("--zen-library-filter-height", "0px");
            this.update();
        }

        connectedCallback() {
            try {
                if (!this._initialized) {
                    const link = document.createElement("link");
                    link.rel = "stylesheet";
                    link.href = _ucScriptPath.replace(/\.uc\.js(\?.*)?$/i, ".css");
                    this.shadowRoot.appendChild(link);

                    // [audit] LEAK-3 — this used to be an anonymous closure handed to the
                    // deprecated MediaQueryList.addListener() and never taken off again. A
                    // fresh <zen-library> is built on every open() and dropped on close(),
                    // but Gecko keeps a MediaQueryList that has listeners alive off the
                    // document, and the closure captures `this` — so every open pinned a
                    // whole detached panel, shadow root, rendered lists and blob-backed
                    // thumbnails included. Kept on the instance so disconnectedCallback can
                    // undo it, and on the modern addEventListener API.
                    this._updateColors = () => {
                        const rootStyle = window.getComputedStyle(document.documentElement);
                        const hoverBg = rootStyle.getPropertyValue("--zen-hover-background") ||
                            rootStyle.getPropertyValue("--tab-hover-background-color");
                        if (hoverBg) {
                            this.style.setProperty("--zen-library-hover-bg", hoverBg);
                        }
                    };
                    this._updateColors();
                    this._colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

                    const container = document.createElement("div");
                    container.className = "zen-library-container";

                    const sidebar = document.createElement("div");
                    sidebar.id = "zen-library-sidebar-container";

                    // Light-DOM slot so Firefox's caption-button CSS (max vs restore
                    // on sizemode) still applies. The real .titlebar-buttonbox-container
                    // is assigned here while the Library is open; it is never cloned.
                    const sidebarTop = document.createElement("div");
                    sidebarTop.className = "zen-library-sidebar-top";
                    const windowButtonSlot = document.createElement("slot");
                    windowButtonSlot.name = "window-buttons";
                    sidebarTop.appendChild(windowButtonSlot);
                    sidebar.appendChild(sidebarTop);

                    const sidebarItemsContainer = document.createElement("div");
                    sidebarItemsContainer.className = "sidebar-items";
                    // Display order, not SECTION_IDS order.
                    const sidebarItems = ["media", "downloads", "easels", "spaces", "boosts", "history"];
                    const parser = new DOMParser();

                    sidebarItems.forEach(id => {
                        const item = document.createElement("div");
                        item.className = "sidebar-button";
                        item.dataset.id = id;

                        let iconSvg;
                        if (id === "downloads") {
                            iconSvg = `
<svg class="zen-downloads-icon" width="28" height="28" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient gradientUnits="userSpaceOnUse" x1="64" y1="40" x2="64" y2="168" id="zen-downloads-grad-front">
      <stop offset="0" style="stop-color: rgb(255, 255, 255)"/>
      <stop offset="1" style="stop-color: rgb(0, 0, 0)"/>
    </linearGradient>
  </defs>

  <!--Circle-->
  <g class="zen-downloads-circle-translate" style="transform-origin: 64px 64px;">
    <circle class="zen-downloads-bg" cx="64" cy="64" r="47.5"
            style="fill: var(--zen-folder-front-bgcolor); fill-opacity: 0;" />
    <circle class="zen-downloads-gradient" cx="64" cy="64" r="47.5"
            style="fill: url(#zen-downloads-grad-front); fill-opacity: 0;" />
    <circle class="zen-downloads-border" cx="64" cy="64" r="47.5"
            style="fill: none; stroke: var(--zen-folder-stroke); stroke-width: 7.1px;" />
  </g>

  <!--Arrow (path)-->
  <path class="zen-downloads-arrow" d="M 64 45 L 64 83 M 50 69 L 64 83 L 78 69"
        style="stroke-width: 7.1px; stroke: var(--zen-folder-stroke); fill: none; stroke-linecap: round; stroke-linejoin: round;" />
</svg>`;
                        } else if (id === "history") {
                            iconSvg = `
<svg class="zen-history-icon" width="28" height="28" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient gradientUnits="userSpaceOnUse" x1="64" y1="0" x2="64" y2="128" id="zen-history-grad-back">
      <stop offset="0" style="stop-color: rgb(255, 255, 255)"/>
      <stop offset="1" style="stop-color: rgb(0, 0, 0)"/>
    </linearGradient>
    <linearGradient gradientUnits="userSpaceOnUse" x1="64" y1="0" x2="64" y2="128" id="zen-history-grad-front">
      <stop offset="0" style="stop-color: rgb(255, 255, 255)"/>
      <stop offset="1" style="stop-color: rgb(0, 0, 0)"/>
    </linearGradient>
  </defs>

  <!-- Box (Back card) -->
  <g class="zen-history-body-translate" style="transform-origin: 0 0; transform: translate(63.977px, 79.047px);">
    <g transform="translate(-39.867, -30.328)">
      <path class="zen-history-bg"
            d="M 3.55 0 L 76.184 0 L 76.184 46.856 A 10.25 10.25 0 0 1 65.934 57.106 L 13.8 57.106 A 10.25 10.25 0 0 1 3.55 46.856 Z"
            style="fill: var(--zen-folder-front-bgcolor); fill-opacity: 0;" />
      <path class="zen-history-gradient"
            d="M 3.55 0 L 76.184 0 L 76.184 46.856 A 10.25 10.25 0 0 1 65.934 57.106 L 13.8 57.106 A 10.25 10.25 0 0 1 3.55 46.856 Z"
            style="fill: url(#zen-history-grad-front); fill-opacity: 0;" />
      <path class="zen-history-border"
            d="M 3.55 0 L 76.184 0 L 76.184 46.856 A 10.25 10.25 0 0 1 65.934 57.106 L 13.8 57.106 A 10.25 10.25 0 0 1 3.55 46.856 Z"
            style="fill: none; stroke: var(--zen-folder-stroke); stroke-width: 7.1px;" />
    </g>
  </g>

  <!-- Top Lid (Front card) - Keyframes Merged -->
  <g class="zen-history-lid" style="transform-origin: 0 0; transform: translate(63.977px, 37.148px) rotate(0deg) translate(-46.852px, -12.82px);">
    <rect class="zen-history-bg" x="3.55" y="3.55" width="86.603" height="18.541" rx="6.05"
          style="fill: var(--zen-folder-front-bgcolor); fill-opacity: 0;" />
    <rect class="zen-history-gradient" x="3.55" y="3.55" width="86.603" height="18.541" rx="6.05"
          style="fill: url(#zen-history-grad-front); fill-opacity: 0;" />
    <rect class="zen-history-border" x="3.55" y="3.55" width="86.603" height="18.541" rx="6.05"
          style="fill: none; stroke: var(--zen-folder-stroke); stroke-width: 7.1px;" />
  </g>

  <!-- Dash (path) -->
  <g class="zen-history-dash-translate" style="transform-origin: 0 0; transform: translate(64px, 65px) scale(0.9, 1);">
    <path class="zen-history-dash-path" fill="none"
          d="M -16 0 L 16 0"
          style="stroke: var(--zen-folder-stroke); stroke-width: 8px; stroke-linecap: round; stroke-linejoin: round;" />
  </g>
</svg>`;
                        } else if (id === "media") {
                            iconSvg = `
<svg class="zen-media-icon" width="28" height="28" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Replaced the jagged clip-path with a precise dynamic Mask (same technique as spaces) -->
    <mask id="zen-media-mask">
      <rect x="-10" y="-10" width="148" height="148" fill="white" />
      <!-- Black cutout precisely matches the front card's size and transform so they mask perfectly -->
      <!-- The width/height match 85.439 + 7.1 stroke, rx matches 9.262 + 3.55 half-stroke -->
      <g class="zen-media-front-card" transform="translate(78.827, 77.737) translate(-46.27, -36.445)">
        <rect x="0" y="0" width="92.539" height="72.891" rx="12.812" fill="black" />
      </g>
    </mask>

    <linearGradient gradientUnits="userSpaceOnUse" x1="64" y1="0" x2="64" y2="128" id="zen-media-grad-back">
      <stop offset="0" style="stop-color: rgb(255, 255, 255)"/>
      <stop offset="1" style="stop-color: rgb(0, 0, 0)"/>
    </linearGradient>
    <linearGradient gradientUnits="userSpaceOnUse" x1="64" y1="0" x2="64" y2="128" id="zen-media-grad-front">
      <stop offset="0" style="stop-color: rgb(255, 255, 255)"/>
      <stop offset="1" style="stop-color: rgb(0, 0, 0)"/>
    </linearGradient>
  </defs>

  <!-- Back card -->
  <!-- Wrapped in an untransformed group so the mask coordinates align globally (same as spaces) -->
  <g class="zen-media-back-wrapper" mask="url(#zen-media-mask)">
    <g class="zen-media-back-card" transform="translate(54.799, 57.743) rotate(-7) translate(-46.27, -36.445)">
      <rect class="zen-media-bg" x="3.55" y="3.55" width="85.439" height="65.791" rx="9.262"
            style="fill: var(--zen-folder-front-bgcolor); fill-opacity: 0;" />
      <rect class="zen-media-gradient" x="3.55" y="3.55" width="85.439" height="65.791" rx="9.262"
            style="fill: url(#zen-media-grad-back); fill-opacity: 0;" />
      <rect class="zen-media-border" x="3.55" y="3.55" width="85.439" height="65.791" rx="9.262"
            style="fill: none; stroke: var(--zen-folder-stroke); stroke-width: 7.1px;" />
    </g>
  </g>

  <!-- Front card (rect) -->
  <g class="zen-media-front-card" transform="translate(78.827, 77.737) translate(-46.27, -36.445)">
    <rect class="zen-media-bg" x="3.55" y="3.55" width="85.439" height="65.791" rx="9.262"
          style="fill: var(--zen-folder-front-bgcolor); fill-opacity: 0;" />
    <rect class="zen-media-gradient" x="3.55" y="3.55" width="85.439" height="65.791" rx="9.262"
          style="fill: url(#zen-media-grad-front); fill-opacity: 0;" />
    <!--Mountain (path)-->
    <g class="zen-media-mountain" transform="translate(0.289, 32.609)">
      <path class="zen-media-mountain-path" d="M7.432 21.147 L17.865 12.11 C19.665 10.596 21.373 9.862 23.173 9.862 C25.158 9.862 27.005 10.596 28.805 12.202 L36.191 18.853 L54.84 2.431 C56.779 0.734 58.81 0 61.072 0 C63.334 0 65.55 0.826 67.35 2.477 L84.568 18.67 L92 25.78 C92 35.23 87.153 40 77.551 40 L14.495 40 C4.801 40 0 35.275 0 25.78 Z"
            style="fill: var(--zen-folder-stroke);" />
    </g>
    <rect class="zen-media-border" x="3.55" y="3.55" width="85.439" height="65.791" rx="9.262"
          style="fill: none; stroke: var(--zen-folder-stroke); stroke-width: 7.1px;" />
  </g>

  <!--Sun (circle)-->
  <g class="zen-media-sun" transform="translate(64.76, 67.886) translate(-9.914, -9.984)">
    <circle class="zen-media-sun-path" cx="9.914" cy="9.984" r="9.914"
            style="fill: var(--zen-folder-stroke);" />
  </g>
</svg>`;
                        } else if (id === "spaces") {
                            iconSvg = `
<svg class="zen-spaces-icon" width="28" height="28" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Mask using the exact same merged transform as the front card -->
    <mask id="zen-spaces-mask">
      <rect x="-10" y="-10" width="148" height="148" fill="white" />
      <g class="zen-spaces-front-card" style="transform-origin: 0 0; transform: translate(77.02px, 75.93px) rotate(0deg) translate(-35.022px, -44.68px);">
        <rect x="0" y="0" width="70.04" height="89.36" rx="14" fill="black" />
      </g>
    </mask>
<linearGradient gradientUnits="userSpaceOnUse" x1="64" y1="20" x2="64" y2="148" id="zen-spaces-grad-back">
  <stop offset="0" style="stop-color: rgb(255, 255, 255)"/>
  <stop offset="1" style="stop-color: rgb(0, 0, 0)"/>
</linearGradient>
<linearGradient gradientUnits="userSpaceOnUse" x1="64" y1="20" x2="64" y2="148" id="zen-spaces-grad-front">
  <stop offset="0" style="stop-color: rgb(255, 255, 255)"/>
  <stop offset="1" style="stop-color: rgb(0, 0, 0)"/>
</linearGradient>
  </defs>

  <!-- Back Card -->
  <g class="zen-spaces-back-wrapper" mask="url(#zen-spaces-mask)">
    <g class="zen-spaces-back-card" style="transform-origin: 0 0; transform: translate(51.28px, 61.69px) rotate(-17.5deg) translate(-35.022px, -44.68px);">
      <rect class="zen-spaces-bg" x="3.55" y="3.55" width="62.94" height="82.26" rx="10.45"
            style="fill: var(--zen-folder-front-bgcolor); fill-opacity: 0;" />
      <rect class="zen-spaces-gradient" x="3.55" y="3.55" width="62.94" height="82.26" rx="10.45"
            style="fill: url(#zen-spaces-grad-back); fill-opacity: 0;" />
      <rect class="zen-spaces-border" x="3.55" y="3.55" width="62.94" height="82.26" rx="10.45"
            style="fill: none; stroke: var(--zen-folder-stroke); stroke-width: 7.1px;" />
    </g>
  </g>

  <!-- Front Card -->
  <g class="zen-spaces-front-card" style="transform-origin: 0 0; transform: translate(77.02px, 75.93px) rotate(0deg) translate(-35.022px, -44.68px);">
    <rect class="zen-spaces-bg" x="3.55" y="3.55" width="62.94" height="82.26" rx="10.45"
          style="fill: var(--zen-folder-front-bgcolor); fill-opacity: 0;" />
    <rect class="zen-spaces-gradient" x="3.55" y="3.55" width="62.94" height="82.26" rx="10.45"
          style="fill: url(#zen-spaces-grad-front); fill-opacity: 0;" />
    <rect class="zen-spaces-border" x="3.55" y="3.55" width="62.94" height="82.26" rx="10.45"
          style="fill: none; stroke: var(--zen-folder-stroke); stroke-width: 7.1px;" />
  </g>
</svg>`;
                        } else if (id === "boosts") {
                            iconSvg = `
<svg class="zen-boosts-icon" width="28" height="28" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Consolidated identical back and front gradients into a single reusable gradient -->
<linearGradient id="zen-boosts-grad" gradientUnits="userSpaceOnUse" x1="64" y1="16" x2="64" y2="144">
  <stop offset="0" stop-color="#fff" />
  <stop offset="1" stop-color="#000" />
</linearGradient>
    <mask id="zen-boosts-mask" maskContentUnits="userSpaceOnUse">
      <!-- Removed redundant default positioning (x="0" y="0") and minified path data -->
      <rect x="-100" y="-100" width="300" height="300" fill="#fff" />
      <path fill="#000" stroke="#000" stroke-width="8" stroke-linejoin="round" d="M-3.79 54.121C-5.31 51.635-6.984 48.884-7.082 42.132L-7.073 42.091-7.063 42.051C-6.2 38.573-3.904 36.054-1.1 34.382L4.474 31.059C6.968 29.572 9.896 28.739 13.003 29.233 13.558 28.514 14.137 27.648 14.736 26.617L14.752 26.589 14.769 26.561C15.438 25.438 16.22 24.032 17.105 22.317 18.032 20.521 19.176 18.3 20.531 15.65 21.63 13.5 23.221 11.59 25.405 10.221 27.368 8.99 29.589 8.271 31.984 8.218L32.013 8.218C34.325 8.178 36.528 8.749 38.557 9.821 40.713 10.96 42.401 12.627 43.642 14.615L43.662 14.646 63.922 47.997C66.006 51.466 67.049 55.422 66.104 59.547 65.148 63.723 62.394 66.785 58.898 68.869L44.274 77.586C44.222 77.953 44.148 78.323 44.06 78.696 43.24 82.158 40.963 84.66 38.246 86.34L38.205 86.365 32.548 89.738C29.738 91.413 26.42 92.18 22.922 91.299 18.565 90.201 14.485 87.919 10.34 86.196 10.34 86.196 8.779 87.737 7.305 89.123 5.699 90.632 4.021 91.927 2.291 92.956-2.345 95.712-7.442 96.912-12.65 95.581-17.868 94.248-21.776 90.71-24.597 86.068-27.411 81.439-28.702 76.368-27.456 71.195-26.206 66.005-22.739 62.101-18.096 59.333-16.417 58.332-14.507 57.488-12.438 56.763L-12.4 56.75C-10.473 56.089-8.488 55.472-6.445 54.899-5.537 54.635-4.652 54.375-3.79 54.121Z" />
    </mask>
  </defs>

  <!-- Card -->
  <g class="zen-boosts-card" style="transform-origin: 0 0;" transform="translate(61.889 63.143) scale(1.1) rotate(-15)">
    <g class="zen-boosts-card-anchor" transform="translate(-44 -44)">
      <rect class="zen-boosts-bg" x="3.55" y="3.55" width="80.9" height="80.9" rx="12.45" fill="var(--zen-folder-front-bgcolor)" fill-opacity="0" />
      <rect class="zen-boosts-gradient" x="3.55" y="3.55" width="80.9" height="80.9" rx="12.45" fill="url(#zen-boosts-grad)" fill-opacity="0" />
      <rect class="zen-boosts-border" width="88" height="88" rx="16" mask="url(#zen-boosts-mask)" fill="none" stroke="var(--zen-folder-stroke)" stroke-width="7.1" />
    </g>
  </g>

  <!-- Paintbrush -->
  <g class="zen-boosts-brush" style="transform-origin: 0 0;" transform="translate(18.247 109.504) scale(1.1)">
    <g class="zen-boosts-brush-anchor" transform="translate(-15 -70)">
      <!-- Brush Tip -->
      <g class="zen-boosts-brush-tip-translate" transform="translate(27.307 3.73)">
        <path class="zen-boosts-bg" d="M0 28 6 14 12 0 44 34 26 54Z" fill="var(--zen-folder-front-bgcolor)" fill-opacity="0" />
        <path class="zen-boosts-gradient" d="M0 28 6 14 12 0 44 34 26 54Z" fill="url(#zen-boosts-grad)" fill-opacity="0" />
      </g>
      <!-- Brush Silhouette -->
      <g class="zen-boosts-brush-silhouette-fills">
        <path class="zen-boosts-bg" fill="var(--zen-folder-front-bgcolor)" fill-opacity="0" d="M0 69.826C-0.023 66.459 1.467 63.29 4.469 60.318 5.501 59.296 6.814 58.264 8.409 57.219 10.027 56.174 11.717 55.176 13.476 54.154 15.235 53.132 16.877 52.158 18.472 51.229L22.377 48.617 15.024 41.373C13.546 39.91 12.795 38.354 12.772 36.706 12.772 35.034 13.5 33.479 14.954 32.04L19.563 27.478C21.017 26.039 22.577 25.33 24.242 25.353 26.219 25.381 26.531 25.828 28.992 27.547L56.964 55.303C58.465 56.766 59.215 58.322 59.215 59.97 59.238 61.595 58.535 63.139 57.104 64.602L52.46 69.199C51.029 70.615 49.47 71.311 47.781 71.288 46.092 71.288 44.52 70.557 43.066 69.094L35.748 61.816C34.904 62.814 34.012 64.091 33.074 65.647 32.136 67.203 31.15 68.862 30.118 70.627 29.109 72.392 28.078 74.063 27.022 75.642 25.99 77.244 24.946 78.555 23.89 79.577 20.888 82.549 17.686 84.023 14.285 84 10.884 83.977 7.658 82.444 4.609 79.403 1.56 76.385 0.023 73.193 0 69.826ZM56.257 54.603L54.309 52.669 68.012 38.552C68.669 37.902 68.997 37.182 68.997 36.393 68.997 35.604 68.633 34.849 67.906 34.129L41.764 8.289C41.412 7.941 41.048 7.754 40.673 7.731 40.321 7.708 39.993 7.825 39.688 8.08 39.407 8.312 39.196 8.695 39.055 9.229 38.211 12.294 37.495 14.917 36.909 17.099 36.323 19.281 35.712 21.244 35.079 22.985 34.446 24.726 33.636 26.444 32.651 28.139 31.689 29.811 31.369 29.906 31.369 29.906L28.992 27.547 26.531 25.828C27.258 24.69 28.147 22.962 28.64 21.871 29.133 20.757 29.578 19.514 29.977 18.144 30.399 16.751 30.845 15.079 31.314 13.129 31.783 11.156 32.358 8.718 33.038 5.816 33.39 4.307 34.023 3.088 34.938 2.159 35.853 1.207 36.909 0.569 38.105 0.244 39.325-0.081 40.556-0.081 41.799 0.244 43.042 0.546 44.168 1.184 45.177 2.159L72.832 29.567C74.92 31.657 75.975 33.85 75.998 36.149 76.045 38.447 75.049 40.607 73.008 42.627L58.083 56.603 56.257 54.603Z" />
        <path class="zen-boosts-gradient" fill="url(#zen-boosts-grad)" fill-opacity="0" d="M0 69.826C-0.023 66.459 1.467 63.29 4.469 60.318 5.501 59.296 6.814 58.264 8.409 57.219 10.027 56.174 11.717 55.176 13.476 54.154 15.235 53.132 16.877 52.158 18.472 51.229L22.377 48.617 15.024 41.373C13.546 39.91 12.795 38.354 12.772 36.706 12.772 35.034 13.5 33.479 14.954 32.04L19.563 27.478C21.017 26.039 22.577 25.33 24.242 25.353 26.219 25.381 26.531 25.828 28.992 27.547L56.964 55.303C58.465 56.766 59.215 58.322 59.215 59.97 59.238 61.595 58.535 63.139 57.104 64.602L52.46 69.199C51.029 70.615 49.47 71.311 47.781 71.288 46.092 71.288 44.52 70.557 43.066 69.094L35.748 61.816C34.904 62.814 34.012 64.091 33.074 65.647 32.136 67.203 31.15 68.862 30.118 70.627 29.109 72.392 28.078 74.063 27.022 75.642 25.99 77.244 24.946 78.555 23.89 79.577 20.888 82.549 17.686 84.023 14.285 84 10.884 83.977 7.658 82.444 4.609 79.403 1.56 76.385 0.023 73.193 0 69.826ZM56.257 54.603L54.309 52.669 68.012 38.552C68.669 37.902 68.997 37.182 68.997 36.393 68.997 35.604 68.633 34.849 67.906 34.129L41.764 8.289C41.412 7.941 41.048 7.754 40.673 7.731 40.321 7.708 39.993 7.825 39.688 8.08 39.407 8.312 39.196 8.695 39.055 9.229 38.211 12.294 37.495 14.917 36.909 17.099 36.323 19.281 35.712 21.244 35.079 22.985 34.446 24.726 33.636 26.444 32.651 28.139 31.689 29.811 31.369 29.906 31.369 29.906L28.992 27.547 26.531 25.828C27.258 24.69 28.147 22.962 28.64 21.871 29.133 20.757 29.578 19.514 29.977 18.144 30.399 16.751 30.845 15.079 31.314 13.129 31.783 11.156 32.358 8.718 33.038 5.816 33.39 4.307 34.023 3.088 34.938 2.159 35.853 1.207 36.909 0.569 38.105 0.244 39.325-0.081 40.556-0.081 41.799 0.244 43.042 0.546 44.168 1.184 45.177 2.159L72.832 29.567C74.92 31.657 75.975 33.85 75.998 36.149 76.045 38.447 75.049 40.607 73.008 42.627L58.083 56.603 56.257 54.603Z" />
      </g>
      <!-- Brush Border -->
      <path class="zen-boosts-border" fill-rule="evenodd" fill="var(--zen-folder-stroke)" d="M0 69.826C-0.023 66.459 1.467 63.29 4.469 60.318 5.501 59.296 6.814 58.264 8.409 57.219 10.027 56.174 11.717 55.176 13.476 54.154 15.235 53.132 16.877 52.158 18.472 51.229L22.377 48.617 15.024 41.373C13.546 39.91 12.795 38.354 12.772 36.706 12.772 35.034 13.5 33.479 14.954 32.04L19.563 27.478C21.017 26.039 22.577 25.33 24.242 25.353 26.219 25.381 26.531 25.828 28.992 27.547L56.964 55.303C58.465 56.766 59.215 58.322 59.215 59.97 59.238 61.595 58.535 63.139 57.104 64.602L52.46 69.199C51.029 70.615 49.47 71.311 47.781 71.288 46.092 71.288 44.52 70.557 43.066 69.094L35.748 61.816C34.904 62.814 34.012 64.091 33.074 65.647 32.136 67.203 31.15 68.862 30.118 70.627 29.109 72.392 28.078 74.063 27.022 75.642 25.99 77.244 24.946 78.555 23.89 79.577 20.888 82.549 17.686 84.023 14.285 84 10.884 83.977 7.658 82.444 4.609 79.403 1.56 76.385 0.023 73.193 0 69.826ZM20.618 38.308L29.133 46.701C29.86 47.398 30.188 48.187 30.118 49.069 30.048 49.951 29.625 50.799 28.851 51.612 28.171 52.309 27.034 53.11 25.439 54.015 23.844 54.92 22.037 55.931 20.02 57.045 18.026 58.159 16.044 59.355 14.074 60.632 12.104 61.909 10.427 63.232 9.043 64.602 7.425 66.181 6.615 67.887 6.615 69.721 6.638 71.555 7.471 73.297 9.113 74.945 10.778 76.57 12.525 77.383 14.355 77.383 16.208 77.406 17.945 76.617 19.563 75.015 20.97 73.645 22.307 71.985 23.574 70.035 24.864 68.085 26.072 66.122 27.198 64.149 28.324 62.152 29.344 60.377 30.259 58.821 31.197 57.242 32.007 56.116 32.687 55.443 33.508 54.654 34.364 54.235 35.255 54.189 36.146 54.119 36.956 54.444 37.683 55.164L46.127 63.557C46.971 64.416 47.804 64.404 48.625 63.522L51.299 60.875C52.12 60.039 52.132 59.216 51.334 58.403L25.79 33.154C25.415 32.759 25.016 32.574 24.594 32.597 24.172 32.597 23.762 32.794 23.363 33.189L20.618 35.836C19.774 36.649 19.774 37.472 20.618 38.308ZM11.294 72.855C10.473 72.042 10.063 71.068 10.063 69.93 10.063 68.792 10.473 67.818 11.294 67.005 12.115 66.192 13.101 65.786 14.25 65.786 15.399 65.786 16.384 66.192 17.205 67.005 18.026 67.818 18.437 68.792 18.437 69.93 18.437 71.068 18.026 72.042 17.205 72.855 16.384 73.668 15.399 74.074 14.25 74.074 13.101 74.074 12.115 73.668 11.294 72.855ZM56.257 54.603L54.309 52.669 68.012 38.552C68.669 37.902 68.997 37.182 68.997 36.393 68.997 35.604 68.633 34.849 67.906 34.129L41.764 8.289C41.412 7.941 41.048 7.754 40.673 7.731 40.321 7.708 39.993 7.825 39.688 8.08 39.407 8.312 39.196 8.695 39.055 9.229 38.211 12.294 37.495 14.917 36.909 17.099 36.323 19.281 35.712 21.244 35.079 22.985 34.446 24.726 33.636 26.444 32.651 28.139 31.689 29.811 31.369 29.906 31.369 29.906L28.992 27.547 26.531 25.828C27.258 24.69 28.147 22.962 28.64 21.871 29.133 20.757 29.578 19.514 29.977 18.144 30.399 16.751 30.845 15.079 31.314 13.129 31.783 11.156 32.358 8.718 33.038 5.816 33.39 4.307 34.023 3.088 34.938 2.159 35.853 1.207 36.909 0.569 38.105 0.244 39.325-0.081 40.556-0.081 41.799 0.244 43.042 0.546 44.168 1.184 45.177 2.159L72.832 29.567C74.92 31.657 75.975 33.85 75.998 36.149 76.045 38.447 75.049 40.607 73.008 42.627L58.083 56.603 56.257 54.603ZM50.455 37.786C52.425 35.836 54.138 33.7 55.592 31.378 57.07 29.056 57.973 26.352 58.301 23.264L66.041 30.89C65.15 32.004 63.93 33.142 62.382 34.303 60.834 35.441 59.216 36.463 57.527 37.368 55.862 38.25 54.36 38.878 53.023 39.249 51.709 39.62 50.818 39.573 50.349 39.109 49.927 38.714 49.962 38.274 50.455 37.786Z" />
    </g>
  </g>

  <!-- Sparkle Small -->
  <g class="zen-boosts-star-small" style="transform-origin: 0 0;" transform="translate(68.002 37.075) rotate(2.014)">
    <g class="zen-boosts-star-small-anchor" transform="translate(-8 -8)">
      <path class="zen-boosts-border" d="M8 0C8 4.418 4.418 8 0 8 4.418 8 8 11.582 8 16 8 11.582 11.582 8 16 8 11.582 8 8 4.418 8 0Z" fill="var(--zen-folder-stroke)" stroke="var(--zen-folder-stroke)" stroke-width="3" stroke-linejoin="round" />
    </g>
  </g>

  <!-- Sparkle Large -->
  <g class="zen-boosts-star-large" style="transform-origin: 0 0;" transform="translate(85.002 50.174) rotate(2.014)">
    <g class="zen-boosts-star-large-anchor" transform="translate(-12 -12)">
      <path class="zen-boosts-border" d="M12 0C12 6.627 6.627 12 0 12 6.627 12 12 17.373 12 24 12 17.373 17.373 12 24 12 17.373 12 12 6.627 12 0Z" fill="var(--zen-folder-stroke)" stroke="var(--zen-folder-stroke)" stroke-width="3" stroke-linejoin="round" />
    </g>
  </g>
</svg>`;
                        } else if (id === "easels") {
                            iconSvg = `
<svg class="zen-easels-icon" width="28" height="28" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient gradientUnits="userSpaceOnUse" x1="64" y1="10" x2="64" y2="138" id="zen-easels-grad-front">
      <stop offset="0" style="stop-color: rgb(255, 255, 255)"/>
      <stop offset="1" style="stop-color: rgb(0, 0, 0)"/>
    </linearGradient>

    <!-- Punches the inner pane out of the outer frame so the pane is genuinely
         see-through when idle. The cutout carries the same class and origin as the
         real pane below, so it tracks the pane's scale (same trick as Media/Spaces). -->
    <mask id="zen-easels-mask">
      <rect x="-10" y="-10" width="148" height="148" fill="white" />
      <g class="zen-easels-inner-pane" style="transform-origin: 64px 71.28px;">
        <rect x="16.16" y="36.04" width="95.68" height="70.48" rx="8" fill="black" />
      </g>
    </mask>
  </defs>

  <g class="zen-easels-bounce" style="transform-origin: 64px 64px;">

    <!-- 1. OUTER FRAME — rect 1 of the source (200x183, rx 15). Solid stroke-token fill, no stroke. -->
    <g class="zen-easels-outer-frame" mask="url(#zen-easels-mask)">
      <rect class="zen-easels-frame-fill" x="8" y="12.76" width="112" height="102.48" rx="12"
            style="fill: var(--zen-folder-stroke);" />
    </g>

    <!-- 2. INNER PANE — rect 2 of the source (x11 y38, 178x133, rx 10). Transparent idle,
         fills with the front-bgcolor token on active. No border. -->
    <g class="zen-easels-inner-pane" style="transform-origin: 64px 71.28px;">
      <rect class="zen-easels-bg" x="16.16" y="36.04" width="95.68" height="70.48" rx="8"
            style="fill: var(--zen-folder-front-bgcolor); fill-opacity: 0;" />
      <rect class="zen-easels-gradient" x="16.16" y="36.04" width="95.68" height="70.48" rx="8"
            style="fill: url(#zen-easels-grad-front); fill-opacity: 0;" />
    </g>

    <!-- 3. SQUIGGLE — doodle on the pane. Stroke token. The 0.82 rest scale is repeated in
         every keyframe of zenEaselsSquiggle, the way the Boosts pieces carry theirs. -->
    <g class="zen-easels-squiggle" style="transform-origin: 64px 71.28px; transform: scale(0.82);">
      <path d="M 79.08 42.08 C 91.19 54.79 88.45 58.62 81.98 56.04 C 75.51 53.47 66.12 44.54 59.62 47.55 C 53.12 50.56 91.47 84.24 77.76 86.61 C 72.57 87.51 43.87 53.27 34.03 56.04 C 23.75 58.94 58.53 84.24 60.64 100.31"
            style="fill: none; stroke: var(--zen-folder-stroke); stroke-width: 7.1px; stroke-linecap: round; stroke-linejoin: round;" />
    </g>

  </g>
</svg>`;
                        }
                        if (iconSvg) {
                            const doc = parser.parseFromString(iconSvg, "image/svg+xml");
                            const iconNode = doc.documentElement;
                            iconNode.removeAttribute("xmlns");
                            item.appendChild(iconNode);
                        } else {
                            const iconDiv = document.createElement("div");
                            iconDiv.className = `icon ${id}-icon`;
                            item.appendChild(iconDiv);
                        }

                        const labelSpan = document.createElement("span");
                        labelSpan.className = "label";
                        labelSpan.textContent = id.charAt(0).toUpperCase() + id.slice(1);
                        item.appendChild(labelSpan);

                        item.onclick = () => {
                            if (this.activeTab === id) {
                                // resetView also collapses the filter panel (resetControls).
                                if (id === "history") this.history?.resetView?.();
                                this.update(true);
                            }
                            else this.activeTab = id;
                        };
                        sidebarItemsContainer.appendChild(item);
                        this._sidebarItemEls[id] = item;
                    });
                    sidebar.appendChild(sidebarItemsContainer);

                    const footer = document.createElement("div");
                    footer.className = "sidebar-button-footer";

                    // Native toolbarbuttons like Zen's sidebar action buttons
                    // (#zen-expand-sidebar-button): list-style-image + context-fill,
                    // themed by --toolbarbutton-icon-fill. The image URL lives in CSS
                    // so it matches how Zen declares every other toolbar icon.
                    const makeFooterButton = (title, command) => {
                        const btn = document.createXULElement("toolbarbutton");
                        btn.className = "toolbarbutton-1 chromeclass-toolbar-additional zen-sidebar-action-button sidebar-footer-button";
                        // XUL tooltips read tooltiptext, not title.
                        btn.setAttribute("tooltiptext", title);
                        btn.setAttribute("aria-label", title);
                        btn.addEventListener("command", command);
                        return btn;
                    };

                    const exitBtn = makeFooterButton("Exit Library", () => window.gZenLibrary.close());
                    exitBtn.classList.add("sidebar-button-exit");
                    exitBtn.dataset.id = "exit";

                    const donateBtn = makeFooterButton("Donate to Zen", () => {
                        window.openTrustedLinkIn("https://www.zen-browser.app/donate", "tab");
                        window.gZenLibrary.close();
                    });
                    donateBtn.classList.add("sidebar-button-donate");
                    donateBtn.dataset.id = "donate";

                    footer.appendChild(exitBtn);
                    footer.appendChild(donateBtn);
                    sidebar.appendChild(footer);
                    container.appendChild(sidebar);

                    const panel = document.createElement("div");
                    panel.id = "zen-library-main-panel";
                    panel.innerHTML = `
                        <header class="library-header"></header>
                        <div class="library-content"></div>
                    `;
                    container.appendChild(panel);
                    this.shadowRoot.appendChild(container);

                    this._initialized = true;
                }
                // Outside the _initialized guard so a re-connect re-arms it after
                // disconnectedCallback took it off. Re-adding the same function reference
                // is a no-op, so running this on every connect is safe.
                if (this._colorSchemeQuery) {
                    this._colorSchemeQuery.addEventListener("change", this._updateColors);
                }
                this.setAttribute("active-tab", this.activeTab);
                this.update();
            } catch (e) {
                console.error("ZenLibrary Error in connectedCallback:", e);
            }
        }

        // See LEAK-3 above. close() and destroy() both take this element out of the DOM,
        // which is the only signal that the panel it holds is finished with.
        disconnectedCallback() {
            if (this._colorSchemeQuery && this._updateColors) {
                this._colorSchemeQuery.removeEventListener("change", this._updateColors);
            }
            // The caption cluster is a light-DOM child of this host while adopted.
            // If the panel is torn down without going through close(), put it back
            // before the host (and those buttons) leave the document.
            try { window.gZenLibrary?._restoreWindowButtons(); } catch (e) { }
        }

        // Fallback `true` matches preferences.json: Sine only writes a defaultValue when the settings page is opened.
        _atgCompatEnabled() {
            try { return Services.prefs.getBoolPref("zen.library.compat.advanced-tab-groups", true); } catch (e) { return true; }
        }

        // What a section leaves in .library-content when it is mounted; update() skips the
        // render while it is still there. Spaces has none: its render() always rebuilds.
        static SECTION_CONTAINERS = {
            downloads: ".library-list-container",
            history: ".library-list-container",
            media: ".media-grid",
            boosts: ".library-list-container",
            easels: ".easel-card-grid",
            spaces: null
        };

        // Native zen-library: 84px sidebar + 27rem content (media/spaces size themselves). Never wider than 95vw.
        // Pure DOM-free math so the controller can apply it before the host is inserted and styled for the first time.
        applyTargetWidth() {
            let targetWidth = 516;
            if (this.activeTab === "spaces" && window.ZenLibrarySpaces) {
                const ws = window.ZenLibrarySpaces.getWorkspaces();
                targetWidth = window.ZenLibrarySpaces.calculatePanelWidth(ws.length);
            } else if (this.activeTab === "media") {
                const count = window.gZenLibraryMediaCount ?? 0;
                if (window.ZenLibrarySpaces?.calculateMediaWidth) targetWidth = window.ZenLibrarySpaces.calculateMediaWidth(count);
            } else if (this.activeTab === "easels") {
                // The fluid two-column grid is exact at 84 sidebar + 36 side padding + 320 cards + 18 gap.
                targetWidth = 458;
            }
            targetWidth = Math.min(Math.max(targetWidth, 516), window.innerWidth * 0.95);
            this._lastTargetWidth = targetWidth;
            this.style.setProperty("--zen-library-width", `${targetWidth}px`);
            return targetWidth;
        }

        // Width, offset and content shift only — no header or section work. update() runs
        // this first; Media calls it on its own when its filtered count changes mid-render,
        // which used to go through a full nested update() and could remount the section.
        syncWidth() {
            // Width first: _measureToolboxWidth flushes style, and the host must never be styled at the 516px default or it transitions from there.
            const targetWidth = this.applyTargetWidth();
            // PR shift: panel width minus the live toolbox width; measured by the controller so the tween agrees.
            const toolboxWidth = window.gZenLibrary?._measureToolboxWidth?.() ?? 0;
            document.documentElement.style.setProperty("--zen-library-offset", `${Math.max(0, targetWidth - toolboxWidth)}px`);
            // The content shift follows the live (transitioning) width via the controller's ResizeObserver.
            window.gZenLibrary?._syncShift?.();
        }

        // `force` re-renders the current section in place (Easels after an index change, rename, delete or search).
        update(force = false) {
            // ATG compat: its tab-strip hooks call update(true) on every tab move/close/drop. Only Spaces reads
            // that tree, and there a card repaint keeps every list's scroll position where a grid rebuild would not.
            if (force && this._atgCompatEnabled() &&
                String(Components.stack.caller?.filename || "").includes("advanced-tab-groups")) {
                if (this.activeTab === "spaces" && this.spaces?.refreshAllCards && this.shadowRoot.querySelector(".library-workspace-grid")) {
                    // A drop handled here already repainted; ATG's debounced sync lands ~150ms later.
                    this.spaces.refreshAllCards({ skipIfFresherThan: 400 });
                    return;
                }
                force = false;
            }
            try {
                // Check if custom elements are properly registered
                if (!customElements.get('zen-library-item')) {
                    console.error("ZenLibrary Error: zen-library-item custom element not registered");
                    return;
                }

                this.syncWidth();

                for (const id in this._sidebarItemEls) {
                    this._sidebarItemEls[id].classList.toggle("active", id === this.activeTab);
                }

                const content = this.shadowRoot.querySelector(".library-content");
                const header = this.shadowRoot.querySelector(".library-header");
                const tabChanged = this._lastRenderedTab !== this.activeTab;
                // `tabChanged` alone is not enough: it only tracks what update() last ran
                // for, not what is actually sitting in .library-content. Anything that
                // replaces the content behind update()'s back leaves a stale tab's markup
                // in place while the selector checks below happily find their container.
                const contentBelongsToTab = content?.dataset?.tab === this.activeTab;
                // Entrance fade is for opening a section, not for in-place updates
                // (delete, rename, search, index refresh). Those remount the same
                // grid and would otherwise replay library-content-fade-in.
                this._contentEntering = tabChanged || !contentBelongsToTab;
                this._lastRenderedTab = this.activeTab;

                // Header / Search Bar Logic
                if (this.activeTab !== "spaces") {
                    if (force || tabChanged || !header.firstElementChild) {
                        // Read before the header is cleared; a forced rebuild must not wipe the field or drop focus (Easels re-renders through update(true)).
                        const hadFocus = this.shadowRoot.activeElement?.closest?.(".library-header") != null;
                        header.innerHTML = "";
                        // A rebuilt header must cancel the old timer rather than leave it to fire against a detached container.
                        if (this._searchDebounce) this._searchDebounce.cancel();
                        this._searchDebounce = null;

                        const module = this[this.activeTab];
                        if (module && typeof module.renderHeaderControls === "function") {
                            // History: owns its search field, filter panel and debounce.
                            header.appendChild(module.renderHeaderControls());
                        } else {
                            // [audit] PERF-1 — the results pass is debounced. It used to run on
                            // every keystroke, and for Downloads and Media that meant a full
                            // recursive filesystem walk per character typed. The search *term*
                            // is still recorded synchronously so the field never feels laggy;
                            // only the re-render is deferred.
                            this._searchDebounce = window.ZenLibraryUtil.debounce(() => {
                                const tab = this.activeTab;
                                if (tab === "downloads" && this.downloads) {
                                    // Both of these now filter a cached list rather than going
                                    // back to the download history or the filesystem: the fetch
                                    // no longer depends on the search term.
                                    if (this.downloads._cachedDownloads) {
                                        this.downloads.renderList(this.downloads._cachedDownloads);
                                    } else {
                                        this.downloads.fetchDownloads().then(d => this.downloads.renderList(d));
                                    }
                                } else if (tab === "media" && this.media) {
                                    // Search is a pure filter over the scanned list, so use
                                    // whatever the last scan produced regardless of its age
                                    // rather than re-walking Downloads mid-typing.
                                    if (this.media._scanCache) {
                                        this.media.renderList(this.media._scanCache);
                                    } else {
                                        this.media.fetchDownloads().then(d => this.media.renderList(d));
                                    }
                                } else if (tab === "boosts" && this.boosts) {
                                    this.boosts.renderList();
                                } else if (tab === "easels" && this.easels) {
                                    // Easels renders from a warm in-memory list, so it goes back
                                    // through update() rather than having a render call of its own.
                                    this.update(true);
                                }
                            }, 300);

                            // PR-style search header shared by every section without its
                            // own renderHeaderControls: pill box with glass icon, same
                            // component History uses, so all search bars sit identically.
                            const val = module?._searchTerm || "";
                            const top = this.el("div", { className: "zen-library-search-top" });
                            const searchInput = this.el("input", {
                                type: "search",
                                placeholder: `Search ${this.activeTab.charAt(0).toUpperCase() + this.activeTab.slice(1)}…`,
                                value: val,
                                oninput: (e) => {
                                    const v = e.target.value;
                                    if (this.media && typeof this.media._stopCurrentAudio === "function") {
                                        this.media._stopCurrentAudio();
                                    }
                                    const module = this[this.activeTab];
                                    if (module) module._searchTerm = v;
                                    // A new search is a new list, so paging starts over. Without
                                    // this the first render of the results keeps however far the
                                    // previous search had been scrolled.
                                    if (this.activeTab === "downloads" && this.downloads) {
                                        this.downloads._visibleLimit = window.ZenLibraryDownloads?.INITIAL_RENDER_LIMIT || 50;
                                    }
                                    if (this.activeTab === "media" && this.media) {
                                        this.media._visibleLimit = window.ZenLibraryMedia?.INITIAL_RENDER_LIMIT || 36;
                                    }
                                    this._searchDebounce();
                                }
                            });
                            top.appendChild(this.el("div", { className: "zen-library-search-header" }, [
                                this.el("div", { className: "zen-library-search-box" }, [
                                    this.el("img", {
                                        src: "chrome://browser/skin/zen-icons/search-glass.svg",
                                        alt: ""
                                    }),
                                    searchInput
                                ]),
                                typeof module?.renderFilterButton === "function" ? module.renderFilterButton() : null
                            ]));
                            header.appendChild(top);

                            // Support for module-specific header extensions (e.g. Media filter bar)
                            if (module && typeof module.renderFilterBar === "function") {
                                header.appendChild(module.renderFilterBar());
                            }
                        }
                        if (hadFocus) {
                            const input = header.querySelector("input");
                            input?.focus();
                            try { input?.setSelectionRange(input.value.length, input.value.length); } catch (e) { }
                        }
                    }
                } else {
                    header.innerHTML = "";
                }

                // Content Rendering via Feature Modules. A module whose script arrived after
                // the constructor (partial Sine rebuild) is adopted here on first use.
                const module = this[this.activeTab] || this._adoptModule(this.activeTab);
                if (!module) {
                    if (tabChanged) {
                        content.innerHTML = `<div class="empty-state${this._contentEntering ? " library-content-fade-in" : ""}">
                             <div class="empty-icon ${this.activeTab}-icon"></div>
                             <h3>Feature not available</h3>
                             <p>The ${this.activeTab} module is not loaded.</p>
                           </div>`;
                        content.dataset.tab = this.activeTab;
                    }
                    return;
                }

                // Spaces always rebuilds (its render() restores scroll itself); the others only
                // when the tab changed, the caller forced it, or their container is missing.
                const container = ZenLibraryElement.SECTION_CONTAINERS[this.activeTab];
                const mounted = contentBelongsToTab && (!container || content.querySelector(container));
                if (container && mounted && !tabChanged && !force) return;

                const node = module.render();
                if (node) {
                    content.innerHTML = "";
                    content.appendChild(node);
                    content.dataset.tab = this.activeTab;
                }
            } catch (e) {
                console.error("ZenLibrary Error in update:", e);
                const content = this.shadowRoot.querySelector(".library-content");
                // textContent, not innerHTML. This runs in privileged chrome and e.message
                // is not a fixed string — it carries URLs, filenames and titles from
                // whichever section threw, any of which can contain markup.
                if (content) {
                    content.replaceChildren(this.el("div", {
                        style: "color:red; padding:20px;",
                        textContent: `Error loading content: ${e.message}`
                    }));
                }
            }
        }

        // [audit] MAINT-1 — one implementation, in lib/util.uc.js. This used to be a full
        // copy, byte-identical to the one in _createModuleShell below, which meant every
        // change had to be made twice and in practice was not.
        el(tag, props = {}, children = []) {
            return window.ZenLibraryUtil.el(tag, props, children);
        }

        enterContent(node) {
            if (this._contentEntering && node) node.classList.add("library-content-fade-in");
            return node;
        }

        svg(svgString) {
            if (!this._svgCache) this._svgCache = new Map();
            if (this._svgCache.has(svgString)) return this._svgCache.get(svgString).cloneNode(true);

            const parser = this._parser || (this._parser = new DOMParser());
            const doc = parser.parseFromString(svgString, "image/svg+xml");
            const node = doc.documentElement;
            if (node) {
                node.removeAttribute("xmlns");
                this._svgCache.set(svgString, node);
                return node.cloneNode(true);
            }
            return null;
        }
    }

    if (!customElements.get("zen-library")) {
        try {
            customElements.define("zen-library", ZenLibraryElement);
        } catch (e) {
            console.error("ZenLibrary: Failed to register zen-library custom element:", e);
        }
    }

    class ZenLibrary {
        constructor() {
            this._isOpen = false;
            this.lastActiveTab = this._readLastActiveTab();
            this._isTransitioning = false;
            this._lastToggleTime = 0;
            this._onKeyDown = this._onKeyDown.bind(this);
            this._onUnload = this._onUnload.bind(this);
            this._onWheel = this._onWheel.bind(this);
            this._onMozSwipeGesture = this._onMozSwipeGesture.bind(this);
            this._onShowAllHistoryCommand = this._onShowAllHistoryCommand.bind(this);
            this._showAllHistoryCommand = null;
            this._wheelGesture = { totalX: 0, lastTime: 0, mode: null };
            this._mozSwipeGesture = { active: false, mode: null };
            this._initTimer = null;
            this._buttonListener = null;
            this._buttonPrefObserver = null;
            this._sidebarModePrefObserver = null;
            this._sidebarModeAttrObserver = null;
            this._sidebarModeSyncFrame = 0;
            this._openTween = null;
            this._openProgress = 0;

            this.store = new ZenStore({ history: [] });

            // Persistent module instances for background pre-fetching
            this._modules = Object.fromEntries(SECTION_IDS.map(id => [id, null]));

            this._init();
        }
        // Forwards `force` through to the element. See ZenLibraryElement.update.
        update(force = false) {
            if (this._element && typeof this._element.update === "function") {
                this._element.update(force);
            }
        }
        _init() {
            try {
                this._initInner();
            } catch (e) {
                // This runs while Zen is bringing the window up, and the constructor's
                // return value is what becomes window.gZenLibrary. Anything allowed to
                // escape here takes the entire mod down with it.
                console.error("[ZenLibrary] init failed:", e);
            }
        }

        _initInner() {
            window.addEventListener("keydown", this._onKeyDown, true);
            window.addEventListener("wheel", this._onWheel, { capture: true, passive: false });
            [
                "MozSwipeGestureMayStart",
                "MozSwipeGestureStart",
                "MozSwipeGestureUpdate",
                "MozSwipeGesture",
                "MozSwipeGestureEnd"
            ].forEach((type) => window.addEventListener(type, this._onMozSwipeGesture, true));
            // [audit] LEAK-2 — there was no unload path at all, so closing a browser window
            // left this window's observers, timers and module state behind. widget:false
            // because the toolbar button belongs to the application, not to this window.
            window.addEventListener("unload", this._onUnload, { once: true });
            this._watchShowAllHistoryCommand();

            // Always (re)written: an older build left this element empty, and a Sine reload keeps it.
            let s = document.getElementById("zen-library-global-style");
            if (!s) {
                s = document.createElement("style");
                s.id = "zen-library-global-style";
                document.head.appendChild(s);
            }
            s.textContent = `
:root {
  --zen-library-progress: 0;
}

/* Positioning context for the panel. Relative without offsets moves
   nothing; it only anchors any absolutely-positioned descendants. */
#browser {
  position: relative;
}

/* PR motion: the content shift is written inline on #zen-appcontent-wrapper (_applyWrapperShift),
   like native — a section width change re-derives it every frame, and a :root custom property
   there restyled the whole document per frame. #urlbar is position:fixed (zen-omnibox.css) and
   rides whichever transformed ancestor contains it. */

/* filter, not opacity: a userChrome/user-sheet "opacity: 1 !important" on the toolbox beats any author rule. */
:root[zen-library-open] #navigator-toolbox,
:root[zen-library-open-compact] #navigator-toolbox {
  transform: scale(calc(1 - var(--zen-library-progress) * 0.04));
  filter: opacity(calc(1 - min(1, var(--zen-library-progress) * 1.5)));
}

/* Compact mode's toolbox is fixed at z-index 10 and slides in on mouseover; at opacity 0 it would still catch clicks over the panel. */
:root[zen-library-open-compact] #navigator-toolbox {
  pointer-events: none;
}
`;
            this._watchSidebarMode();

            // CustomizableUI is not ready at script-load time on a cold start — the same
            // constraint zen-easel's host documents. Registering the widget inline throws
            // out of the constructor, which leaves window.gZenLibrary unassigned and the
            // button (and everything else that goes through it) dead.
            this._initTimer = setTimeout(() => {
                this._initTimer = null;
                this._initModules();
                this._createToolbarButton();
            }, 2000);
        }

        _onUnload() {
            this.destroy({ widget: false });
        }

        // Browser:ShowAllHistory is what Ctrl+Shift+H, History ▸ Manage history and the app
        // menu entry all dispatch. Firefox handles it from a bubble listener on the
        // #placesCommands commandset (places-commands.js), so a capture listener on the
        // <command> itself sees it first and stopPropagation() keeps the Library window shut.
        _watchShowAllHistoryCommand() {
            try {
                const command = document.getElementById("Browser:ShowAllHistory");
                if (!command || this._showAllHistoryCommand === command) return;
                this._unwatchShowAllHistoryCommand();
                this._showAllHistoryCommand = command;
                command.addEventListener("command", this._onShowAllHistoryCommand, true);
            } catch (e) {
                console.error("[ZenLibrary] Failed to watch Show All History command:", e);
            }
        }

        _unwatchShowAllHistoryCommand() {
            if (!this._showAllHistoryCommand) return;
            try {
                this._showAllHistoryCommand.removeEventListener("command", this._onShowAllHistoryCommand, true);
            } catch (e) { }
            this._showAllHistoryCommand = null;
        }

        _onShowAllHistoryCommand(event) {
            // Same switch as Ctrl+H: off means the native Library window is wanted back.
            let takeOver = true;
            try { takeOver = Services.prefs.getBoolPref("zen.library.shortcut.history", true); } catch (e) { }
            if (!takeOver) return;
            event.preventDefault();
            event.stopPropagation();
            this.openTab("history");
        }

        /**
         * Initialize persistent module instances and trigger background data fetching
         */
        _initModules() {
            // Create a minimal "shell" object for modules that need library.el helper
            const shell = this._createModuleShell();

            // An instance the panel created before this timer fired is kept and init'ed
            // here instead of being shadowed by a second one; every init() guards itself.
            // Media has no init on purpose: its scan is a Downloads-folder walk.
            for (const id of SECTION_IDS) {
                try {
                    const Ctor = window[SECTIONS[id].global];
                    if (!this._modules[id] && Ctor) this._modules[id] = new Ctor(shell);
                    const module = this._modules[id];
                    if (typeof module?.init === "function") module.init();
                } catch (e) {
                    console.error(`[ZenLibrary] ${id} module initialization error`, e);
                }
            }
        }

        /**
         * Register the Library button as a real CustomizableUI widget.
         *
         * This used to be two buttons: a widget that landed in the customization
         * palette, plus a second node hard-pinned after #zen-workspaces-button and
         * kept there by a MutationObserver. The observer is what made the button
         * "snap back" whenever someone dragged it somewhere else in Zen's toolbar
         * editor — customize mode moved the node, the observer put it back.
         *
         * Zen registers #zen-sidebar-foot-buttons and #zen-sidebar-top-buttons as
         * genuine CustomizableUI areas (see ZenCustomizableUI.startup), so a single
         * ordinary widget can default to the workspace-indicator row and still be
         * dragged anywhere — sidebar, nav-bar, palette — with CustomizableUI storing
         * the placement across restarts.
         */
        _createToolbarButton() {
            const id = "zen-library-button";

            // Fall back to the nav-bar if a Zen build ever stops registering the
            // sidebar area, so the button still has somewhere valid to land.
            const defaultArea = CustomizableUI.getAreaType("zen-sidebar-foot-buttons")
                ? "zen-sidebar-foot-buttons"
                : CustomizableUI.AREA_NAVBAR;

            // Every window runs this, and Sine may re-run the script in a window where
            // the widget is already registered. The widget is application-wide;
            // CustomizableUI builds a node for each window on its own. Only createWidget
            // is skipped — _watchButtonVisibility below still has to run, because what it
            // registers is per-controller and has to die with this window.
            const alreadyRegistered =
                CustomizableUI.getWidget(id)?.provider === CustomizableUI.PROVIDER_API;

            if (!alreadyRegistered && !this._registerButtonWidget(id, defaultArea)) return;

            this._watchButtonVisibility(id, defaultArea);
        }

        // Split out from _createToolbarButton so the two things it does — registering the
        // application-wide widget once, and wiring up this window's placement tracking —
        // do not have to share a control flow. Returns false if the widget could not be
        // registered, in which case there is nothing to track.
        _registerButtonWidget(id, defaultArea) {
            try {
                CustomizableUI.createWidget({
                    id,
                    type: "button",
                    // Without this CustomizableUI treats label/tooltiptext as Fluent ids.
                    localized: false,
                    // "Zen Library", not "Library": Firefox's own #library-button is
                    // already labelled Library, and in the toolbar editor the two sit in
                    // the same grid with no other way to tell them apart.
                    label: "Zen Library",
                    tooltiptext: "Zen Library (Alt+Shift+B)",
                    removable: true,
                    defaultArea,
                    // Wired here rather than through createWidget's `onCommand`, which
                    // runs inside a try/catch whose logger is off by default — anything
                    // that throws in there fails silently. `node.ownerGlobal` also gives
                    // the window this instance of the button belongs to, so the one
                    // app-wide widget drives whichever window was actually clicked
                    // instead of pinning the controller that registered it.
                    //
                    // No `zen-sidebar-action-button` class: #downloads-button, the button
                    // this one sits beside, does not carry it either, and the toolbar's
                    // mode="icons" already hides the label.
                    onCreated: (node) => {
                        node.addEventListener("command", (event) => {
                            // node.ownerGlobal comes back undefined for this node here —
                            // that, not a missing command event, is what made the button
                            // dead on click, and createWidget's own onCommand callback
                            // swallowed the same TypeError into a logger that is off by
                            // default. So the window is resolved by falling back rather
                            // than trusted from any single accessor. The last resort is
                            // the focused browser window, which for a click on a toolbar
                            // button is the right answer anyway.
                            const win =
                                node.ownerGlobal ||
                                (node.ownerDocument && node.ownerDocument.defaultView) ||
                                (event && event.view) ||
                                (event && event.target && event.target.ownerGlobal) ||
                                Services.wm.getMostRecentWindow("navigator:browser");

                            const library = win && win.gZenLibrary;
                            if (library) {
                                library.toggle();
                            } else {
                                console.error("[ZenLibrary] Button clicked, but gZenLibrary is missing on", win);
                            }
                        });
                    }
                });
                return true;
            } catch (e) {
                console.error("[ZenLibrary] Failed to create toolbar widget:", e);
                return false;
            }
        }

        /**
         * Keeps the button's placement and the mod's "show the button" checkbox saying the
         * same thing, in both directions.
         *
         * Dragging the button out in customize mode leaves it in the palette, and nothing
         * in Zen's UI names it well enough to find again — so removing it could strand it
         * with no way back. The checkbox in the mod's settings is that way back.
         *
         *   - remove or restore it in customize mode → the checkbox follows;
         *   - tick or untick the checkbox           → the placement follows.
         *
         * This also covers the upgrade case. `defaultArea` in createWidget only applies to
         * a widget id CustomizableUI has never seen, and anyone coming from the version
         * with two buttons has already seen "zen-library-button" sitting in the palette.
         * The startup reconciliation at the bottom is what puts it in the sidebar for them.
         *
         * Registered per window rather than once for the application, because both objects
         * belong to this window's global: leaving them behind when the window closes pins
         * the whole dead window in memory, and there is no other window that would take
         * ownership afterwards. Every path below is idempotent, so N windows registering N
         * copies converges to the same result as one — setBoolPref does not notify when the
         * value is unchanged, and both reconciling paths bail when placement and pref
         * already agree.
         */
        _watchButtonVisibility(id, defaultArea) {
            const PREF = "zen.library.button.show";
            const isPlaced = () => !!CustomizableUI.getPlacementOfWidget(id);

            try {
                // destroyWidget fires only onWidgetDestroyed, never onWidgetRemoved, so a
                // Sine rebuild does not read as the user hiding the button.
                this._buttonListener = {
                    onWidgetRemoved: (widgetId) => {
                        if (widgetId === id) Services.prefs.setBoolPref(PREF, false);
                    },
                    onWidgetAdded: (widgetId) => {
                        if (widgetId === id) Services.prefs.setBoolPref(PREF, true);
                    }
                };
                CustomizableUI.addListener(this._buttonListener);

                this._buttonPrefObserver = {
                    observe: () => {
                        const show = Services.prefs.getBoolPref(PREF, true);
                        // Already agrees with reality — this is the echo of our own
                        // change coming back round, and acting on it would loop.
                        if (show === isPlaced()) return;
                        if (show) {
                            CustomizableUI.addWidgetToArea(id, defaultArea);
                        } else {
                            CustomizableUI.removeWidgetFromArea(id);
                        }
                    }
                };
                Services.prefs.addObserver(PREF, this._buttonPrefObserver);

                // Deliberately one-way: if the checkbox says the button should be there
                // and it is not, put it back. The reverse is left alone, so a stale pref
                // can never take away a button the user has placed by hand.
                if (Services.prefs.getBoolPref(PREF, true) && !isPlaced()) {
                    CustomizableUI.addWidgetToArea(id, defaultArea);
                }
            } catch (e) {
                console.error("[ZenLibrary] Failed to track toolbar button visibility:", e);
            }
        }

        // Driven by the zen-right-side attribute mutation: at pref-change time Zen has not yet moved the sidebar.
        _syncRightSidePlacement() {
            const el = this._element;
            if (!el?.parentNode) return;
            const isRightSide = document.documentElement.hasAttribute("zen-right-side");
            el.toggleAttribute("right-side", isRightSide);
            const browser = document.getElementById("browser");
            if (!browser) return;
            if (isRightSide && el.parentNode.lastElementChild !== el) browser.append(el);
            if (!isRightSide && el.parentNode.firstElementChild !== el) browser.prepend(el);
        }

        // Mirrors zen-compact-mode.css: with either pref the compact toolbox is position:fixed, hovered or not.
        _isCompactSidebarHidden() {
            if (document.documentElement.getAttribute("zen-compact-mode") !== "true") return false;
            try {
                return Services.prefs.getBoolPref("zen.view.compact.hide-tabbar", false) ||
                    Services.prefs.getBoolPref("zen.view.use-single-toolbar", false) ||
                    document.documentElement.hasAttribute("zen-single-toolbar");
            } catch (e) {
                return false;
            }
        }

        _syncLibraryOpenModeAttributes() {
            if (!this._isOpen && !this._isTransitioning) return;
            const compactHidden = this._isCompactSidebarHidden();
            // Value "true", not a bare attribute: animator.css matches [zen-library-open="true"].
            const root = document.documentElement;
            if (compactHidden) root.setAttribute("zen-library-open-compact", "true");
            else root.removeAttribute("zen-library-open-compact");
            if (compactHidden) root.removeAttribute("zen-library-open");
            else root.setAttribute("zen-library-open", "true");
        }

        _scheduleSidebarModeSync() {
            if (this._sidebarModeSyncFrame) return;
            this._sidebarModeSyncFrame = requestAnimationFrame(() => {
                this._sidebarModeSyncFrame = 0;
                if (!this._element) return;
                this._boxMarginCache = null;
                this._syncRightSidePlacement();
                this._syncLibraryOpenModeAttributes();
                // Width, offset and shift only; the section's content does not depend on the sidebar mode.
                this.update();
                this._setOpenProgress(this._openProgress);
                // After the dock decision above: a mode change can move the cluster in or out of the toolbox.
                this._reserveWindowButtonDock();
            });
        }

        // Layout-mode changes while open: root attributes Zen flips in _updateEvent, plus the prefs the CSS reads directly.
        _watchSidebarMode() {
            if (this._sidebarModeAttrObserver) return;
            const sync = () => this._scheduleSidebarModeSync();
            this._sidebarModePrefObserver = { observe: sync };
            try { Services.prefs.addObserver("zen.view.compact.hide-tabbar", this._sidebarModePrefObserver); } catch (e) { }
            try { Services.prefs.addObserver("zen.view.use-single-toolbar", this._sidebarModePrefObserver); } catch (e) { }

            this._sidebarModeAttrObserver = new MutationObserver(sync);
            this._sidebarModeAttrObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: [
                    "zen-compact-mode",
                    "zen-sidebar-expanded",
                    "zen-single-toolbar",
                    "zen-right-side"
                ]
            });
        }

        /**
         * Create a minimal shell object that provides the el() helper for modules
         */
        _createModuleShell() {
            return {
                // [audit] MAINT-1 — was a second verbatim copy of el(). Same function now.
                el: (tag, props = {}, children = []) => window.ZenLibraryUtil.el(tag, props, children),
                enterContent: (node) => node,
                style: { getPropertyValue: () => "" },
                store: this.store
            };
        }

        /**
         * Get pre-initialized module instances for the library element to use
         */
        getModules() {
            return this._modules;
        }

        _readLastActiveTab() {
            try {
                const tab = Services.prefs.getStringPref("zen.library.last-tab", DEFAULT_TAB);
                if (SECTION_IDS.includes(tab)) return tab;
            } catch (e) { }
            return DEFAULT_TAB;
        }

        _writeLastActiveTab(tabName) {
            if (!SECTION_IDS.includes(tabName)) return;
            try {
                Services.prefs.setStringPref("zen.library.last-tab", tabName);
            } catch (e) { }
        }

        _closeUrlbar() {
            try {
                window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIAppWindow).rollupAllPopups();
            } catch (e) { }
            try { window.gURLBar?.view?.close?.(); } catch (e) { }
            try { window.gURLBar?.blur?.(); } catch (e) { }
            try { document.getElementById("urlbar")?.blur?.(); } catch (e) { }
        }

        // Re-derives the content shift from the panel's live width (section width transition, window resize); mid-tween it re-aims the wrapper instead.
        _syncShift() {
            if (!this._element?.parentNode) return;
            if (this._isTransitioning) this._retargetWrapperTween();
            else this._setOpenProgress(this._openProgress);
        }

        // The panel resized under a running tween (Spaces/Media sizing, tab switch): replace the wrapper keyframes with the new shift on the host's clock, so the page never lands short of the panel and snaps.
        _retargetWrapperTween() {
            const tween = this._openTween;
            const wrapper = document.getElementById("zen-appcontent-wrapper");
            if (!tween || !wrapper || !this._openAnimations) return;
            const shift = this._measureShift();
            if (shift === tween.shift) return;
            tween.shift = shift;
            const anim = wrapper.animate(tween.frames("wrapper", shift), tween.opts);
            if (tween.host.startTime !== null) anim.startTime = tween.host.startTime;
            const index = this._openAnimations.indexOf(tween.wrapper);
            try { tween.wrapper.cancel(); } catch (e) { }
            if (index >= 0) this._openAnimations[index] = anim;
            else this._openAnimations.push(anim);
            tween.wrapper = anim;
        }

        _watchPanelSize(el) {
            this._unwatchPanelSize();
            this._panelResizeObserver = new ResizeObserver(() => this._syncShift());
            this._panelResizeObserver.observe(el);
        }

        _unwatchPanelSize() {
            this._panelResizeObserver?.disconnect();
            this._panelResizeObserver = null;
        }

        // Animation settings from the mod's preferences page; read per open so changes apply without a restart.
        static EASINGS = {
            native: [0.32, 0.72, 0, 1],
            snappy: [0.2, 0, 0, 1],
            smooth: [0.25, 1, 0.5, 1],
            linear: [0, 0, 1, 1]
        };

        // Sine stores "number" inputs as int prefs, but a hand-edited value may be a string; accept both.
        _prefNumber(name, fallback) {
            try {
                if (Services.prefs.getPrefType(name) === Services.prefs.PREF_INT) return Services.prefs.getIntPref(name);
                const n = Number(Services.prefs.getStringPref(name, ""));
                return Number.isFinite(n) && n >= 0 ? n : fallback;
            } catch (e) { return fallback; }
        }

        _animationDuration() {
            return this._prefNumber("zen.library.animation.duration", 280);
        }

        _animationEasing() {
            let name = "native";
            try { name = Services.prefs.getStringPref("zen.library.animation.easing", "native"); } catch (e) { }
            return ZenLibrary.EASINGS[name] || ZenLibrary.EASINGS.native;
        }

        _applyAnimationSettings(el) {
            el.style.setProperty("--zen-library-width-duration", `${this._prefNumber("zen.library.animation.width-duration", 150)}ms`);
            el.style.setProperty("--zen-library-easing", `cubic-bezier(${this._animationEasing().join(", ")})`);
        }

        // Only the pill's container: in the multi-toolbar layout #nav-bar also holds the Windows caption buttons.
        _sweepUrlbarNodes() {
            // #urlbar too: it is position:fixed and Zen's compact CSS re-asserts its visibility.
            return ["urlbar-container", "urlbar"].map(id => document.getElementById(id)).filter(Boolean);
        }

        _paintUrlbarChrome(progress) {
            const nodes = this._hiddenUrlbarNodes;
            if (!nodes) return;
            const faded = 1 - Math.min(1, progress * 1.5);
            for (const node of nodes) {
                try {
                    node.style.setProperty("opacity", String(faded));
                    node.style.setProperty("pointer-events", "none");
                    if (progress >= 1) node.style.setProperty("visibility", "hidden");
                    else node.style.removeProperty("visibility");
                } catch (e) { }
            }
        }

        _clearUrlbarChrome() {
            for (const node of this._hiddenUrlbarNodes || []) {
                try {
                    node.style.removeProperty("opacity");
                    node.style.removeProperty("visibility");
                    node.style.removeProperty("pointer-events");
                } catch (e) { }
            }
            this._hiddenUrlbarNodes = null;
        }

        // getComputedStyle flushes layout, so margins and borders are read once per panel
        // open and cached; the padding box itself is still measured live.
        // clientWidth, not bounding rects: those include the toolbox's scale(0.96), which is
        // still applied when the open tween hands off, so the rest shift came out ~4% of the
        // toolbox too wide and the page hopped by that much on landing.
        _measureBoxOccupied(el) {
            try {
                this._boxMarginCache ||= new Map();
                let extra = this._boxMarginCache.get(el);
                if (extra === undefined) {
                    extra = 0;
                    try {
                        const cs = getComputedStyle(el);
                        extra = ["marginLeft", "marginRight", "borderLeftWidth", "borderRightWidth"]
                            .reduce((sum, prop) => sum + (parseFloat(cs[prop]) || 0), 0);
                    } catch (e) { }
                    this._boxMarginCache.set(el, extra);
                }
                return (el.clientWidth || 0) + extra;
            } catch (e) {
                return 0;
            }
        }

        // Live toolbox width for the PR shift; zero in compact mode, where the toolbox is fixed and out of flow.
        _measureToolboxWidth() {
            try {
                const tb = document.getElementById("navigator-toolbox");
                if (!tb || this._isCompactSidebarHidden()) return 0;
                let width = this._measureBoxOccupied(tb);
                if (document.documentElement.hasAttribute("zen-sidebar-expanded")) {
                    const splitter = document.getElementById("zen-sidebar-splitter");
                    if (splitter) width += this._measureBoxOccupied(splitter);
                }
                return width;
            } catch (e) {
                return 0;
            }
        }

        _setOpenProgress(value) {
            const progress = Math.max(0, Math.min(1, Number(value) || 0));
            this._openProgress = progress;
            // Same value most frames of a width transition; Gecko drops an unchanged setProperty without a restyle.
            document.documentElement.style.setProperty("--zen-library-progress", String(progress));
            this._element?.style?.setProperty("--zen-library-progress", String(progress));
            try { this._applyWrapperShift(progress, this._measureShift()); } catch (e) { }
            this._applyWindowButtonDock(progress);
            // The URL pill fades on the toolbox's curve and hides only once the tween lands.
            this._paintUrlbarChrome(progress);
        }

        // Past 60% the live caption cluster docks here, only when it sits in the toolbox this panel fades; no clone is left behind.
        _applyWindowButtonDock(progress) {
            const pastPoint = progress > 0.6 && this._windowButtonsInToolbox();
            if (pastPoint && !this._windowButtonsAdopted) this._adoptWindowButtons();
            else if (!pastPoint && this._windowButtonsAdopted) this._restoreWindowButtons();
        }

        _stopOpenAnimation() {
            for (const anim of this._openAnimations || []) {
                try { anim.cancel(); } catch (e) { }
            }
            this._openAnimations = null;
            this._openTween = null;
            if (this._dockTimer) {
                clearTimeout(this._dockTimer);
                this._dockTimer = null;
            }
        }

        // Rest-state transform, inline on the wrapper only (native writes appContentWrapper.style.transform the same way).
        // Same text as the wrapper keyframe at that progress, so a tween lands on it without a hop; empty at 0 so nothing lingers when closed.
        _applyWrapperShift(progress, shift) {
            const wrapper = document.getElementById("zen-appcontent-wrapper");
            if (!wrapper) return;
            const value = progress > 0 ? `translateX(${progress * shift}px)` : "";
            // Unchanged writes are skipped: the ResizeObserver re-derives the same target every frame of a width transition, and a rewrite would restart the transition below.
            if (wrapper.style.transform === value) return;
            if (value) wrapper.style.transform = value;
            else wrapper.style.removeProperty("transform");
        }

        // Rest-state only: a section width change moves the page on the same clock as the panel's width
        // transition (core.css), instead of chasing the live edge a frame behind. Under the open/close
        // tween the keyframes own the transform, and a transition there would replay the base-value change
        // once they are cancelled, so it is switched on a frame after the open lands and off before any tween.
        _setWrapperTransition(on) {
            const wrapper = document.getElementById("zen-appcontent-wrapper");
            if (!wrapper) return;
            if (on) wrapper.style.transition = `transform ${this._prefNumber("zen.library.animation.width-duration", 150)}ms ease-in-out`;
            else wrapper.style.removeProperty("transition");
        }

        // Signed content shift for the current panel width (panel minus the in-flow toolbox).
        _measureShift() {
            // Target width, not the live box: mid-transition the live box lags, and the page runs its own transition to the target (see _setWrapperTransition). Live is the fallback before update() has set one.
            let panelWidth = this._element?._lastTargetWidth || 0;
            if (!panelWidth && this._element?.parentNode && window.windowUtils?.getBoundsWithoutFlushing) {
                panelWidth = window.windowUtils.getBoundsWithoutFlushing(this._element).width;
            }
            const shift = Math.max(0, panelWidth - this._measureToolboxWidth());
            return (this._element?.hasAttribute("right-side") ? -1 : 1) * shift;
        }

        // Keyframe values at progress p, mirroring the injected stylesheet so the tween lands exactly on the rest state.
        _keyframesAt(p, shift) {
            const dir = this._element?.hasAttribute("right-side") ? 1 : -1;
            const fade = 1 - Math.min(1, p * 1.5);
            return {
                host: { transform: `translateX(${dir * 100 * (1 - p)}%)`, opacity: String(p) },
                toolbox: { transform: `scale(${1 - p * 0.04})`, filter: `opacity(${fade})` },
                wrapper: { transform: `translateX(${p * shift}px)` },
                urlbar: { opacity: String(fade) }
            };
        }

        // The host's opacity is the progress by construction, so a retarget mid-tween starts from what is on screen.
        _currentProgress() {
            if (this._openAnimations && this._element) {
                const p = parseFloat(getComputedStyle(this._element).opacity);
                if (Number.isFinite(p)) return Math.max(0, Math.min(1, p));
            }
            return this._openProgress;
        }

        _animateOpenProgress(target, onComplete) {
            const from = this._currentProgress();
            this._stopOpenAnimation();
            this._setWrapperTransition(false);
            this._setOpenProgress(from);
            const finish = () => {
                // Rest state first, then drop the fill-forwards keyframes: same values, so nothing flashes.
                this._setOpenProgress(target);
                this._stopOpenAnimation();
                onComplete?.();
                // Two frames out, not one: `finished` settles before this tick's rAF callbacks, so a single rAF lands in
                // the same style flush as the cancel, and the compositor-driven transform's main-thread value is still
                // stale there — Gecko then transitions from that stale value to the rest value, and the page slides in twice.
                // After a painted frame the computed value is the rest value, and enabling the transition moves nothing.
                if (target >= 1) requestAnimationFrame(() => requestAnimationFrame(() => {
                    if (this._isOpen && !this._isTransitioning) this._setWrapperTransition(true);
                }));
            };

            // Native zen-library: 280ms cubic-bezier(0.32, 0.72, 0, 1), scaled by the distance left to travel.
            const duration = this._animationDuration() * Math.abs(target - from);
            if (duration < 1) {
                finish();
                return;
            }

            // Like native, WAAPI keyframes on the panel, toolbox and content wrapper: compositor-driven, no per-frame restyle of :root.
            const host = this._element;
            if (!host?.parentNode) {
                finish();
                return;
            }
            const opts = { duration, easing: `cubic-bezier(${this._animationEasing().join(", ")})`, fill: "forwards" };
            const shift = this._measureShift();
            const clamp = 2 / 3;
            const frames = (key, px = shift) => {
                const list = [{ ...this._keyframesAt(from, px)[key], offset: 0 }];
                // The fade clamps at 2/3; when the segment crosses it, keep that stop so the fade stays linear to zero like native.
                if ((from - clamp) * (target - clamp) < 0) list.push({ ...this._keyframesAt(clamp, px)[key], offset: (clamp - from) / (target - from) });
                list.push({ ...this._keyframesAt(target, px)[key], offset: 1 });
                return list;
            };
            const anims = [host.animate(frames("host"), opts)];
            const toolbox = document.getElementById("navigator-toolbox");
            if (toolbox) anims.push(toolbox.animate(frames("toolbox"), opts));
            const wrapper = document.getElementById("zen-appcontent-wrapper");
            const wrapperAnim = wrapper?.animate(frames("wrapper"), opts);
            if (wrapperAnim) anims.push(wrapperAnim);
            for (const node of this._hiddenUrlbarNodes || []) {
                node.style.removeProperty("visibility");
                anims.push(node.animate(frames("urlbar"), opts));
            }
            this._openAnimations = anims;
            // What _retargetWrapperTween needs to rebuild the wrapper leg if the panel resizes mid-tween.
            this._openTween = wrapperAnim ? { host: anims[0], wrapper: wrapperAnim, frames, opts, shift } : null;
            // Caption buttons dock at 60% of an open and undock as a close starts.
            if (target > from) {
                const at = duration * Math.max(0, (0.6 - from) / (target - from));
                this._dockTimer = setTimeout(() => { this._dockTimer = null; this._applyWindowButtonDock(1); }, at);
            } else {
                this._applyWindowButtonDock(0);
            }
            anims[0].finished.then(() => { if (this._openAnimations === anims) finish(); }, () => { });
        }

        _onKeyDown(e) {
            // This is a capture-phase listener on the window, and it claims Ctrl+H and
            // Ctrl+J below. Left unguarded it eats those keystrokes inside text fields —
            // the Easels rename prompt being the case that surfaced it — and it also
            // overrides anything that has already decided what the key means.
            if (e.defaultPrevented) return;

            const isMac = Services.appinfo.OS === "Darwin";

            // Support Alt + Shift + B (Direct fallback/Windows default)
            // AND Cmd + Alt + B (Common macOS alternative)
            const isToggle = e.code === "KeyB" && (
                (e.altKey && e.shiftKey) ||
                (isMac && e.metaKey && e.altKey) ||
                (isMac && e.metaKey && e.shiftKey)
            );

            // [audit] COMPAT-2 — checked before the target guards below, not after. Those
            // guards exist for Ctrl+H and Ctrl+J, which are Firefox's own shortcuts and are
            // widely bound by web apps; this chord is the mod's own and is neither
            // text-producing nor plausibly wanted by a page. Sitting below the guards, it
            // was unreachable in the one case that matters most: with focus inside a web
            // page the event's target in this window is the <browser> element, so
            // `name === "browser" && !this._isOpen` returned first and the shortcut did
            // nothing unless focus happened to be in chrome UI.
            if (isToggle) {
                e.preventDefault();
                e.stopPropagation();
                this.toggle();
                return;
            }

            const target = e.composedPath ? e.composedPath()[0] : e.target;
            const name = target && target.localName ? target.localName.toLowerCase() : "";
            if (name === "input" || name === "textarea" || (target && target.isContentEditable)) return;

            // [audit] COMPAT-1 — Ctrl+H and Ctrl+J are Firefox's own Library and Downloads
            // shortcuts and are also bound by plenty of web apps. Taking them over is a
            // reasonable default for this mod, but it was unconditional and had no off
            // switch. Both are now preferences, so a user who wants the native panels — or
            // wants a web app to receive the key — can have them back without editing
            // JavaScript. Defaults are unchanged, so existing behaviour is preserved.
            const prefBool = (name, fallback) => {
                try { return Services.prefs.getBoolPref(name, fallback); } catch (e) { return fallback; }
            };

            const isHistoryShortcut = e.code === "KeyH" && (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey;
            if (isHistoryShortcut && prefBool("zen.library.shortcut.history", true)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                this.openTab("history");
                return;
            }

            const isDownloadsShortcut = e.code === "KeyJ" && (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey;
            if (isDownloadsShortcut && prefBool("zen.library.shortcut.downloads", true)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                this.openTab("downloads");
                return;
            }

            // Keep ordinary page shortcuts alone after the Library-owned chords above.
            if (name === "browser" && !this._isOpen) return;

            if (!this._isOpen || !this._element) return;

            // Allow closing with Escape
            if (e.code === "Escape") {
                this.close();
                e.preventDefault();
                return;
            }

            // Row navigation only while focus is inside the panel: the page beside it keeps its arrow keys.
            if (!this._element.shadowRoot || !e.composedPath().includes(this._element)) return;

            if (e.code === "ArrowDown" || e.code === "ArrowUp") {
                e.preventDefault();
                this._moveFocus(e.code === "ArrowDown" ? 1 : -1);
            }
        }

        _onWheel(e) {
            if (this._isTransitioning) return;
            const absX = Math.abs(e.deltaX);
            const absY = Math.abs(e.deltaY);
            const triggerThreshold = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 1 : 12;
            if (absX < triggerThreshold || absX < absY * 1.35) return;

            const now = Date.now();
            const isNewGesture = now - this._wheelGesture.lastTime > 450;
            const workspaceOffset = this._workspaceGestureOffsetFromDelta(e.deltaX);
            if (isNewGesture) {
                this._wheelGesture = {
                    totalX: 0,
                    lastTime: now,
                    mode: this._wheelGestureMode(e, workspaceOffset)
                };
            } else {
                this._wheelGesture.lastTime = now;
            }

            const shouldCloseFromLibrary = this._wheelGesture.mode === "close" && workspaceOffset > 0;
            const shouldOpenFromFirstSpace = this._wheelGesture.mode === "open" && workspaceOffset < 0;
            if (!shouldCloseFromLibrary && !shouldOpenFromFirstSpace) {
                this._wheelGesture.totalX = 0;
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();

            this._wheelGesture = { totalX: 0, lastTime: 0, mode: null };
            shouldCloseFromLibrary ? this.close() : this.open();
        }

        _wheelGestureMode(e, workspaceOffset) {
            if (this._isOpen && workspaceOffset > 0 && this._isLibraryGestureTarget(e) && !this._wheelScrollsLibraryContent(e)) {
                return "close";
            }
            if (!this._isOpen && workspaceOffset < 0 && this._isOnFirstWorkspace() && this._isSidebarGestureTarget(e)) {
                return "open";
            }
            return null;
        }

        _onMozSwipeGesture(e) {
            if (this._isTransitioning) return;

            if (e.type === "MozSwipeGestureEnd") {
                this._mozSwipeGesture = { active: false, mode: null };
                return;
            }

            const workspaceOffset = this._workspaceGestureOffsetFromSwipe(e);
            const shouldCloseFromLibrary = this._isOpen &&
                workspaceOffset > 0 &&
                this._isLibraryGestureTarget(e);
            const shouldOpenFromFirstSpace = !this._isOpen &&
                workspaceOffset < 0 &&
                this._isOnFirstWorkspace() &&
                this._isSidebarGestureTarget(e);

            if (e.type === "MozSwipeGestureMayStart") {
                if (!shouldCloseFromLibrary && !shouldOpenFromFirstSpace) return;
                this._mozSwipeGesture = {
                    active: true,
                    mode: shouldCloseFromLibrary ? "close" : "open"
                };
                if (typeof e.allowedDirections === "number") {
                    e.allowedDirections |= e.DIRECTION_LEFT | e.DIRECTION_RIGHT;
                }
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();
                return;
            }

            if (!this._mozSwipeGesture.active) return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();

            if (e.type === "MozSwipeGesture") {
                const mode = this._mozSwipeGesture.mode;
                this._mozSwipeGesture = { active: false, mode: null };
                mode === "close" ? this.close() : this.open();
            }
        }

        _workspaceGestureOffsetFromDelta(deltaX) {
            const rawDirection = deltaX > 0 ? 1 : -1;
            const direction = window.gZenWorkspaces?.naturalScroll ? -1 : 1;
            return rawDirection * direction;
        }

        _workspaceGestureOffsetFromSwipe(e) {
            if (!e || typeof e.direction !== "number") return 0;
            const isRTL = document.documentElement.matches(":-moz-locale-dir(rtl)");
            const moveForward = (e.direction === e.DIRECTION_RIGHT) !== isRTL;
            const rawDirection = moveForward ? 1 : -1;
            const direction = window.gZenWorkspaces?.naturalScroll ? -1 : 1;
            return rawDirection * direction;
        }

        _isOnFirstWorkspace() {
            try {
                const zenWorkspaces = window.gZenWorkspaces;
                if (!zenWorkspaces) return true;

                const activeId = this._workspaceId(
                    zenWorkspaces.activeWorkspace ||
                    zenWorkspaces.getActiveWorkspace?.() ||
                    zenWorkspaces.activeWorkspaceElement
                );

                const visualFirstId = this._firstVisibleWorkspaceId();
                if (visualFirstId && activeId) return activeId === visualFirstId;

                const workspaces = zenWorkspaces.getWorkspaces?.() || [];
                if (!workspaces.length) return true;

                const firstId = this._workspaceId(workspaces[0]);
                return !!firstId && activeId === firstId;
            } catch (e) {
                console.warn("[ZenLibrary] Failed to detect first workspace:", e);
                return true;
            }
        }

        _workspaceId(workspace) {
            if (!workspace) return "";
            if (typeof workspace === "string") return workspace;
            if (workspace.nodeType === Node.ELEMENT_NODE) {
                return workspace.getAttribute("zen-workspace-id") ||
                    workspace.getAttribute("workspace-id") ||
                    workspace.getAttribute("data-workspace-id") ||
                    workspace.getAttribute("data-id") ||
                    workspace.id ||
                    "";
            }
            return workspace.uuid || workspace.id || workspace.name || workspace.label || "";
        }

        _firstVisibleWorkspaceId() {
            const container = document.getElementById("zen-workspaces-button");
            if (!container) return "";

            const candidates = Array.from(container.querySelectorAll(
                "[zen-workspace-id], [workspace-id], [data-workspace-id], [data-id], [value]"
            )).filter((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });

            const first = candidates[0];
            if (!first) return "";

            return first.getAttribute("zen-workspace-id") ||
                first.getAttribute("workspace-id") ||
                first.getAttribute("data-workspace-id") ||
                first.getAttribute("data-id") ||
                first.getAttribute("value") ||
                first.id ||
                "";
        }

        // A horizontal wheel over library content that can still scroll that way (the Spaces grid) scrolls it; only a wall closes.
        _wheelScrollsLibraryContent(e) {
            const dir = Math.sign(e.deltaX);
            for (const node of e.composedPath?.() || []) {
                if (node?.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.localName === "zen-library") return false;
                const max = node.scrollWidth - node.clientWidth;
                if (max <= 1 || !/auto|scroll/.test(getComputedStyle(node).overflowX)) continue;
                if ((dir > 0 && node.scrollLeft < max - 1) || (dir < 0 && node.scrollLeft > 1)) return true;
            }
            return false;
        }

        _isLibraryGestureTarget(e) {
            const path = e.composedPath?.() || [];
            if (path.some((el) => el?.tagName?.toLowerCase?.() === "zen-library" || el?.id === "zen-library-container")) {
                return true;
            }

            const library = document.querySelector("zen-library");
            return !!library && (e.target === library || library.contains?.(e.target));
        }

        _isSidebarGestureTarget(e) {
            const target = e.target;
            if (target?.closest?.("#navigator-toolbox, #sidebar-box, #zen-sidebar-splitter, [id*='zen-sidebar'], [class*='zen-sidebar'], [class*='workspace'], [id*='workspace']")) {
                return true;
            }

            const toolbox = document.getElementById("navigator-toolbox");
            const sidebar = document.getElementById("sidebar-box");
            const splitter = document.getElementById("zen-sidebar-splitter");
            const edgeWidth = Math.max(
                toolbox?.getBoundingClientRect?.().width || 0,
                sidebar?.getBoundingClientRect?.().right || 0,
                splitter?.getBoundingClientRect?.().right || 0,
                parseInt(getComputedStyle(document.documentElement).getPropertyValue("--zen-sidebar-width")) || 0,
                300
            );

            return e.clientX <= edgeWidth + 16;
        }

        /**
         * Move focus to next/prev focusable element in the library
         */
        _moveFocus(dir) {
            const shadow = this._element.shadowRoot;
            const focusableSelector = '.library-list-item, .history-nav-item, .sidebar-button, input, button, [tabindex="0"]';
            const all = Array.from(shadow.querySelectorAll(focusableSelector))
                .filter(el => el.offsetParent !== null && !el.disabled && el.style.display !== "none");

            if (all.length === 0) return;

            const current = shadow.activeElement;
            let index = all.indexOf(current);

            if (index === -1) {
                // If focus is not in list, focus first item
                index = dir > 0 ? 0 : all.length - 1;
            } else {
                index += dir;
                // Loop around
                if (index < 0) index = all.length - 1;
                if (index >= all.length) index = 0;
            }

            all[index].focus();
            all[index].scrollIntoView({ block: "nearest" });
        }
        // [audit] LEAK-2 — this used to remove the keydown listener, call the modules'
        // destroy() and drop the element, and stop there, leaking the init timer and the
        // CustomizableUI widget on every Sine rebuild. `widget` is false on the window-close
        // path and true on the Sine rebuild path; see the teardown below for why.
        destroy({ widget = true } = {}) {
            window.removeEventListener("keydown", this._onKeyDown, true);
            window.removeEventListener("unload", this._onUnload);
            window.removeEventListener("wheel", this._onWheel, true);
            this._unwatchShowAllHistoryCommand();
            [
                "MozSwipeGestureMayStart",
                "MozSwipeGestureStart",
                "MozSwipeGestureUpdate",
                "MozSwipeGesture",
                "MozSwipeGestureEnd"
            ].forEach((type) => window.removeEventListener(type, this._onMozSwipeGesture, true));

            if (this._initTimer) {
                clearTimeout(this._initTimer);
                this._initTimer = null;
            }

            // A module may hold resources the DOM knows nothing about — blob: object URLs,
            // store subscriptions, a playing <audio>.
            for (const module of Object.values(this._modules || {})) {
                if (module && typeof module.destroy === "function") {
                    try { module.destroy(); } catch (e) { console.error("[ZenLibrary] destroy failed:", e); }
                }
            }

            // Unconditional: the listener and the pref observer are this window's objects,
            // registered on application-wide services. Leaving them there when the window
            // closes keeps the window's whole global reachable from CustomizableUI and the
            // pref service — and no surviving window would ever take over from them.
            if (this._buttonListener) {
                try { CustomizableUI.removeListener(this._buttonListener); } catch (e) { }
                this._buttonListener = null;
            }
            if (this._buttonPrefObserver) {
                try { Services.prefs.removeObserver("zen.library.button.show", this._buttonPrefObserver); } catch (e) { }
                this._buttonPrefObserver = null;
            }
            if (this._sidebarModePrefObserver) {
                try { Services.prefs.removeObserver("zen.view.compact.hide-tabbar", this._sidebarModePrefObserver); } catch (e) { }
                try { Services.prefs.removeObserver("zen.view.use-single-toolbar", this._sidebarModePrefObserver); } catch (e) { }
                this._sidebarModePrefObserver = null;
            }
            if (this._sidebarModeAttrObserver) {
                try { this._sidebarModeAttrObserver.disconnect(); } catch (e) { }
                this._sidebarModeAttrObserver = null;
            }
            if (this._sidebarModeSyncFrame) {
                cancelAnimationFrame(this._sidebarModeSyncFrame);
                this._sidebarModeSyncFrame = 0;
            }
            this._unwatchPanelSize();

            this._stopOpenAnimation();
            try { this._restoreWindowButtons(); } catch (e) { }
            try { this._clearUrlbarChrome(); } catch (e) { }
            try { document.getElementById("zen-library-button")?.removeAttribute("library-open"); } catch (e) { }

            // The widget itself really is application-wide, so tearing it down because one
            // window closed would take the button away from every window still open.
            if (widget) {
                try { CustomizableUI.destroyWidget("zen-library-button"); } catch (e) { }
            }

            const el = document.querySelector("zen-library");
            if (el) el.remove();

            document.documentElement.removeAttribute("zen-library-open");
            document.documentElement.removeAttribute("zen-library-open-compact");
            document.documentElement.style.removeProperty("--zen-library-offset");
            document.documentElement.style.removeProperty("--zen-library-progress");
            this._setWrapperTransition(false);
            document.getElementById("zen-appcontent-wrapper")?.style.removeProperty("transform");
        }
        toggle() {
            const now = Date.now();
            if (now - this._lastToggleTime < 40) {
                return;
            }
            this._lastToggleTime = now;
            if (this._isOpen && !document.querySelector("zen-library")) {
                this._isOpen = false;
            }
            this._isOpen ? this.close() : this.open();
        }

        /**
         * Open the library with a specific tab selected, or close if already on that tab
         * @param {string} tabName - One of SECTION_IDS
         */
        openTab(tabName) {
            if (!SECTION_IDS.includes(tabName)) return;

            // If already open on the same tab, close the library
            if (this._isOpen && this._element && this._element.activeTab === tabName) {
                this.close();
                return;
            }

            // Set the desired tab before opening
            this.lastActiveTab = tabName;
            this._writeLastActiveTab(tabName);

            // If already open but on a different tab, switch to the requested tab
            if (this._isOpen && this._element) {
                this._element.activeTab = tabName;
                return;
            }

            // Otherwise, open the library (it will use lastActiveTab)
            this.open();
        }
        open() {
            if (this._isOpen) {
                return;
            }
            if (this._element?.parentNode) {
                // Reopen mid-close: the tween is still running, so just retarget it.
                this._closeUrlbar();
                this._isOpen = true;
                this._isTransitioning = true;
                this._boxMarginCache = null;
                this._hiddenUrlbarNodes = this._sweepUrlbarNodes();
                this._element.style.visibility = "visible";
                this._syncLibraryOpenModeAttributes();
                this._reserveWindowButtonDock();
                try { document.getElementById("zen-library-button")?.setAttribute("library-open", "true"); } catch (e) { }
                this._animateOpenProgress(1, () => {
                    this._isTransitioning = false;
                });
                return;
            }
            const b = document.getElementById("browser");
            if (!b) {
                return;
            }

            this._closeUrlbar();
            this._isTransitioning = true;
            this._isOpen = true;
            this._boxMarginCache = null;
            this._hiddenUrlbarNodes = this._sweepUrlbarNodes();

            const isRightSide = document.documentElement.hasAttribute("zen-right-side");

            this._element = document.createElement("zen-library");
            this._element.id = "zen-library-container";
            if (isRightSide) this._element.setAttribute("right-side", "true");
            this._element.style.zIndex = "9";

            // Overlay: no width lock, no sidebar measuring. Width comes from
            // --zen-library-width and the shift is recomputed live every frame.
            this._element.style.display = "block";
            this._element.style.visibility = "visible";
            this._element.style.opacity = "";
            this._applyAnimationSettings(this._element);
            // Before insertion: connectedCallback flushes style, and a host first styled at the 516px default would width-transition to its real size under the tween.
            try { this._element.applyTargetWidth(); } catch (e) { }
            this._setOpenProgress(0);

            if (isRightSide) b.append(this._element);
            else b.prepend(this._element);
            this._watchPanelSize(this._element);

            this._syncLibraryOpenModeAttributes();
            this._reserveWindowButtonDock();
            try { document.getElementById("zen-library-button")?.setAttribute("library-open", "true"); } catch (e) { }

            this._animateOpenProgress(1, () => {
                this._isTransitioning = false;
            });
        }

        close() {
            if (!this._isOpen || !this._element) return;
            if (this._modules.media && typeof this._modules.media._stopCurrentAudio === "function") {
                this._modules.media._stopCurrentAudio();
            }
            // close() drops the element without running destroy(), so a drag still in flight
            // would leave Media's window-capture listeners armed against a source node that is
            // about to be disconnected — and a disconnected source never fires dragend.
            if (typeof this._modules.media?._disarmDragCancel === "function") {
                try { this._modules.media._disarmDragCancel(); } catch (e) { }
            }
            const el = this._element;
            this._isTransitioning = true;
            this._isOpen = false;

            const end = () => {
                // A reopen retargets the spring; its completion must not tear down a panel that is open again.
                if (this._isOpen && this._element === el) return;
                // Caption buttons are a light-DOM child of this host while adopted.
                // Put them back before the host is dropped, or they leave the document.
                try { this._restoreWindowButtons(); } catch (e) { }
                this._unwatchPanelSize();
                // Drop the element the moment the tween lands so no hidden box lingers in #browser.
                if (el.parentNode) el.remove();
                if (this._element === el) this._element = null;

                if (!this._isOpen) {
                    document.documentElement.removeAttribute("zen-library-open");
                    document.documentElement.removeAttribute("zen-library-open-compact");
                    document.documentElement.style.removeProperty("--zen-library-offset");
                    document.documentElement.style.removeProperty("--zen-library-progress");
                    this._setWrapperTransition(false);
                    document.getElementById("zen-appcontent-wrapper")?.style.removeProperty("transform");
                    this._boxMarginCache = null;
                    try { this._clearUrlbarChrome(); } catch (e) { }
                    try { document.getElementById("zen-library-button")?.removeAttribute("library-open"); } catch (e) { }

                    // No extra toolbox fade: the toolbox restores with the layout,
                    // so a second animation would double-fade it.
                    this._isTransitioning = false;
                }
            };

            this._animateOpenProgress(0, end);
        }

        // Zen parks the caption cluster in #navigator-toolbox whenever !isWindowsStyledButtons (macOS, GTK reversed, force-left pref).
        _windowButtonsInToolbox() {
            // Once adopted the node lives in this host, so keep answering yes until progress drops below the dock point.
            if (this._windowButtonsAdopted) return true;
            const real = window.gZenVerticalTabsManager?.actualWindowButtons;
            return !!real?.closest?.("#navigator-toolbox");
        }

        // Open the dock row at the cluster's live height before the slide starts, so the hand-off at 60% moves nothing.
        // Measured wherever the node is (toolbox, or already in this host on a reopen); a 0 means it is not rendered, and then the row stays closed.
        _reserveWindowButtonDock() {
            const host = this._element;
            if (!host) return;
            const real = window.gZenVerticalTabsManager?.actualWindowButtons;
            let height = 0;
            if (real && this._windowButtonsInToolbox()) {
                try { height = window.windowUtils.getBoundsWithoutFlushing(real).height; } catch (e) { }
            }
            if (height > 0) host.style.setProperty("--zen-library-window-buttons-height", `${height}px`);
            else host.style.removeProperty("--zen-library-window-buttons-height");
            host.toggleAttribute("window-buttons", height > 0);
        }

        // Move the live caption cluster into the Library sidebar. The original
        // clone-and-leave-behind path painted a second, inert restore in the
        // titlebar; the real node is assigned to a light-DOM slot so Firefox's
        // sizemode CSS (max vs restore) still applies.
        _adoptWindowButtons() {
            try {
                if (this._windowButtonsAdopted) return;
                const real = window.gZenVerticalTabsManager?.actualWindowButtons;
                const host = this._element;
                if (!real || !host || !real.parentNode) return;
                this._windowButtonsNext = real.nextSibling;
                this._windowButtonsParent = real.parentNode;
                real.setAttribute("slot", "window-buttons");
                host.appendChild(real);
                host.toggleAttribute("window-buttons", true);
                this._windowButtonsAdopted = true;
            } catch (e) { }
        }

        _restoreWindowButtons() {
            if (!this._windowButtonsAdopted) return;
            this._windowButtonsAdopted = false;
            const parent = this._windowButtonsParent;
            const next = this._windowButtonsNext;
            this._windowButtonsParent = null;
            this._windowButtonsNext = null;
            try {
                const real = window.gZenVerticalTabsManager?.actualWindowButtons;
                // The dock row stays open: a close undocks at its start, and collapsing the row there hopped the sidebar up as it left.
                if (!real) return;
                real.removeAttribute("slot");
                if (next && next.parentNode === parent) parent.insertBefore(real, next);
                else if (parent && parent.isConnected) parent.appendChild(real);
            } catch (e) { }
        }
    }

    window.gZenLibrary = new ZenLibrary();
})();
