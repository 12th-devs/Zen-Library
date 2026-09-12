"use strict";

(function () {
    class ZenLibraryBoosts {
        constructor(library) {
            this.library = library;
            this._container = null;
            this._searchTerm = "";
            this._items = []; // [{ domain, boosts: [...], activeId }]
            this._initialized = false;
            this._isFetching = false;
            this._observer = null;
        }

        get el() { return this.library.el.bind(this.library); }

        _getManager() {
            try {
                const { gZenBoostsManager } = ChromeUtils.importESModule(
                    "resource:///modules/zen/boosts/ZenBoostsManager.sys.mjs"
                );
                return gZenBoostsManager;
            } catch (e) {
                console.error("[ZenLibrary Boosts] Failed to import ZenBoostsManager:", e);
                return null;
            }
        }

        async init() {
            if (this._isFetching || this._initialized) return;
            this._isFetching = true;
            try {
                await this.fetchBoosts();
                this._initialized = true;
                this._startObserving();
            } catch (e) {
                console.error("[ZenLibrary Boosts] init error:", e);
            } finally {
                this._isFetching = false;
            }
        }

        _startObserving() {
            if (this._observer) return;
            this._observer = {
                observe: (subject, topic) => {
                    if (topic === "zen-boosts-update" || topic === "zen-boosts-active-change") {
                        // Re-fetch only if the panel is visible, otherwise mark stale
                        // so next render() picks up fresh data.
                        // We intentionally do NOT re-fetch on every toggle because
                        // registeredBoostForDomain returns false for disabled boosts,
                        // which would remove them from the list.
                        this._stale = true;
                        if (this._container?.isConnected) this.renderList();
                    }
                }
            };
            Services.obs.addObserver(this._observer, "zen-boosts-update");
            Services.obs.addObserver(this._observer, "zen-boosts-active-change");
            window.addEventListener("unload", () => {
                if (this._observer) {
                    Services.obs.removeObserver(this._observer, "zen-boosts-update");
                    Services.obs.removeObserver(this._observer, "zen-boosts-active-change");
                    this._observer = null;
                }
            }, { once: true });
        }

        destroy() {
            if (this._observer) {
                try { Services.obs.removeObserver(this._observer, "zen-boosts-update"); } catch (e) { }
                try { Services.obs.removeObserver(this._observer, "zen-boosts-active-change"); } catch (e) { }
                this._observer = null;
            }
            const popup = document.getElementById("zen-boosts-context-menu");
            if (popup) {
                try { popup.hidePopup(); } catch (e) { }
                popup.remove();
            }
            this._container = null;
        }

        async fetchBoosts() {
            const mgr = this._getManager();
            if (!mgr) {
                console.warn("[ZenLibrary Boosts] No manager available");
                this._items = [];
                return;
            }

            const results = [];
            const seenDomains = new Set();

            try {
                if (mgr.registeredDomains) {
                    for (const [domain, entry] of mgr.registeredDomains) {
                        if (!entry?.boostEntries) continue;
                        const boosts = [];
                        for (const [id, boostEntry] of entry.boostEntries) {
                            if (!boostEntry?.boostData?.changeWasMade) continue;
                            boosts.push({ id, boostEntry });
                        }
                        if (boosts.length) {
                            results.push({ domain, boosts, activeId: entry.activeBoostId });
                        }
                    }
                    results.sort((a, b) => a.domain.localeCompare(b.domain));
                    this._items = results;
                    return;
                }

                // Walk history to find all domains that have boosts
                const { PlacesUtils } = ChromeUtils.importESModule(
                    "resource://gre/modules/PlacesUtils.sys.mjs"
                );
                const query = PlacesUtils.history.getNewQuery();
                const options = PlacesUtils.history.getNewQueryOptions();
                options.sortingMode = options.SORT_BY_DATE_DESCENDING;
                options.maxResults = 2000;

                const result = PlacesUtils.history.executeQuery(query, options);
                const root = result.root;
                root.containerOpen = true;

                for (let i = 0; i < root.childCount; i++) {
                    const node = root.getChild(i);
                    try {
                        const uri = Services.io.newURI(node.uri);
                        const domain = uri.host;
                        if (!domain || seenDomains.has(domain)) continue;
                        seenDomains.add(domain);

                        // Use loadBoostsFromStore directly — registeredBoostForDomain
                        // returns false for disabled boosts, so we skip that check.
                        const boosts = mgr.loadBoostsFromStore(domain);
                        if (!boosts || boosts.length === 0) continue;

                        const validBoosts = boosts.filter(
                            b => b && b.boostEntry && b.boostEntry.boostData && b.boostEntry.boostData.changeWasMade
                        );
                        if (validBoosts.length === 0) continue;

                        const activeId = mgr.getActiveBoostId(domain);
                        results.push({ domain, boosts: validBoosts, activeId });
                    } catch (_) { /* skip invalid URIs */ }
                }

                root.containerOpen = false;
            } catch (e) {
                console.error("[ZenLibrary Boosts] fetchBoosts error:", e);
            }

            this._items = results;
        }

        render() {
            const wrapper = this.el("div", { className: "library-list-wrapper" });
            const container = this.el("div", { className: "library-list-container" });
            wrapper.appendChild(container);
            this._container = container;
            this._startObserving();

            if (this._initialized) {
                if (this._stale) {
                    this._stale = false;
                    this.fetchBoosts().then(() => {
                        this.renderList();
                        this.library.enterContent(container);
                        setTimeout(() => container.classList.add("scrollbar-visible"), 100);
                    });
                } else {
                    this.renderList();
                }
                this.library.enterContent(container);
                setTimeout(() => container.classList.add("scrollbar-visible"), 100);
                return wrapper;
            }

            // Show loading state while fetching
            container.appendChild(this.library.enterContent(this.el("div", { className: "empty-state" }, [
                this.el("div", { className: "empty-icon boosts-icon" }),
                this.el("h3", { textContent: "Loading boosts..." }),
                this.el("p", { textContent: "Gathering your site boosts." })
            ])));

            const delay = (window.gZenLibrary && window.gZenLibrary._isTransitioning) ? 400 : 200;
            setTimeout(() => {
                this.fetchBoosts().then(() => {
                    this._initialized = true;
                    container.innerHTML = "";
                    this.renderList();
                    this.library.enterContent(container);
                    setTimeout(() => container.classList.add("scrollbar-visible"), 100);
                });
            }, delay);

            return wrapper;
        }

        _ensureContextMenu() {
            if (document.getElementById("zen-boosts-context-menu")) return;

            const popup = document.createXULElement("menupopup");
            popup.id = "zen-boosts-context-menu";

            const editItem = document.createXULElement("menuitem");
            editItem.id = "zen-boosts-ctx-edit";
            editItem.setAttribute("label", "Edit boost");

            const exportItem = document.createXULElement("menuitem");
            exportItem.id = "zen-boosts-ctx-export";
            exportItem.setAttribute("label", "Export boost");

            const deleteItem = document.createXULElement("menuitem");
            deleteItem.id = "zen-boosts-ctx-delete";
            deleteItem.setAttribute("label", "Delete boost");

            popup.appendChild(editItem);
            popup.appendChild(exportItem);
            popup.appendChild(document.createXULElement("menuseparator"));
            popup.appendChild(deleteItem);
            document.getElementById("mainPopupSet")?.appendChild(popup) || document.body.appendChild(popup);
        }

        _showContextMenu(event, domain, boost, row, onDeleted) {
            this._ensureContextMenu();
            const popup = document.getElementById("zen-boosts-context-menu");
            const editItem = document.getElementById("zen-boosts-ctx-edit");
            const exportItem = document.getElementById("zen-boosts-ctx-export");
            const deleteItem = document.getElementById("zen-boosts-ctx-delete");

            // Replace listeners each time to bind correct boost
            const newEdit = editItem.cloneNode(true);
            const newExport = exportItem.cloneNode(true);
            const newDelete = deleteItem.cloneNode(true);
            editItem.replaceWith(newEdit);
            exportItem.replaceWith(newExport);
            deleteItem.replaceWith(newDelete);

            row?.setAttribute("menu-open", "true");

            newEdit.addEventListener("command", () => this.openBoostWithEditor(domain, boost));

            newExport.addEventListener("command", async () => {
                const mgr = this._getManager();
                // boost.boostEntry is the manager's own entry object; nothing fresher to load.
                const boostData = boost.boostEntry?.boostData;
                if (!mgr || !boostData) return;
                if (await mgr.exportBoost(window, boostData)) {
                    window.gZenUIManager?.showToast?.("zen-panel-ui-boosts-exported-message");
                }
            });

            newDelete.addEventListener("command", () => {
                const mgr = this._getManager();
                if (!mgr) return;
                const boostName = boost.boostEntry.boostData.boostName || domain;
                const confirmed = Services.prompt.confirm(window, "Delete This Boost?", `This can't be undone.`);
                if (!confirmed) return;
                mgr.deleteBoost({ domain, id: boost.id });
                // Remove from local cache and re-render
                const entry = this._items.find(e => e.domain === domain);
                if (entry) {
                    entry.boosts = entry.boosts.filter(b => b.id !== boost.id);
                    if (entry.boosts.length === 0) {
                        this._items = this._items.filter(e => e.domain !== domain);
                    }
                }
                onDeleted();
            });

            popup.addEventListener("popuphidden", () => row?.removeAttribute("menu-open"), { once: true });
            popup.openPopupAtScreen(event.screenX, event.screenY, true, event);
        }

        renderList() {
            if (!this._container) return;
            this._container.innerHTML = "";

            const mgr = this._getManager();

            const filtered = this._searchTerm
                ? this._items.filter(entry =>
                    entry.domain.toLowerCase().includes(this._searchTerm.toLowerCase()) ||
                    entry.boosts.some(b =>
                        (b.boostEntry.boostData.boostName || "").toLowerCase().includes(this._searchTerm.toLowerCase())
                    )
                )
                : this._items;

            if (filtered.length === 0) {
                this._container.appendChild(this.el("div", { className: "empty-state" }, [
                    this.el("div", { className: "empty-icon boosts-icon" }),
                    this.el("h3", { textContent: this._searchTerm ? "No results found" : "No boosts found" }),
                    this.el("p", { textContent: this._searchTerm ? "Try a different search term." : "Visit a site and create a boost to see it here." })
                ]));
                return;
            }

            const fragment = document.createDocumentFragment();

            for (const entry of filtered) {
                const { domain, boosts } = entry;
                // Re-fetch active ID live so toggle reflects current state
                const activeId = mgr ? mgr.getActiveBoostId(domain) : entry.activeId;

                // Per-site divider, as in the original mod (PR rows are flat and
                // carry no grouping, but the mod groups boosts under their domain).
                fragment.appendChild(this.el("div", {
                    className: "history-section-header",
                    textContent: domain
                }));

                for (const boost of boosts) {
                    const boostData = boost.boostEntry.boostData;
                    const boostId = boost.id;
                    // Always read live from manager so toggle state is accurate after obs fires
                    const isEnabled = mgr ? (mgr.getActiveBoostId(domain) === boostId) : (boostId === activeId);

                    const row = this.el("div", {
                        className: `library-list-item zen-library-row library-boost-item zen-library-boost-row${isEnabled ? "" : " boosts-disabled"}`
                    });
                    row.toggleAttribute("disabled", !isEnabled);

                    // Favicon
                    const iconContainer = this.el("span", { className: "zen-library-boost-icon" });
                    // [audit] SEC-3 — `domain` is stored data, and this string is assigned to
                    // cssText, so an unescaped quote in it injected CSS declarations into
                    // privileged chrome rather than merely breaking a favicon.
                    iconContainer.appendChild(this.el("img", {
                        className: "zen-library-row-icon",
                        src: `page-icon:https://${domain}`,
                        alt: ""
                    }));
                    iconContainer.firstElementChild.toggleAttribute("inactive", !isEnabled);
                    row.appendChild(iconContainer);

                    // Name + URL
                    const info = this.el("div", { className: "item-info zen-library-row-text" });
                    info.appendChild(this.el("div", {
                        className: "item-title zen-library-row-title",
                        textContent: boostData.boostName || domain
                    }));
                    info.appendChild(this.el("div", {
                        className: "item-url zen-library-row-subtitle",
                        textContent: domain
                    }));
                    row.appendChild(info);

                    // Toggle
                    const toggle = this._createToggle(isEnabled, () => {
                        if (!mgr) return;
                        mgr.toggleBoostActiveForDomain(domain, boostId);
                        const nowEnabled = mgr.getActiveBoostId(domain) === boostId;
                        row.classList.toggle("boosts-disabled", !nowEnabled);
                        row.toggleAttribute("disabled", !nowEnabled);
                        iconContainer.firstElementChild.toggleAttribute("inactive", !nowEnabled);
                    });
                    row.appendChild(toggle);

                    row.onclick = (e) => {
                        if (e.target.closest(".boosts-toggle")) return;
                        if (!mgr) return;
                        const currentlyEnabled = mgr.getActiveBoostId(domain) === boostId;
                        if (currentlyEnabled) {
                            this.openBoostWithEditor(domain, boost);
                            return;
                        }
                        mgr.toggleBoostActiveForDomain(domain, boostId);
                        row.classList.remove("boosts-disabled");
                        row.removeAttribute("disabled");
                        iconContainer.firstElementChild.removeAttribute("inactive");
                        toggle.setAttribute("checked", "true");
                        const thumb = toggle.querySelector(".boosts-toggle-thumb");
                        if (thumb) thumb.style.transform = "translateX(14px)";
                    };

                    row.oncontextmenu = (e) => {
                        e.preventDefault();
                        this._showContextMenu(
                            e,
                            domain,
                            boost,
                            row,
                            () => {
                                // Animate out then re-render
                                row.style.transition = "opacity 0.15s, transform 0.15s";
                                row.style.opacity = "0";
                                row.style.transform = "translateX(-8px)";
                                setTimeout(() => this.renderList(), 160);
                            }
                        );
                    };

                    fragment.appendChild(row);
                }
            }

            fragment.appendChild(this.el("div", { className: "history-bottom-spacer" }));
            this._container.appendChild(fragment);
        }

        // openBoostWindow reads boost.domain and closes on the next TabSelect, so load the store shape and open the Glance first.
        openBoostWithEditor(domain, boost) {
            const mgr = this._getManager();
            // [audit] SEC-2 — `domain` is stored data: validated, then loaded with a null principal.
            const spec = window.ZenLibraryUtil.safeExternalUrl(`https://${domain}`);
            if (!mgr || !spec) return;

            try {
                const tabPanelRect = window.windowUtils?.getBoundsWithoutFlushing?.(window.gBrowser.tabpanels);
                if (window.gZenGlanceManager && tabPanelRect) {
                    window.gZenGlanceManager.openGlance({
                        url: spec,
                        clientX: window.innerWidth / 2 - tabPanelRect.left,
                        clientY: window.innerHeight / 2 - tabPanelRect.top,
                        width: 0,
                        height: 0,
                        triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({})
                    });
                } else if (!window.ZenLibraryUtil.openExternal(window, spec)) {
                    return;
                }
                const stored = mgr.loadBoostFromStore(domain, boost.id);
                mgr.openBoostWindow(window, stored, Services.io.newURI(spec));
            } catch (e) {
                console.error("[ZenLibrary Boosts] Failed to open boost editor:", e);
            }
        }

        _createToggle(checked, onToggle) {
            // Original mod switch: div track + sliding thumb, no native button
            // chrome, so it renders identically in the shadow list.
            const toggle = this.el("div", { className: "boosts-toggle no-squircles" });
            toggle.setAttribute("checked", checked ? "true" : "false");

            const track = this.el("div", { className: "boosts-toggle-track no-squircles" });
            const thumb = this.el("div", {
                className: "boosts-toggle-thumb no-squircles",
                style: `transform: translateX(${checked ? 14 : 0}px);`
            });
            track.appendChild(thumb);
            toggle.appendChild(track);

            toggle.onclick = (e) => {
                e.stopPropagation();
                const isChecked = toggle.getAttribute("checked") === "true";
                const next = !isChecked;
                toggle.setAttribute("checked", next ? "true" : "false");
                thumb.style.transform = `translateX(${next ? 14 : 0}px)`;
                onToggle(next);
            };

            return toggle;
        }
    }

    window.ZenLibraryBoosts = ZenLibraryBoosts;
})();
