"use strict";

(function () {
    class ZenLibraryHistory {
        constructor(library) {
            this.library = library;
            this._container = null;
            this._closedWindowsContainer = null;
            this._wrapper = null;
            this._items = [];
            this._searchTerm = "";
            this._batchSize = 30;
            this._isLoading = false;
            this._renderedCount = 0;
            this._lastGroupLabel = null;
            this._isFetching = false;
            this._initialized = false; // Track if data has been pre-fetched
        }

        /**
         * Background initialization - called at startup to pre-fetch data
         */
        async init() {
            if (this._isFetching || this._initialized) return;
            this._isFetching = true;
            try {
                await this.fetchHistory();
                this._initialized = true;
            } catch (e) {
                console.error("ZenLibrary History init error:", e);
            } finally {
                this._isFetching = false;
            }
        }

        get el() { return this.library.el.bind(this.library); }

        resetView() {
            if (this._wrapper) {
                this._wrapper.classList.remove("panes-shifted");
                if (this._container) {
                    this._container.classList.add("scrollbar-visible");
                }
            }
        }

        render() {
            // Main wrapper for switcher and panes
            const wrapper = this.el("div", {
                className: "library-list-wrapper"
            });
            this._wrapper = wrapper;

            const panes = this.el("div", { className: "library-list-panes" });
            wrapper.appendChild(panes);

            // History Pane
            const historyPane = this.el("div", { className: "history-pane" });
            const historyContainer = this.el("div", {
                className: "library-list-container",
                onscroll: (e) => {
                    const el = e.target;
                    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
                        this.loadMore();
                    }
                }
            });
            this._container = historyContainer;
            historyPane.appendChild(historyContainer);
            panes.appendChild(historyPane);

            // Closed Windows Pane
            const closedPane = this.el("div", { className: "history-pane" });
            const closedContainer = this.el("div", { className: "library-closed-windows-container" });
            this._closedWindowsContainer = closedContainer;

            const backBtn = this.el("div", {
                className: "history-back-button",
                style: "flex-shrink: 0; margin-bottom: 4px;", // Prevent shrinking and add small gap
                onclick: () => this.resetView()
            }, [
                this.el("div", { className: "back-arrow" }),
                this.el("span", { textContent: "Back to History" })
            ]);
            closedPane.appendChild(backBtn);
            closedPane.appendChild(closedContainer);
            panes.appendChild(closedPane);

            const startLoading = () => {
                const onLoaded = () => {
                    historyContainer.classList.add("library-content-fade-in");
                    setTimeout(() => historyContainer.classList.add("scrollbar-visible"), 100);
                };

                const navItems = document.createDocumentFragment();

                const closedTabsItem = this.el("div", {
                    className: "history-nav-item history-nav-static",
                    onclick: () => {
                        this._wrapper.classList.add("panes-shifted");
                        this.renderClosedTabs();
                    }
                }, [
                    this.el("div", { className: "nav-icon", style: "background-image: url('chrome://browser/skin/history.svg')" }),
                    this.el("span", { className: "nav-label", textContent: "Recently closed tabs" }),
                    this.el("div", { className: "nav-arrow" })
                ]);

                const closedWindowsItem = this.el("div", {
                    className: "history-nav-item history-nav-static",
                    onclick: () => {
                        this._wrapper.classList.add("panes-shifted");
                        this.renderClosedWindows();
                    }
                }, [
                    this.el("div", { className: "nav-icon", style: "background-image: url('chrome://browser/skin/window.svg')" }),
                    this.el("span", { className: "nav-label", textContent: "Recently closed windows" }),
                    this.el("div", { className: "nav-arrow" })
                ]);

                const clearItem = this.el("div", {
                    className: "history-nav-item history-nav-static",
                    onclick: () => {
                        const win = Services.wm.getMostRecentWindow("browser:pure") || window;
                        const cmd = win.document.getElementById("Tools:Sanitize") ||
                            win.document.getElementById("cmd_sanitizeHistory");
                        if (cmd) {
                            cmd.doCommand();
                            return;
                        }
                        try { Services.obs.notifyObservers(null, "sanitize", ""); } catch (e) { }
                        try {
                            win.openDialog("chrome://browser/content/sanitize.xhtml", "Sanitize", "chrome,modal,resizable=yes,centerscreen");
                        } catch (e) { }
                    }
                }, [
                    this.el("div", { className: "nav-icon", style: "background-image: url('chrome://global/skin/icons/delete.svg')" }),
                    this.el("span", { className: "nav-label", textContent: "Clear history..." })
                ]);

                navItems.appendChild(closedTabsItem);
                navItems.appendChild(closedWindowsItem);
                navItems.appendChild(clearItem);
                historyContainer.appendChild(navItems);

                if (this._items.length === 0 && !this._isLoading) {
                    this.fetchHistory().then(() => {
                        this.renderBatch(true);
                        onLoaded();
                    });
                } else {
                    this.renderBatch(true);
                    onLoaded();
                }
            };

            // If already initialized (pre-fetched), skip loading and render instantly
            if (this._initialized && this._items.length > 0) {
                startLoading();
                historyContainer.classList.add("library-content-fade-in");
                setTimeout(() => historyContainer.classList.add("scrollbar-visible"), 50);
                // Trigger background sync (deferred to avoid stutter during transition)
                setTimeout(() => this.sync(), 400);
                return wrapper;
            }

            // No cache - show loading screen
            const isTransitioning = window.gZenLibrary && window.gZenLibrary._isTransitioning;
            const loading = this.el("div", { className: "empty-state library-content-fade-in" }, [
                this.el("div", { className: "empty-icon history-icon" }),
                this.el("h3", { textContent: "Preparing history..." }),
                this.el("p", { textContent: "Gathering your browsing history." })
            ]);
            historyContainer.appendChild(loading);

            const delay = isTransitioning ? 400 : 200;
            setTimeout(() => {
                const l = historyContainer.querySelector(".empty-state");
                if (l) l.remove();
                startLoading();
            }, delay);

            return wrapper;
        }

        /**
         * Sync - called after rendering cached data to check for updates
         * Optimized: Checks most recent item first before doing full fetch
         */
        async sync() {
            try {
                // Lightweight check: just get 1 item
                const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
                const query = PlacesUtils.history.getNewQuery();
                const options = PlacesUtils.history.getNewQueryOptions();
                options.sortingMode = options.SORT_BY_DATE_DESCENDING;
                options.maxResults = 1;

                const result = PlacesUtils.history.executeQuery(query, options);
                const root = result.root;
                root.containerOpen = true;

                let latestItem = null;
                if (root.childCount > 0) {
                    const node = root.getChild(0);
                    latestItem = { time: node.time, uri: node.uri };
                }
                root.containerOpen = false;

                // Compare with current head
                const currentHead = this._items.length > 0 ? this._items[0] : null;

                let needsUpdate = false;
                if (!latestItem && !currentHead) needsUpdate = false; // Both empty
                else if ((!latestItem && currentHead) || (latestItem && !currentHead)) needsUpdate = true; // One empty
                else if (latestItem.time !== currentHead.time) needsUpdate = true; // Timestamp diff

                if (needsUpdate) {
                    // Track time of current newest item to highlight newer ones
                    this._highlightNewerThan = currentHead ? currentHead.time : 0;

                    // Do full fetch
                    await this.fetchHistory();
                    this.renderBatch(true);

                    // Reset after render
                    this._highlightNewerThan = 0;
                }
            } catch (e) {
                console.error("ZenLibrary History sync error:", e);
            }
        }

        async init() {
            if (this.library.store) {
                this.library.store.subscribe((state) => {
                    if (state.history && state.history !== this._items) {
                        this._items = state.history;
                        // Only re-render if we are already displaying something or it's the first load
                        if (this._container) this.renderBatch(true);
                    }
                });
            }
            await this.fetchHistory();
            this._initialized = true;
        }

        // ... Sync ...

        async fetchHistory() {
            this._isLoading = true;
            try {
                const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
                const query = PlacesUtils.history.getNewQuery();
                const options = PlacesUtils.history.getNewQueryOptions();
                options.sortingMode = options.SORT_BY_DATE_DESCENDING;
                options.maxResults = 500;

                const result = PlacesUtils.history.executeQuery(query, options);
                const root = result.root;
                root.containerOpen = true;

                const items = [];
                for (let i = 0; i < root.childCount; i++) {
                    const node = root.getChild(i);
                    items.push({
                        uri: node.uri,
                        title: node.title || node.uri,
                        time: node.time,
                        timeStr: new Date(node.time / 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                        dateStr: new Date(node.time / 1000).toLocaleDateString("en-GB", { day: '2-digit', month: '2-digit', year: 'numeric' })
                    });
                }
                root.containerOpen = false;

                // dispatch to store
                if (this.library.store) {
                    this.library.store.dispatch({ type: 'SET_HISTORY', payload: items });
                } else {
                    this._items = items;
                }
            } catch (e) {
                console.error("ZenLibrary History Fetch Error:", e);
            } finally {
                this._isLoading = false;
            }
        }

        renderBatch(reset = true) {
            try {
                if (!this._container) return;

                // Check if custom elements are properly registered
                if (!customElements.get('zen-library-item')) {
                    console.error("ZenLibrary Error in renderBatch: zen-library-item custom element not registered");
                    return;
                }

                if (reset) {
                    const navItems = this._container.querySelectorAll(".history-nav-static");
                    this._container.innerHTML = "";
                    navItems.forEach(i => this._container.appendChild(i));
                    this._renderedCount = 0;
                    this._lastGroupLabel = null;
                }

                const filtered = this._searchTerm
                    ? this._items.filter(i =>
                        i.title.toLowerCase().includes(this._searchTerm.toLowerCase()) ||
                        i.uri.toLowerCase().includes(this._searchTerm.toLowerCase())
                    )
                    : this._items;

                if (filtered.length === 0 && !this._isLoading) {
                    if (!reset) return;
                    const empty = this.el("div", { className: "empty-state" }, [
                        this.el("div", { className: "empty-icon history-icon" }),
                        this.el("h3", { textContent: this._searchTerm ? "No results found" : "No history found" }),
                        this.el("p", { textContent: "Your browsing history is empty." })
                    ]);
                    this._container.appendChild(empty);
                    return;
                }

                const nextBatch = filtered.slice(this._renderedCount, this._renderedCount + this._batchSize);
                if (nextBatch.length === 0) return;

                const fragment = document.createDocumentFragment();
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

                nextBatch.forEach(item => {
                    try {
                        const timeMs = item.time / 1000;
                        let groupLabel = "";

                        if (this._searchTerm) {
                            groupLabel = "Search Results";
                        } else {
                            const d = new Date(timeMs); d.setHours(0, 0, 0, 0);
                            if (d.getTime() === today.getTime()) groupLabel = "Today";
                            else if (d.getTime() === yesterday.getTime()) groupLabel = "Yesterday";
                            else groupLabel = new Date(timeMs).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                        }

                        if (groupLabel !== this._lastGroupLabel) {
                            fragment.appendChild(this.el("div", { className: "history-section-header", textContent: groupLabel }));
                            this._lastGroupLabel = groupLabel;
                        }

                        const displayTime = (this._searchTerm || (this._lastGroupLabel !== "Today" && this._lastGroupLabel !== "Yesterday"))
                            ? item.dateStr : item.timeStr;

                        const itemEl = document.createElement('zen-library-item');
                        if (!itemEl || typeof itemEl.setAttribute !== 'function') {
                            console.error("ZenLibrary Error: zen-library-item custom element not properly registered");
                            return;
                        }
                        
                        // Set data first so status/logic can apply
                        itemEl.data = item;

                        itemEl.setAttribute("icon", `page-icon:${item.uri}`);
                        itemEl.setAttribute("title", item.title);
                        itemEl.setAttribute("subtitle", item.uri);
                        itemEl.setAttribute("time", displayTime);

                        if (this._highlightNewerThan && item.time > this._highlightNewerThan) {
                            itemEl.classList.add("pop-in");
                        }

                        itemEl.onclick = () => {
                            window.gBrowser.selectedTab = window.gBrowser.addTab(item.uri, {
                                triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
                            });
                            window.gZenLibrary.close();
                        };

                        fragment.appendChild(itemEl);
                    } catch (itemError) {
                        console.error("ZenLibrary Error processing history item:", itemError, item);
                    }
                });

                this._renderedCount += nextBatch.length;
                const oldSpacer = this._container.querySelector(".history-bottom-spacer");
                if (oldSpacer) oldSpacer.remove();
                this._container.appendChild(fragment);
                this._container.appendChild(this.el("div", { className: "history-bottom-spacer" }));
            } catch (e) {
                console.error("ZenLibrary Error in renderBatch:", e);
            }
        }

        loadMore() { if (!this._isLoading) this.renderBatch(false); }

        renderClosedTabs() {
            if (!this._closedWindowsContainer) return;
            const container = this._closedWindowsContainer;
            container.innerHTML = "";
            container.classList.remove("scrollbar-visible");

            const ss = window.SessionStore || (window.opener && window.opener.SessionStore) || Services.wm.getMostRecentWindow("browser:pure").SessionStore;
            if (!ss) return;

            const closedData = ss.getClosedTabData(window);
            if (closedData.length === 0) {
                container.appendChild(this.el("div", { className: "empty-state" }, [
                    this.el("div", { className: "empty-icon history-icon" }),
                    this.el("h3", { textContent: "No closed tabs" })
                ]));
                return;
            }

            const fragment = document.createDocumentFragment();
            fragment.appendChild(this.el("div", { className: "history-section-header", textContent: "Recently Closed Tabs" }));

            closedData.forEach((tabData, index) => {
                const title = tabData.title || tabData.state.entries[tabData.state.index - 1].title;
                const url = tabData.state.entries[tabData.state.index - 1].url;

                const row = this.el("div", {
                    className: "library-list-item",
                    onclick: () => {
                        ss.undoCloseTab(window, index);
                        window.gZenLibrary.close();
                    }
                }, [
                    this.el("div", { className: "item-icon-container" }, [
                        this.el("div", { className: "item-icon", style: `background-image: url('page-icon:${url}');` })
                    ]),
                    this.el("div", { className: "item-info" }, [
                        this.el("div", { className: "item-title", textContent: title }),
                        this.el("div", { className: "item-url", textContent: url })
                    ])
                ]);
                fragment.appendChild(row);
            });

            container.appendChild(fragment);
            container.appendChild(this.el("div", { className: "history-bottom-spacer" }));
            container.classList.add("library-content-fade-in");
            setTimeout(() => container.classList.add("scrollbar-visible"), 100);
        }

        renderClosedWindows() {
            if (!this._closedWindowsContainer) return;
            const container = this._closedWindowsContainer;
            container.innerHTML = "";
            container.classList.remove("scrollbar-visible");

            const ss = window.SessionStore || (window.opener && window.opener.SessionStore) || Services.wm.getMostRecentWindow("browser:pure").SessionStore;
            if (!ss) return;

            const closedData = ss.getClosedWindowData();
            if (closedData.length === 0) {
                container.appendChild(this.el("div", { className: "empty-state" }, [
                    this.el("div", { className: "empty-icon history-icon" }),
                    this.el("h3", { textContent: "No closed windows" })
                ]));
                return;
            }

            const fragment = document.createDocumentFragment();
            fragment.appendChild(this.el("div", { className: "history-section-header", textContent: "Recently Closed Windows" }));

            closedData.forEach((win, index) => {
                const tabsCount = win.tabs.length;
                const title = win.title || `Window with ${tabsCount} tabs`;

                const row = this.el("div", {
                    className: "library-list-item",
                    onclick: () => {
                        ss.undoCloseWindow(index);
                        window.gZenLibrary.close();
                    }
                }, [
                    this.el("div", { className: "item-icon-container" }, [
                        this.el("div", { className: "item-icon", style: "background-image: url('chrome://browser/skin/window.svg'); opacity: 0.6;" })
                    ]),
                    this.el("div", { className: "item-info" }, [
                        this.el("div", { className: "item-title", textContent: title }),
                        this.el("div", { className: "item-url", textContent: `${tabsCount} tabs` })
                    ])
                ]);
                fragment.appendChild(row);
            });

            container.appendChild(fragment);
            container.appendChild(this.el("div", { className: "history-bottom-spacer" }));
            container.classList.add("library-content-fade-in");
            setTimeout(() => container.classList.add("scrollbar-visible"), 100);
        }
    }

    window.ZenLibraryHistory = ZenLibraryHistory;
})();
