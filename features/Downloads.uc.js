"use strict";

(function () {
    class ZenLibraryDownloads {
        constructor(library) {
            this.library = library;
            this._container = null;
            this._searchTerm = "";
            this._cachedDownloads = null; // Pre-fetched data cache
            this._isFetching = false;
            this._progressTimer = null;
            this._renamedTargets = new Map();
            this._renderToken = 0;
            this._visibleLimit = ZenLibraryDownloads.INITIAL_RENDER_LIMIT;
            this._moreObserver = null;
            this._activeFilter = "all";
            this._filterLabelEl = null;
            this._folderScanCache = { folder: "", at: 0, items: null };
            this._folderScanPromise = null;
            this._downloadsScanPrefObserver = {
                observe: () => this._handleDownloadsScanPrefChange()
            };
            try {
                Services.prefs.addObserver("zen.library.downloads.scan-folder", this._downloadsScanPrefObserver);
            } catch (e) { }
        }

        static INITIAL_RENDER_LIMIT = 50;
        static RENDER_BATCH_SIZE = 50;
        static SCAN_CHUNK_SIZE = 25;
        static SCAN_CACHE_TTL_MS = 30000;
        // Native zen-library DOWNLOAD_FILTERS, mapped onto this module's status strings.
        static FILTERS = [
            { id: "all", label: "All" },
            { id: "completed", label: "Completed", statuses: ["completed", "deleted"] },
            { id: "in-progress", label: "In progress", statuses: ["downloading"] },
            { id: "failed", label: "Failed", statuses: ["failed"] },
            { id: "paused", label: "Paused", statuses: ["paused"] }
        ];

        /**
         * Background initialization - called at startup to pre-fetch data
         */
        async init() {
            if (this._isFetching) return;
            this._isFetching = true;
            try {
                this._cachedDownloads = await this.fetchDownloads();
            } catch (e) {
                console.error("ZenLibrary Downloads init error:", e);
            } finally {
                this._isFetching = false;
            }
        }

        get el() { return this.library.el.bind(this.library); }

        // Native filter button: sits beside the search box and opens a radio menupopup.
        renderFilterButton() {
            const active = ZenLibraryDownloads.FILTERS.find(f => f.id === this._activeFilter) || ZenLibraryDownloads.FILTERS[0];
            this._filterLabelEl = this.el("span", { textContent: active.label });
            const button = this.el("button", {
                className: "zen-library-filter-button",
                title: "Filter downloads",
                onclick: (event) => {
                    event.preventDefault();
                    this._openFilterMenu(button);
                }
            }, [
                this.el("img", { src: "chrome://browser/skin/zen-icons/sliders.svg", alt: "" }),
                this._filterLabelEl
            ]);
            return button;
        }

        _openFilterMenu(anchor) {
            const popup = document.createXULElement("menupopup");
            for (const filter of ZenLibraryDownloads.FILTERS) {
                const item = document.createXULElement("menuitem");
                item.setAttribute("type", "radio");
                item.setAttribute("label", filter.label);
                if (filter.id === this._activeFilter) item.setAttribute("checked", "true");
                item.addEventListener("command", () => this._setFilter(filter.id), { once: true });
                popup.appendChild(item);
            }
            popup.addEventListener("popuphidden", () => {
                anchor.removeAttribute("open");
                popup.remove();
            }, { once: true });
            anchor.setAttribute("open", "true");
            (document.getElementById("mainPopupSet") || document.body).appendChild(popup);
            popup.openPopup(anchor, "after_end", 0, 4, false, false);
        }

        _setFilter(id) {
            if (id === this._activeFilter) return;
            this._activeFilter = id;
            if (this._filterLabelEl) {
                this._filterLabelEl.textContent = ZenLibraryDownloads.FILTERS.find(f => f.id === id)?.label || "All";
            }
            this._visibleLimit = ZenLibraryDownloads.INITIAL_RENDER_LIMIT;
            if (this._cachedDownloads) this.renderList(this._cachedDownloads);
            else this.fetchDownloads().then(d => { this._cachedDownloads = d; this.renderList(d); });
        }

        _matchesFilter(item) {
            const filter = ZenLibraryDownloads.FILTERS.find(f => f.id === this._activeFilter);
            return !filter?.statuses || filter.statuses.includes(item.status);
        }

        render() {
            // Main wrapper for switcher and panes
            const wrapper = this.el("div", {
                className: "library-list-wrapper"
            });
            const container = this.el("div", { className: "library-list-container" });
            wrapper.appendChild(container);
            this._container = container;
            const token = ++this._renderToken;
            this._visibleLimit = ZenLibraryDownloads.INITIAL_RENDER_LIMIT;

            // If we have cached data, render instantly
            if (this._cachedDownloads) {
                this.renderList(this._cachedDownloads);
                this.library.enterContent(container);
                requestAnimationFrame(() => {
                    if (this._canRender(token, container)) container.classList.add("scrollbar-visible");
                });
                // Trigger a background sync to check for updates
                this.sync(token, container);
                return wrapper;
            }

            // No cache - show loading and fetch
            const loading = this.el("div", { className: "empty-state" }, [
                this.el("div", { className: "empty-icon downloads-icon" }),
                this.el("h3", { textContent: "Loading downloads..." }),
                this.el("p", { textContent: "Hang tight, we're gathering your download history." })
            ]);
            this.library.enterContent(loading);
            container.appendChild(loading);

            const isTransitioning = window.gZenLibrary && window.gZenLibrary._isTransitioning;
            const delay = isTransitioning ? 120 : 0;
            setTimeout(() => {
                this.fetchDownloads().then(downloads => {
                    if (!this._canRender(token, container)) return;
                    this._cachedDownloads = downloads;
                    const l = container.querySelector(".empty-state");
                    if (l) l.remove();
                    this.renderList(downloads);
                    this.library.enterContent(container);
                    requestAnimationFrame(() => {
                        if (this._canRender(token, container)) container.classList.add("scrollbar-visible");
                    });
                });
            }, delay);

            return wrapper;
        }

        /**
         * Sync - called after rendering cached data to check for updates
         * Always re-fetches to detect status changes (e.g., deleted files)
         */
        async sync(token = this._renderToken, container = this._container) {
            try {
                const freshDownloads = await this.fetchDownloads();
                if (!this._canRender(token, container)) return;

                // Always update cache and re-render to catch status changes
                // Status changes (deleted, completed) don't change length/timestamp
                this._cachedDownloads = freshDownloads;
                this.renderList(freshDownloads);
            } catch (e) {
                console.error("ZenLibrary Downloads sync error:", e);
            }
        }

        _canRender(token, container) {
            return token === this._renderToken &&
                this._container === container &&
                this.library?.activeTab === "downloads" &&
                container?.isConnected;
        }


        async fetchDownloads() {
            try {
                const { DownloadHistory } = ChromeUtils.importESModule("resource://gre/modules/DownloadHistory.sys.mjs");
                const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
                const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");

                const isPrivate = PrivateBrowsingUtils.isContentWindowPrivate(window);
                const historyList = await DownloadHistory.getList({ type: isPrivate ? Downloads.ALL : Downloads.PUBLIC });
                const allDownloadsRaw = await historyList.getAll();
                const liveDownloads = await this.fetchLiveDownloads(Downloads);

                const downloads = allDownloadsRaw.map(d => {
                    const liveDownload = this.findMatchingLiveDownload(d, liveDownloads);
                    const progressSource = liveDownload || d;
                    let filename = "Unknown Filename";
                    const targetInfo = this.resolveDownloadTarget(d, liveDownload);
                    const targetPath = targetInfo.path;
                    const fileExists = targetInfo.exists;

                    if (targetInfo.leafName) {
                        filename = targetInfo.leafName;
                    } else if (d.target && d.target.path) {
                        const pathParts = String(d.target.path).split(/[\\/]/);
                        filename = pathParts.pop() || "ErrorInPathUtil";
                    }

                    if ((filename === "Unknown Filename" || filename === "ErrorInPathUtil") && d.source && d.source.url) {
                        try {
                            const decodedUrl = decodeURIComponent(d.source.url);
                            let urlObj;
                            try {
                                urlObj = new URL(decodedUrl);
                                const pathSegments = urlObj.pathname.split("/");
                                filename = pathSegments.pop() || pathSegments.pop() || "Unknown from URL Path";
                            } catch (urlParseError) {
                                const urlPartsDirect = String(d.source.url).split("/");
                                const lastPartDirect = urlPartsDirect.pop() || urlPartsDirect.pop();
                                filename = lastPartDirect.split("?")[0] || "Invalid URL Filename";
                            }
                        } catch (e) {
                            const urlPartsDirect = String(d.source.url).split("/");
                            const lastPartDirect = urlPartsDirect.pop() || urlPartsDirect.pop();
                            filename = lastPartDirect.split("?")[0] || "Invalid URL Filename";
                        }
                    }

                    let status = "unknown";
                    let progressBytes = Number(progressSource.currentBytes ?? progressSource.bytesTransferredSoFar) || 0;
                    let totalBytes = Number(progressSource.totalBytes ?? d.totalBytes) || 0;

                    if (progressSource.succeeded) {
                        status = "completed";
                        if (progressSource.target && progressSource.target.size && Number(progressSource.target.size) > totalBytes) {
                            totalBytes = Number(progressSource.target.size);
                        }
                        progressBytes = Number(progressSource.currentBytes || totalBytes) || totalBytes;
                    } else if (progressSource.error || progressSource.canceled) {
                        status = "failed";
                    } else if (!progressSource.stopped || progressSource.state === Downloads.STATE_DOWNLOADING) {
                        status = "downloading";
                    } else if (progressSource.hasPartialData || progressSource.state === Downloads.STATE_PAUSED || progressSource.stopped) {
                        status = "paused";
                    }

                    if (status === "completed" && totalBytes === 0 && progressBytes > 0) {
                        totalBytes = progressBytes;
                    }

                    if (status === "completed" && (targetPath || d.target?.path) && !fileExists) {
                        status = "deleted";
                    }

                    return {
                        id: this._itemKey(d),
                        filename: String(filename || "FN_MISSING"),
                        size: totalBytes,
                        progressBytes,
                        totalBytes,
                        percent: totalBytes > 0 ? Math.min(100, Math.max(0, (progressBytes / totalBytes) * 100)) : 0,
                        estimatedSeconds: this.estimateRemainingSeconds(progressSource, progressBytes, totalBytes),
                        status: status,
                        url: String(d.source?.url || "URL_MISSING"),
                        timestamp: d.endTime || d.startTime || Date.now(),
                        targetPath: String(targetPath || ""),
                        raw: liveDownload || d,
                        historyRaw: d
                    };
                // [audit] PERF-1 — the search term used to be applied here, which made the
                // full download list a function of it and meant every keystroke re-ran
                // DownloadHistory.getAll() plus an nsIFile.exists() per download. Filtering
                // moved to renderList, so the fetched list is now search-independent and can
                // be served from _cachedDownloads. Matches how Media does it.
                }).filter(d => d.timestamp);

                if (this._shouldScanDownloadsFolder()) {
                    return await this.mergeFolderScan(downloads, Downloads);
                }

                return downloads;

            } catch (e) {
                console.error("ZenLibrary: Error fetching downloads", e);
                return [];
            }
        }

        async fetchLiveDownloads(Downloads) {
            try {
                const downloadApi = window.Downloads && typeof window.Downloads.getList === "function" ? window.Downloads : Downloads;
                const listType = downloadApi.ALL || Downloads.ALL;
                const list = await downloadApi.getList(listType);
                return await list.getAll();
            } catch (e) {
                console.warn("[ZenLibrary Downloads] Live download lookup failed:", e);
                return [];
            }
        }

        _shouldScanDownloadsFolder() {
            try {
                return Services.prefs.getBoolPref("zen.library.downloads.scan-folder", false);
            } catch (e) {
                return false;
            }
        }

        _clearFolderScanCache() {
            this._folderScanCache = { folder: "", at: 0, items: null };
            this._folderScanPromise = null;
        }

        _handleDownloadsScanPrefChange() {
            this._clearFolderScanCache();
            this._cachedDownloads = null;
            if (!this._canRender(this._renderToken, this._container)) return;

            const token = ++this._renderToken;
            const container = this._container;
            this._visibleLimit = ZenLibraryDownloads.INITIAL_RENDER_LIMIT;
            this._disconnectMoreObserver();
            container.innerHTML = "";
            container.appendChild(this.el("div", { className: "empty-state" }, [
                this.el("div", { className: "empty-icon downloads-icon" }),
                this.el("h3", { textContent: "Loading downloads..." }),
                this.el("p", { textContent: "Refreshing your Downloads view." })
            ]));

            this.fetchDownloads().then(downloads => {
                if (!this._canRender(token, container)) return;
                this._cachedDownloads = downloads;
                this.renderList(downloads);
            }).catch(e => console.error("ZenLibrary Downloads live config refresh error:", e));
        }

        async mergeFolderScan(downloads, Downloads) {
            try {
                const scanned = await this.scanDownloadsFolder(Downloads, downloads);
                if (!scanned.length) return downloads;
                return downloads.concat(scanned);
            } catch (e) {
                console.warn("[ZenLibrary Downloads] Folder scan failed:", e);
                return downloads;
            }
        }

        async scanDownloadsFolder(Downloads, knownDownloads = []) {
            const folder = await this.getDownloadsFolderPath(Downloads);
            if (!folder) return [];

            const knownPaths = new Set(
                knownDownloads
                    .map(d => this.normalizeDownloadPath(d.targetPath))
                    .filter(Boolean)
            );

            if (
                this._folderScanCache.folder === folder &&
                this._folderScanCache.items &&
                Date.now() - this._folderScanCache.at < ZenLibraryDownloads.SCAN_CACHE_TTL_MS
            ) {
                return this._folderScanCache.items.filter(item => {
                    const normalized = this.normalizeDownloadPath(item.targetPath);
                    if (!normalized || knownPaths.has(normalized)) return false;
                    knownPaths.add(normalized);
                    return true;
                });
            }

            if (this._folderScanPromise) {
                const cached = await this._folderScanPromise;
                return cached.filter(item => {
                    const normalized = this.normalizeDownloadPath(item.targetPath);
                    if (!normalized || knownPaths.has(normalized)) return false;
                    knownPaths.add(normalized);
                    return true;
                });
            }

            this._folderScanPromise = this.scanDownloadsFolderFiles(folder);
            let scanned = [];
            try {
                scanned = await this._folderScanPromise;
                this._folderScanCache = { folder, at: Date.now(), items: scanned };
            } finally {
                this._folderScanPromise = null;
            }

            return scanned.filter(item => {
                const normalized = this.normalizeDownloadPath(item.targetPath);
                if (!normalized || knownPaths.has(normalized)) return false;
                knownPaths.add(normalized);
                return true;
            });
        }

        async scanDownloadsFolderFiles(folder) {
            const scanned = [];
            let children = [];
            try {
                children = await IOUtils.getChildren(folder);
            } catch (e) {
                console.warn("[ZenLibrary Downloads] Could not read Downloads folder:", e);
                return [];
            }

            for (let i = 0; i < children.length; i += ZenLibraryDownloads.SCAN_CHUNK_SIZE) {
                const chunk = children.slice(i, i + ZenLibraryDownloads.SCAN_CHUNK_SIZE);
                const entries = await Promise.all(chunk.map(async path => {
                    try {
                        const info = await IOUtils.stat(path);
                        if (info.type && info.type !== "regular" && info.type !== "directory") return null;
                        return this.createScannedDownloadItem(path, info);
                    } catch (e) {
                        return null;
                    }
                }));
                for (const entry of entries) {
                    if (entry) scanned.push(entry);
                }
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            return scanned;
        }

        async getDownloadsFolderPath(Downloads) {
            try {
                if (Downloads && typeof Downloads.getSystemDownloadsDirectory === "function") {
                    const path = await Downloads.getSystemDownloadsDirectory();
                    if (path) return path;
                }
            } catch (e) { }

            try {
                return Services.dirsvc.get("DfltDwnld", Ci.nsIFile).path;
            } catch (e) {
                return "";
            }
        }

        createScannedDownloadItem(path, info) {
            const normalized = this.normalizeDownloadPath(path);
            if (!normalized) return null;

            try {
                const filename = this.leafNameFromPath(path);
                const timestamp = info.lastModified || info.creationTime || Date.now();
                const size = Number(info.size) || 0;
                const isFolder = info.type === "directory";
                return {
                    id: `folder-scan|${normalized}`,
                    filename,
                    size,
                    progressBytes: isFolder ? 0 : size,
                    totalBytes: isFolder ? 0 : size,
                    percent: isFolder || size > 0 ? 100 : 0,
                    estimatedSeconds: null,
                    status: "completed",
                    url: "",
                    timestamp,
                    targetPath: path,
                    raw: null,
                    historyRaw: null,
                    scannedFromFolder: true,
                    isFolder
                };
            } catch (e) {
                return null;
            }
        }

        // A download the user renamed from this panel keeps its history entry pointing at
        // the old path, so resolving straight from `target.path` reports it deleted. The
        // live download wins if there is one, then any rename we recorded ourselves, then
        // whatever history has. This resolver still avoids guessing a renamed path from a
        // same-size file; the optional Downloads-folder scan below adds independent files
        // as their own rows instead of silently retargeting a history row.
        resolveDownloadTarget(historyDownload, liveDownload) {
            const candidates = [
                liveDownload?.target?.path,
                this._renamedTargets.get(this.normalizeDownloadPath(historyDownload?.target?.path)),
                historyDownload?.target?.path
            ];

            for (const candidate of candidates) {
                const resolved = this.inspectTargetPath(candidate);
                if (resolved.exists) return resolved;
            }

            return this.inspectTargetPath(candidates.find(Boolean));
        }

        inspectTargetPath(path) {
            if (!path || typeof path !== "string") {
                return { path: "", exists: false, leafName: "" };
            }

            try {
                const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
                file.initWithPath(path);
                return {
                    path: file.path,
                    exists: file.exists(),
                    leafName: file.leafName || ""
                };
            } catch (e) {
                const pathParts = String(path).split(/[\\/]/);
                return {
                    path: String(path),
                    exists: false,
                    leafName: pathParts.pop() || ""
                };
            }
        }

        // Download and HistoryDownload objects carry no id, so rows are keyed on what identifies one: target, source and start.
        _itemKey(d) {
            const start = d.startTime ? new Date(d.startTime).getTime() : "";
            return `${d.target?.path || ""}|${d.source?.url || ""}|${start}`;
        }

        findMatchingLiveDownload(download, liveDownloads) {
            if (!liveDownloads || !liveDownloads.length) return null;
            if (liveDownloads.includes(download)) return download;

            if (download.target?.path) {
                const normalizedPath = this.normalizeDownloadPath(download.target.path);
                const byPath = liveDownloads.find(dl => this.normalizeDownloadPath(dl.target?.path) === normalizedPath);
                if (byPath) return byPath;
            }

            if (download.source?.url && download.startTime) {
                const startTime = new Date(download.startTime).getTime();
                const byUrlTime = liveDownloads.find(dl => {
                    if (dl.source?.url !== download.source.url || !dl.startTime) return false;
                    return Math.abs(new Date(dl.startTime).getTime() - startTime) < 5000;
                });
                if (byUrlTime) return byUrlTime;
            }

            return null;
        }

        normalizeDownloadPath(path) {
            return typeof path === "string" ? path.replace(/\\/g, "/").toLowerCase() : "";
        }

        leafNameFromPath(path) {
            const parts = String(path || "").split(/[\\/]/);
            return parts.pop() || "Unknown Filename";
        }

        estimateRemainingSeconds(download, progressBytes, totalBytes) {
            if (!totalBytes || !progressBytes || progressBytes >= totalBytes) return null;

            const liveSpeed = Number(download.speed) || 0;
            if (liveSpeed > 0) {
                return Math.max(1, Math.round((totalBytes - progressBytes) / liveSpeed));
            }

            const start = download.startTime ? new Date(download.startTime).getTime() : 0;
            const elapsedSeconds = start ? Math.max(1, (Date.now() - start) / 1000) : 0;
            if (!elapsedSeconds) return null;

            const bytesPerSecond = progressBytes / elapsedSeconds;
            if (!bytesPerSecond || !Number.isFinite(bytesPerSecond)) return null;

            return Math.max(1, Math.round((totalBytes - progressBytes) / bytesPerSecond));
        }

        scheduleProgressRefresh(downloads) {
            if (this._progressTimer) {
                clearTimeout(this._progressTimer);
                this._progressTimer = null;
            }

            if (!downloads.some(d => d.status === "downloading")) return;

            this._progressTimer = setTimeout(() => {
                this._progressTimer = null;
                if (!this._canRender(this._renderToken, this._container)) return;
                this._refreshProgress().catch(e => console.error("ZenLibrary Downloads progress refresh error:", e));
            }, 1000);
        }

        // Live rows are patched in place from the session list; the full re-fetch (history plus a stat per entry) and
        // list rebuild — which also reset the scroll position — only run once a download leaves the downloading state.
        async _refreshProgress() {
            const token = this._renderToken;
            const container = this._container;
            const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
            const live = await this.fetchLiveDownloads(Downloads);
            if (!this._canRender(token, container)) return;

            const active = (this._cachedDownloads || []).filter(d => d.status === "downloading");
            let stateChanged = active.length === 0;
            for (const item of active) {
                const dl = this.findMatchingLiveDownload(item.historyRaw, live);
                if (!dl || dl.succeeded || dl.error || dl.canceled || dl.stopped) {
                    stateChanged = true;
                    continue;
                }
                item.progressBytes = Number(dl.currentBytes) || 0;
                item.totalBytes = Number(dl.totalBytes) || item.totalBytes;
                item.size = item.totalBytes;
                item.percent = item.totalBytes > 0 ? Math.min(100, Math.max(0, (item.progressBytes / item.totalBytes) * 100)) : 0;
                item.estimatedSeconds = this.estimateRemainingSeconds(dl, item.progressBytes, item.totalBytes);
                this._paintProgressRow(item);
            }

            if (stateChanged) await this.sync(token, container);
            else this.scheduleProgressRefresh(this._cachedDownloads);
        }

        _paintProgressRow(item) {
            const row = this._progressRows?.get(item.id);
            if (!row?.isConnected) return;
            row.querySelector(".download-progress-percent").textContent = item.totalBytes > 0 ? `${Math.round(item.percent)}%` : "";
            row.querySelector(".download-progress-fill").style.width = `${item.totalBytes > 0 ? item.percent : 18}%`;
            const [transferred, eta] = row.querySelectorAll(".download-progress-meta > span");
            transferred.textContent = `${this.formatBytes(item.progressBytes)} of ${item.totalBytes > 0 ? this.formatBytes(item.totalBytes) : "Unknown size"}`;
            eta.textContent = item.estimatedSeconds ? this.formatDuration(item.estimatedSeconds) : "Calculating";
        }

        renderList(downloads) {
            try {
                if (!this._container) return;
                this._disconnectMoreObserver();

                // Check if custom elements are properly registered
                if (!customElements.get('zen-library-item')) {
                    console.error("ZenLibrary Error in renderList: zen-library-item custom element not registered");
                    return;
                }

                this._container.innerHTML = "";
                this._container.classList.add("scrollbar-visible");
                this._progressRows = new Map();

                // [audit] PERF-1 — the search filter lives here now rather than in
                // fetchDownloads. See the note there.
                if (this._searchTerm) {
                    const term = this._searchTerm.toLowerCase();
                    downloads = downloads.filter(d => d.filename.toLowerCase().includes(term));
                }
                if (this._activeFilter !== "all") downloads = downloads.filter(d => this._matchesFilter(d));
                downloads = downloads.slice().sort((a, b) => b.timestamp - a.timestamp);
                const visibleLimit = Math.min(this._visibleLimit || ZenLibraryDownloads.INITIAL_RENDER_LIMIT, downloads.length);
                const visibleDownloads = downloads.slice(0, visibleLimit);

                if (downloads.length === 0) {
                    const emptyState = this.el("div", { className: "empty-state" }, [
                        this.el("div", { className: "empty-icon downloads-icon" }),
                        this.el("h3", { textContent: "No downloads found" }),
                        this.el("p", { textContent: this._searchTerm ? "Try a different search term." : this._activeFilter !== "all" ? "No downloads match this filter." : "Your download history is empty." })
                    ]);
                    this._container.appendChild(emptyState);
                    return;
                }

                // Group by date — compare calendar dates, not elapsed hours
                const groups = {};
                const now = new Date();
                const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const yesterdayMidnight = new Date(todayMidnight);
                yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);
                const weekAgoMidnight = new Date(todayMidnight);
                weekAgoMidnight.setDate(weekAgoMidnight.getDate() - 7);
                const monthAgoMidnight = new Date(todayMidnight);
                monthAgoMidnight.setDate(monthAgoMidnight.getDate() - 30);

                visibleDownloads.forEach(d => {
                    const date = new Date(d.timestamp);
                    const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                    let key;
                    if (dateMidnight.getTime() === todayMidnight.getTime()) {
                        key = "Today";
                    } else if (dateMidnight.getTime() === yesterdayMidnight.getTime()) {
                        key = "Yesterday";
                    } else if (dateMidnight >= weekAgoMidnight) {
                        key = date.toLocaleDateString(undefined, { weekday: "long" });
                    } else if (dateMidnight >= monthAgoMidnight) {
                        key = "Last Month";
                    } else {
                        key = "Earlier";
                    }
                    if (!groups[key]) groups[key] = [];
                    groups[key].push(d);
                });

                const order = ["Today", "Yesterday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Last Month", "Earlier"];

                order.forEach(key => {
                    if (!groups[key]) return;

                    this._container.appendChild(this.el("div", { className: "history-section-header", textContent: key }));

                    groups[key].sort((a, b) => b.timestamp - a.timestamp).forEach(item => {
                        try {
                            if (item.status === "downloading") {
                                const row = this.createProgressItem(item);
                                this._progressRows.set(item.id, row);
                                this._container.appendChild(row);
                                return;
                            }

                            const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const itemEl = document.createElement('zen-library-item');
                            if (!itemEl || typeof itemEl.setAttribute !== 'function') {
                                console.error("ZenLibrary Error: zen-library-item custom element not properly registered");
                                return;
                            }

                            itemEl.data = item; // Sets item data and status classes
                            // [audit] BUG-1 — was `moz-icon://${item.targetPath}?size=32`,
                            // interpolating a raw Windows path into a URL. The drive colon
                            // and every backslash need encoding, and a filename containing
                            // ?, # or % swallowed the ?size= parameter. fileIconUrl() builds
                            // it from a proper file: URI instead.
                            itemEl.setAttribute("icon", window.ZenLibraryUtil.fileIconUrl(item.targetPath));
                            itemEl.setAttribute("title", item.filename);
                            itemEl.setAttribute("subtitle", item.isFolder ? "Folder" : `${this.formatBytes(item.size)} • ${item.status}`);
                            itemEl.setAttribute("time", timeStr);

                            itemEl.onclick = (e) => {
                                if (e.target.closest('.download-row-actions, .item-folder-icon')) return;
                                if (item.status === "deleted") return;
                                this.handleAction(item, "show");
                            };
                            itemEl.oncontextmenu = (e) => {
                                e.preventDefault();
                                this._showContextMenu(e, item, itemEl);
                            };

                            // Add drag-and-drop support for dragging to web pages
                            itemEl.setAttribute('draggable', item.isFolder ? 'false' : 'true');
                            itemEl.addEventListener('dragstart', async (e) => {
                                // Only allow drag if we have a file path and file exists
                                if (!item.targetPath || item.status === 'deleted' || item.isFolder) {
                                    e.preventDefault();
                                    return;
                                }

                                try {
                                    const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
                                    file.initWithPath(item.targetPath);

                                    if (!file.exists()) {
                                        e.preventDefault();
                                        return;
                                    }

                                    // Set the native file flavor for Firefox
                                    if (e.dataTransfer && typeof e.dataTransfer.mozSetDataAt === 'function') {
                                        e.dataTransfer.mozSetDataAt('application/x-moz-file', file, 0);
                                    }

                                    // URI flavors for web pages; newFileURI encodes spaces, # and % that a hand-built file: URL left raw.
                                    const fileUrl = Services.io.newFileURI(file).spec;
                                    e.dataTransfer.setData('text/uri-list', fileUrl);
                                    e.dataTransfer.setData('text/plain', fileUrl);

                                    // Optionally, set a download URL for HTML5 drop targets
                                    if (item.url) {
                                        const contentType = this.getContentTypeFromFilename(item.filename);
                                        e.dataTransfer.setData('DownloadURL', `${contentType}:${item.filename}:${item.url}`);
                                    }

                                    // Use the item element as drag image
                                    e.dataTransfer.setDragImage(itemEl, 20, 20);
                                } catch (err) {
                                    console.error('[ZenLibrary Downloads] Error during dragstart:', err);
                                    e.preventDefault();
                                }
                            });

                            const subtitle = itemEl.querySelector(".item-url");
                            if (subtitle) {
                                subtitle.textContent = "";
                                subtitle.appendChild(this.el("span", {
                                    className: "download-row-status",
                                    textContent: item.isFolder ? "Folder" : `${this.formatBytes(item.size)} • ${item.status}`
                                }));
                                subtitle.appendChild(this.el("span", {
                                    className: "download-row-url",
                                    textContent: this.formatDisplayUrl(item.url)
                                }));
                            }

                            const actions = this.createRowActions(item, itemEl);
                            itemEl.appendSecondaryAction(actions);
                            this._container.appendChild(itemEl);
                        } catch (itemError) {
                            console.error("ZenLibrary Error processing download item:", itemError, item);
                        }
                    });
                });

                if (visibleLimit < downloads.length) {
                    const sentinel = this.el("div", {
                        className: "downloads-load-more-sentinel",
                        "aria-hidden": "true"
                    });
                    this._container.appendChild(sentinel);
                    this._observeMore(sentinel, downloads);
                }
                this._container.appendChild(this.el("div", { className: "history-bottom-spacer" }));
                this.scheduleProgressRefresh(downloads);
            } catch (e) {
                console.error("ZenLibrary Error in renderList:", e);
            }
        }

        _observeMore(sentinel, downloads) {
            if (!sentinel || !this._container) return;
            this._disconnectMoreObserver();
            this._moreObserver = new IntersectionObserver((entries) => {
                if (!entries.some(entry => entry.isIntersecting)) return;
                this._disconnectMoreObserver();
                // renderList() empties the scroll container, which clamps scrollTop to 0
                // and would otherwise throw the user back to the top of the list on every
                // batch. Captured here, before the wipe, and restored after it.
                const prevScroll = this._container?.scrollTop || 0;
                this._visibleLimit = (this._visibleLimit || ZenLibraryDownloads.INITIAL_RENDER_LIMIT) + ZenLibraryDownloads.RENDER_BATCH_SIZE;
                requestAnimationFrame(() => {
                    this.renderList(downloads);
                    if (this._container) this._container.scrollTop = prevScroll;
                });
            }, { root: this._container, rootMargin: "300px 0px" });
            this._moreObserver.observe(sentinel);
        }

        _disconnectMoreObserver() {
            if (this._moreObserver) {
                this._moreObserver.disconnect();
                this._moreObserver = null;
            }
        }

        // [audit] SEC-3 / BUG-1 — the icon declaration, with the URL escaped for CSS.
        _iconStyle(targetPath) {
            const url = window.ZenLibraryUtil.fileIconUrl(targetPath);
            if (!url) return "";
            return `background-image: url("${window.ZenLibraryUtil.cssUrl(url)}");`;
        }

        createRowActions(item, itemEl) {
            const actions = this.el("div", { className: "download-row-actions zen-library-row-actions" });

            if (item.status === "failed" || item.status === "canceled" || item.status === "cancelled") {
                actions.appendChild(this.el("button", {
                    className: "download-row-action download-row-retry",
                    title: "Retry",
                    "aria-label": "Retry",
                    onclick: (e) => {
                        e.stopPropagation();
                        this.handleAction(item, "resume");
                    }
                }, [this.el("span", { className: "download-row-action-icon retry-icon", "aria-hidden": "true" })]));
            }

            actions.appendChild(this.el("button", {
                className: "download-row-action download-row-more",
                title: "More actions",
                "aria-label": "More actions",
                onclick: (e) => {
                    e.stopPropagation();
                    this._showContextMenu(e, item, itemEl, e.currentTarget);
                }
            }, [this.el("span", { className: "download-row-action-icon more-icon", "aria-hidden": "true" })]));

            return actions;
        }

        createProgressItem(item) {
            const percentLabel = item.totalBytes > 0 ? `${Math.round(item.percent)}%` : "";
            const totalLabel = item.totalBytes > 0 ? this.formatBytes(item.totalBytes) : "Unknown size";
            const etaLabel = item.estimatedSeconds ? this.formatDuration(item.estimatedSeconds) : "Calculating";

            const row = this.el("div", {
                className: "library-download-progress-item",
                oncontextmenu: (e) => {
                    e.preventDefault();
                    this._showContextMenu(e, item, row);
                }
            }, [
                this.el("div", { className: "download-progress-icon-container" }, [
                    // [audit] SEC-3 / BUG-1 — this one reached el()'s `style` prop, which
                    // assigns to cssText, so an unescaped filename here was not just a
                    // broken icon but a way to inject whole CSS declarations into chrome.
                    this.el("div", {
                        className: "download-progress-icon",
                        style: this._iconStyle(item.targetPath)
                    })
                ]),
                this.el("div", { className: "download-progress-main" }, [
                    this.el("div", { className: "download-progress-title-row" }, [
                        this.el("span", { className: "download-progress-name", textContent: item.filename }),
                        this.el("span", { className: "download-progress-percent", textContent: percentLabel })
                    ]),
                    this.el("div", { className: "download-progress-bar" }, [
                        this.el("div", {
                            className: "download-progress-fill",
                            style: `width: ${item.totalBytes > 0 ? item.percent : 18}%;`
                        })
                    ]),
                    this.el("div", { className: "download-progress-meta" }, [
                        this.el("span", { textContent: `${this.formatBytes(item.progressBytes)} of ${totalLabel}` }),
                        this.el("span", { textContent: etaLabel })
                    ])
                ]),
                this.el("button", {
                    className: "download-progress-cancel",
                    title: "Cancel download",
                    "aria-label": "Cancel download",
                    onclick: (e) => {
                        e.stopPropagation();
                        this.handleAction(item, "cancel");
                    }
                }, [this.el("span", { className: "download-progress-cancel-icon", "aria-hidden": "true" })])
            ]);

            return row;
        }

        // [audit] SEC-1 — extensions Windows will execute, or that execute something on its
        // behalf. nsIFile.isExecutable() answers for the +x bit on Unix and for a handful of
        // types on Windows, but it does not cover .lnk, .msi, .scr or the script hosts, so
        // the list is checked as well rather than instead.
        //
        // Not an attempt at an exhaustive blocklist — Firefox keeps its own far longer one.
        // The point is that the common ways a downloaded file runs code all reach a prompt.
        static EXECUTABLE_EXTENSIONS = new Set([
            "exe", "msi", "msp", "com", "scr", "pif", "cpl", "lnk", "url", "inf", "reg",
            "bat", "cmd", "vb", "vbs", "vbe", "js", "jse", "ws", "wsf", "wsh", "wsc",
            "ps1", "ps1xml", "ps2", "psc1", "msc", "jar", "app", "dmg", "pkg", "deb",
            "rpm", "run", "sh", "bash", "command", "hta", "chm", "gadget", "appx", "appimage"
        ]);

        _isExecutable(file, filename) {
            const ext = String(filename || "").split(".").pop().toLowerCase();
            if (ZenLibraryDownloads.EXECUTABLE_EXTENSIONS.has(ext)) return true;
            try {
                return file.isExecutable();
            } catch (e) {
                // Cannot tell. Treat as executable — a spurious prompt costs a click, and
                // the other way round costs arbitrary code execution.
                return true;
            }
        }

        // [audit] SEC-1 — this used to be a bare nsIFile.launch() reachable from a single
        // click on the row. launch() is the raw shell-execute path: it bypasses everything
        // Firefox's own Downloads panel does via Download.launch() →
        // DownloadIntegration.launchDownload, which is where the executable confirmation and
        // browser.download.always_ask_before_handling_new_types are applied. One stray click
        // in the library ran a downloaded .exe with no prompt at all.
        //
        // So: prefer the real Download object's launch() when there is one — it is already
        // held for pause/resume/cancel — and when falling back to nsIFile, confirm first for
        // anything that can execute.
        async _launch(item, file) {
            if (item.raw && typeof item.raw.launch === "function") {
                try {
                    await item.raw.launch();
                    return;
                } catch (e) {
                    console.error("[ZenLibrary Downloads] Download.launch failed, falling back:", e);
                }
            }

            if (this._isExecutable(file, item.filename)) {
                const proceed = Services.prompt.confirmEx(
                    window,
                    "Open this file?",
                    `"${item.filename}" is an executable file. Opening it will run it on your ` +
                    `computer with your account's permissions.\n\nOnly open files you trust.`,
                    Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING +
                    Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_CANCEL,
                    "Open anyway", null, null, null, { value: false }
                ) === 0;
                if (!proceed) return;
            }

            file.launch();
        }

        handleAction(item, action) {
            try {
                if (action === "open-link") {
                    // [audit] SEC-2 — was a system triggering principal on a URL that comes
                    // from the download's own metadata. That is what would let a javascript:
                    // or data: entry load with privilege. Validated, then null principal.
                    window.ZenLibraryUtil.openExternal(window, item.url);
                    window.gZenLibrary.close();
                    return;
                }

                if (action === "copy-link") {
                    if (!item.url) return;
                    const helper = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                        .getService(Components.interfaces.nsIClipboardHelper);
                    helper.copyString(item.url);
                    return;
                }

                if (action === "pause") {
                    if (item.raw?.cancel) Promise.resolve(item.raw.cancel()).catch(() => { });
                    setTimeout(() => this.sync(), 150);
                    return;
                }

                if (action === "resume") {
                    if (item.raw?.start) Promise.resolve(item.raw.start()).catch(() => { });
                    setTimeout(() => this.sync(), 150);
                    return;
                }

                if (action === "cancel") {
                    if (item.raw?.cancel) Promise.resolve(item.raw.cancel()).catch(() => { });
                    if (item.raw?.removePartialData) {
                        Promise.resolve(item.raw.removePartialData()).catch(() => { });
                    }
                    setTimeout(() => this.sync(), 150);
                    return;
                }

                if (!item.targetPath) return;
                const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
                file.initWithPath(item.targetPath);

                if (action === "copy-file") {
                    if (!file.exists()) {
                        Services.prompt.alert(window, "Zen Library", "That file is no longer there.");
                        return;
                    }

                    const transferable = Components.classes["@mozilla.org/widget/transferable;1"]
                        .createInstance(Components.interfaces.nsITransferable);
                    transferable.init(null);
                    transferable.addDataFlavor("application/x-moz-file");
                    transferable.setTransferData("application/x-moz-file", file);

                    const fileUrl = Services.io.newFileURI(file).spec;
                    const urlData = Components.classes["@mozilla.org/supports-string;1"]
                        .createInstance(Components.interfaces.nsISupportsString);
                    urlData.data = `${fileUrl}\n${item.filename || file.leafName}`;
                    transferable.addDataFlavor("text/x-moz-url");
                    transferable.setTransferData("text/x-moz-url", urlData);

                    const clipboard = Components.classes["@mozilla.org/widget/clipboard;1"]
                        .getService(Components.interfaces.nsIClipboard);
                    clipboard.setData(transferable, null, Components.interfaces.nsIClipboard.kGlobalClipboard);
                } else if (action === "open-external" || action === "open") {
                    if (!file.exists()) {
                        // Services.prompt, not alert(): alert() in a chrome window blocks the
                        // whole window rather than just this dialog.
                        Services.prompt.alert(window, "Zen Library", "That file is no longer there.");
                        return;
                    }
                    this._launch(item, file).catch(e =>
                        console.error("ZenLibrary: could not open the download", e));
                } else if (action === "show") {
                    if (file.exists()) file.reveal();
                    else Services.prompt.alert(window, "Zen Library", "That file is no longer there.");
                }
            } catch (e) {
                console.error("ZenLibrary: Download action failed", e);
            }
        }

        removeDownloadRow(item, itemEl) {
            this._cachedDownloads = this._cachedDownloads?.filter(d => d.id !== item.id) ?? null;

            itemEl.style.transition = "opacity 0.15s, transform 0.15s";
            itemEl.style.opacity = "0";
            itemEl.style.transform = "translateX(-8px)";

            setTimeout(() => {
                let section = itemEl.previousElementSibling;
                while (section && !section.classList?.contains("history-section-header")) {
                    section = section.previousElementSibling;
                }

                itemEl.remove();

                let hasSectionRows = false;
                let next = section?.nextElementSibling;
                while (next && !next.classList?.contains("history-section-header")) {
                    if (next.matches?.("zen-library-item, .library-download-progress-item")) {
                        hasSectionRows = true;
                        break;
                    }
                    next = next.nextElementSibling;
                }

                if (section && !hasSectionRows) {
                    section.remove();
                }
            }, 160);
        }

        // [audit] LEAK-2 — scheduleProgressRefresh arms a 1s timer that re-fetches and
        // re-renders while a download is in flight, and it re-arms itself from renderList.
        // Nothing cleared it, so a window closed mid-download left the chain running against
        // a detached container.
        destroy() {
            if (this._progressTimer) {
                clearTimeout(this._progressTimer);
                this._progressTimer = null;
            }
            this._cachedDownloads = null;
            this._clearFolderScanCache();
            this._renderToken++;
            try {
                Services.prefs.removeObserver("zen.library.downloads.scan-folder", this._downloadsScanPrefObserver);
            } catch (e) { }
            this._disconnectMoreObserver();
            this._progressRows = null;
            this._container = null;
        }

        _ensureContextMenu() {
            if (document.getElementById("zen-downloads-context-menu")) return;
            const popup = document.createXULElement("menupopup");
            popup.id = "zen-downloads-context-menu";

            // [audit] SEC-1 — an explicit "Open file" entry, so opening a download is
            // reachable as a deliberate act and not only as a side effect of clicking a row.
            const openFileItem = document.createXULElement("menuitem");
            openFileItem.id = "zen-downloads-ctx-open-file";
            openFileItem.setAttribute("label", "Open");

            const showItem = document.createXULElement("menuitem");
            showItem.id = "zen-downloads-ctx-show";
            showItem.setAttribute("label", "Show in Folder");

            const copyFileItem = document.createXULElement("menuitem");
            copyFileItem.id = "zen-downloads-ctx-copy-file";
            copyFileItem.setAttribute("label", "Copy file");

            const openLinkItem = document.createXULElement("menuitem");
            openLinkItem.id = "zen-downloads-ctx-open-link";
            openLinkItem.setAttribute("label", "Open Download Link");

            const copyLinkItem = document.createXULElement("menuitem");
            copyLinkItem.id = "zen-downloads-ctx-copy-link";
            copyLinkItem.setAttribute("label", "Copy link");

            const pauseItem = document.createXULElement("menuitem");
            pauseItem.id = "zen-downloads-ctx-pause";
            pauseItem.setAttribute("label", "Pause");

            const renameItem = document.createXULElement("menuitem");
            renameItem.id = "zen-downloads-ctx-rename";
            renameItem.setAttribute("label", "Rename file");

            const deleteItem = document.createXULElement("menuitem");
            deleteItem.id = "zen-downloads-ctx-delete";
            deleteItem.setAttribute("label", "Hide");

            const deleteFileItem = document.createXULElement("menuitem");
            deleteFileItem.id = "zen-downloads-ctx-delete-file";
            deleteFileItem.setAttribute("label", "Trash");

            popup.appendChild(openFileItem);
            popup.appendChild(showItem);
            popup.appendChild(copyFileItem);
            popup.appendChild(openLinkItem);
            popup.appendChild(copyLinkItem);
            popup.appendChild(pauseItem);
            popup.appendChild(document.createXULElement("menuseparator"));
            popup.appendChild(renameItem);
            popup.appendChild(document.createXULElement("menuseparator"));
            popup.appendChild(deleteFileItem);
            popup.appendChild(deleteItem);
            (document.getElementById("mainPopupSet") || document.body).appendChild(popup);
        }

        _showContextMenu(e, item, itemEl, anchor = null) {
            this._ensureContextMenu();
            const popup = document.getElementById("zen-downloads-context-menu");

            for (const id of ["zen-downloads-ctx-open-file", "zen-downloads-ctx-show", "zen-downloads-ctx-copy-file", "zen-downloads-ctx-open-link", "zen-downloads-ctx-copy-link", "zen-downloads-ctx-pause", "zen-downloads-ctx-rename", "zen-downloads-ctx-delete-file", "zen-downloads-ctx-delete"]) {
                const el = document.getElementById(id);
                if (el) el.replaceWith(el.cloneNode(true));
            }

            const openFileItem = document.getElementById("zen-downloads-ctx-open-file");
            openFileItem.hidden = !item.targetPath || item.status === "deleted";
            openFileItem.setAttribute("label", item.isFolder ? "Open folder" : "Open");
            openFileItem.addEventListener("command", () => {
                this.handleAction(item, "open");
            });

            const showItem = document.getElementById("zen-downloads-ctx-show");
            showItem.hidden = !item.targetPath || item.status === "deleted";
            showItem.addEventListener("command", () => {
                this.handleAction(item, "show");
            });

            const copyFileItem = document.getElementById("zen-downloads-ctx-copy-file");
            copyFileItem.hidden = !item.targetPath || item.status === "deleted" || item.isFolder;
            copyFileItem.addEventListener("command", () => {
                this.handleAction(item, "copy-file");
            });

            const openLinkItem = document.getElementById("zen-downloads-ctx-open-link");
            openLinkItem.hidden = !item.url || item.scannedFromFolder;
            openLinkItem.addEventListener("command", () => {
                this.handleAction(item, "open-link");
            });

            const copyLinkItem = document.getElementById("zen-downloads-ctx-copy-link");
            copyLinkItem.hidden = !item.url || item.scannedFromFolder;
            copyLinkItem.addEventListener("command", () => {
                this.handleAction(item, "copy-link");
            });

            const pauseItem = document.getElementById("zen-downloads-ctx-pause");
            const canPauseOrResume = item.status === "downloading" || item.status === "paused";
            pauseItem.hidden = !canPauseOrResume;
            pauseItem.setAttribute("label", item.status === "paused" ? "Resume" : "Pause");
            pauseItem.addEventListener("command", () => {
                this.handleAction(item, item.status === "paused" ? "resume" : "pause");
            });

            const renameItem = document.getElementById("zen-downloads-ctx-rename");
            renameItem.hidden = !!item.isFolder;
            renameItem.addEventListener("command", () => {
                if (!item.targetPath || item.status === "deleted") return;
                const input = { value: item.filename };
                const ok = Services.prompt.prompt(window, "Rename File", null, input, null, { value: false });
                if (!ok || !input.value.trim() || input.value.trim() === item.filename) return;
                try {
                    const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
                    file.initWithPath(item.targetPath);
                    if (!file.exists()) return;
                    const newName = input.value.trim();
                    const oldPath = file.path;
                    // moveTo() repoints the nsIFile at its new location, so this is the
                    // real path without hand-assembling one around a "\" separator.
                    file.moveTo(file.parent, newName);
                    const newPath = file.path;
                    this._renamedTargets.set(this.normalizeDownloadPath(oldPath), newPath);
                    item.filename = newName;
                    item.targetPath = newPath;
                    itemEl.setAttribute("title", newName);
                    if (this._cachedDownloads) {
                        const cached = this._cachedDownloads.find(d => d.id === item.id);
                        if (cached) {
                            cached.filename = newName;
                            cached.targetPath = newPath;
                            cached.status = cached.status === "deleted" ? "completed" : cached.status;
                        }
                    }
                } catch (err) {
                    console.error("[ZenLibrary Downloads] Rename failed:", err);
                }
            });

            const deleteFileItem = document.getElementById("zen-downloads-ctx-delete-file");
            deleteFileItem.hidden = !item.targetPath || item.status === "deleted" || item.isFolder;
            deleteFileItem.addEventListener("command", async () => {
                const confirmed = Services.prompt.confirm(
                    window,
                    "Delete File",
                    `Are you sure you want to permanently delete "${item.filename}"?\n\nThis action cannot be undone.`
                );
                if (!confirmed) return;

                try {
                    // IOUtils, not nsIFile: exists()/remove() are synchronous main-thread I/O
                    // and hang the whole browser on a slow or disconnected network drive.
                    if (!(await IOUtils.exists(item.targetPath))) {
                        Services.prompt.alert(window, "Zen Library", "That file is no longer there.");
                        return;
                    }

                    await IOUtils.remove(item.targetPath);

                    try {
                        const { DownloadHistory } = ChromeUtils.importESModule("resource://gre/modules/DownloadHistory.sys.mjs");
                        const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
                        const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
                        const isPrivate = PrivateBrowsingUtils.isContentWindowPrivate(window);
                        const list = await DownloadHistory.getList({ type: isPrivate ? Downloads.ALL : Downloads.PUBLIC });
                        await list.remove(item.historyRaw || item.raw);
                    } catch (historyErr) {
                        console.warn("[ZenLibrary Downloads] Deleted file but could not remove history entry:", historyErr);
                    }

                    this.removeDownloadRow(item, itemEl);
                } catch (err) {
                    console.error("[ZenLibrary Downloads] Delete file failed:", err);
                    Services.prompt.alert(window, "Zen Library", "Could not delete that file.");
                }
            });

            const deleteHistoryItem = document.getElementById("zen-downloads-ctx-delete");
            deleteHistoryItem.hidden = item.scannedFromFolder || (!item.historyRaw && !item.raw);
            deleteHistoryItem.addEventListener("command", async () => {
                try {
                    const { DownloadHistory } = ChromeUtils.importESModule("resource://gre/modules/DownloadHistory.sys.mjs");
                    const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
                    const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
                    const isPrivate = PrivateBrowsingUtils.isContentWindowPrivate(window);
                    const list = await DownloadHistory.getList({ type: isPrivate ? Downloads.ALL : Downloads.PUBLIC });
                    await list.remove(item.historyRaw || item.raw);
                    this.removeDownloadRow(item, itemEl);
                } catch (err) {
                    console.error("[ZenLibrary Downloads] Delete failed:", err);
                }
            });

            itemEl?.toggleAttribute?.("menu-open", true);
            popup.addEventListener("popuphidden", () => {
                itemEl?.removeAttribute?.("menu-open");
            }, { once: true });

            if (anchor) {
                popup.openPopup(anchor, "after_end", 0, 4, false, false, e);
            } else {
                popup.openPopupAtScreen(e.screenX, e.screenY, true);
            }
        }

        formatDisplayUrl(url) {
            if (!url) return "";
            try {
                const parsed = new URL(url);
                const host = parsed.hostname.replace(/^www\./, "");
                const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
                return `${host}${path}`;
            } catch (e) {
                return String(url);
            }
        }

        formatBytes(bytes, decimals = 2) {
            if (!+bytes || bytes === 0) return "0 Bytes";
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
        }

        formatDuration(seconds) {
            if (!Number.isFinite(seconds) || seconds <= 0) return "Calculating";
            if (seconds < 60) return `${seconds}s left`;
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            if (minutes < 60) return `${minutes}m ${remainingSeconds}s left`;
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return `${hours}h ${remainingMinutes}m left`;
        }

        getContentTypeFromFilename(filename) {
            if (!filename) return 'application/octet-stream';

            const ext = filename.toLowerCase().split('.').pop();
            const mimeTypes = {
                // Images
                'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
                'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
                'svg': 'image/svg+xml', 'ico': 'image/x-icon',

                // Documents
                'pdf': 'application/pdf', 'doc': 'application/msword',
                'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'xls': 'application/vnd.ms-excel',
                'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'ppt': 'application/vnd.ms-powerpoint',
                'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

                // Text
                'txt': 'text/plain', 'html': 'text/html', 'css': 'text/css',
                'js': 'text/javascript', 'json': 'application/json',
                'xml': 'text/xml', 'csv': 'text/csv',

                // Audio
                'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
                'flac': 'audio/flac', 'aac': 'audio/aac', 'm4a': 'audio/mp4',

                // Video
                'mp4': 'video/mp4', 'avi': 'video/x-msvideo', 'mov': 'video/quicktime',
                'wmv': 'video/x-ms-wmv', 'flv': 'video/x-flv', 'webm': 'video/webm',
                'mkv': 'video/x-matroska',

                // Archives
                'zip': 'application/zip', 'rar': 'application/x-rar-compressed',
                '7z': 'application/x-7z-compressed', 'tar': 'application/x-tar',
                'gz': 'application/gzip',

                // Executables
                'exe': 'application/x-msdownload', 'msi': 'application/x-msi',
                'deb': 'application/x-debian-package', 'rpm': 'application/x-rpm'
            };

            return mimeTypes[ext] || 'application/octet-stream';
        }
    }

    window.ZenLibraryDownloads = ZenLibraryDownloads;
})();
