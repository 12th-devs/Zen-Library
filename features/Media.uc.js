"use strict";

(function () {
    // Window-capture types armed for the duration of a media-card drag, listed once so arm and
    // disarm cannot drift apart and leave a listener behind.
    const DRAG_CANCEL_EVENTS = ["drag", "dragover", "drop", "contextmenu", "pointerdown"];
    // How long a cancelled drag keeps vetoing drops, and how long the platform context menu
    // stays suppressed after that cancel. Both bound the blast radius if dragend never arrives.
    const DRAG_CANCEL_GRACE_MS = 500;

    class ZenLibraryMedia {
        // [audit] PERF-1 — hoisted to statics. These three lists were declared as locals in
        // both fetchDownloads() and renderList(), which meant six array literals rebuilt on
        // every render and two copies that could drift apart.
        static IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "ico", "bmp", "tiff", "tif", "heic", "heif"];
        static VIDEO_EXTS = ["mp4", "webm", "mkv", "avi", "mov", "m4v", "3gp", "mpg", "mpeg", "flv", "ts", "ogv", "wmv"];
        static AUDIO_EXTS = ["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus", "m4b", "m4p", "wma", "alac", "amr", "aiff", "aif", "caf", "oga", "spx", "mid", "midi"];
        static INITIAL_RENDER_LIMIT = 36;
        static RENDER_BATCH_SIZE = 36;

        constructor(library) {
            this.library = library;
            this._container = null;
            this._searchTerm = "";
            this._filter = "all"; // all, images, videos, audio
            this._itemCount = 0;
            this._currentAudio = null;
            this._playingId = null;
            this._playingCard = null;
            this._durations = new Map();
            this._coverCache = new Map();
            this._fileCache = new Map(); // Cache for Gecko File objects

            // [audit] PERF-1 — the scan cache. See fetchDownloads().
            this._scanCache = null;
            this._scanAt = 0;
            this._scanPromise = null;
            this._renderToken = 0;
            this._visibleLimit = ZenLibraryMedia.INITIAL_RENDER_LIMIT;
            this._previewObserver = null;
            this._moreObserver = null;

            // [audit] LEAK-1 — every blob: URL this module hands out is recorded here so
            // destroy() can revoke it. Previously nothing was ever revoked and there was no
            // destroy() at all, so cover art accumulated for the lifetime of the window.
            this._objectUrls = new Set();

            this._dragCancelArmed = false;
            this._dragWasCancelled = false;
            this._dragCancelledAt = 0;
            this._onDragCancelEvent = this._onDragCancelEvent.bind(this);
            this._onSuppressContextMenu = this._onSuppressContextMenu.bind(this);
            this._contextMenuSuppressArmed = false;
            this._contextMenuSuppressTimer = null;
            this._suppressContextMenuUntil = 0;
            this._suppressBrowser = null;
        }

        // [audit] LEAK-1 — one place that mints blob URLs, so one place has to remember them.
        _objectUrl(blob) {
            const url = URL.createObjectURL(blob);
            this._objectUrls.add(url);
            return url;
        }

        async copyFile(item) {
            try {
                if (!item.file || !item.file.exists()) return;

                const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
                transferable.init(null);

                // Add the file flavor
                transferable.addDataFlavor("application/x-moz-file");
                transferable.setTransferData("application/x-moz-file", item.file);

                // Also add as URL and text for compatibility
                transferable.addDataFlavor("text/x-moz-url");
                const urlString = item.url + "\n" + item.filename;
                const urlData = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
                urlData.data = urlString;
                transferable.setTransferData("text/x-moz-url", urlData);

                const clipboard = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
                clipboard.setData(transferable, null, Ci.nsIClipboard.kGlobalClipboard);

                console.log("[MEDIA] File copied to clipboard:", item.filename);
            } catch (err) {
                console.error("[MEDIA] Failed to copy file:", err);
            }
        }

        get el() { return this.library.el.bind(this.library); }

        renderFilterBar() {
            const filterBar = this.el("div", { className: "media-filter-bar" });
            const filters = [
                { id: "all", label: "All", iconClass: "icon-all" },
                { id: "images", label: "Images", iconClass: "icon-images" },
                { id: "videos", label: "Videos", iconClass: "icon-videos" },
                { id: "audio", label: "Audio", iconClass: "icon-audio" }
            ];

            filters.forEach(f => {
                const pill = this.el("div", {
                    className: `media-filter-pill ${this._filter === f.id ? 'active' : ''}`,
                    title: f.label,
                    dataset: { filter: f.id },
                    onclick: () => {
                        if (this._filter === f.id) return;
                        this._filter = f.id;
                        this._visibleLimit = ZenLibraryMedia.INITIAL_RENDER_LIMIT;
                        filterBar.querySelectorAll(".media-filter-pill").forEach(p => p.classList.remove("active"));
                        pill.classList.add("active");
                        this._stopCurrentAudio(); // STOP ON FILTER CHANGE
                        // No entrance fade: a filter swap is an in-place re-render, same as search.
                        const container = this._container;
                        const token = ++this._renderToken;
                        const cached = this._scanCache;
                        if (cached) {
                            this.renderList(cached);
                            return;
                        }
                        this.fetchDownloads().then(downloads => {
                            if (!this._canRender(token, container)) return;
                            this.renderList(downloads);
                        });
                    }
                }, [
                    this.el("div", { className: `icon-mask ${f.iconClass}` })
                ]);
                filterBar.appendChild(pill);
            });
            return filterBar;
        }

        render() {
            // Main wrapper
            const wrapper = this.el("div", {
                className: "library-list-wrapper"
            });

            const container = this.el("div", { className: "media-grid" });
            wrapper.appendChild(container);
            this._container = container;
            this.library._mediaContainer = container; // Keep ref
            const token = ++this._renderToken;
            // Modules outlive a close/open cycle, so a limit paged up in a previous
            // session would otherwise render every card the user ever scrolled to.
            this._visibleLimit = ZenLibraryMedia.INITIAL_RENDER_LIMIT;

            const startLoading = () => {
                this.fetchDownloads().then(downloads => {
                    if (!this._canRender(token, container)) return;
                    const l = container.querySelector(".empty-state");
                    if (l) l.remove();
                    this.renderList(downloads);
                    if (!this._canRender(token, container)) return;
                    this.library.enterContent(container);
                    setTimeout(() => {
                        if (this._canRender(token, container)) {
                            container.classList.add("scrollbar-visible");
                        }
                    }, 100);
                });
            };

            if (this._scanCache && Date.now() - this._scanAt < ZenLibraryMedia.CACHE_MS) {
                this.renderList(this._scanCache);
                this.library.enterContent(container);
                container.classList.add("scrollbar-visible");
                return wrapper;
            }

            const loading = this.el("div", { className: "empty-state" });
            this.library.enterContent(loading);

            // Use correct Media Icon SVG (Film Strip)
            const iconSvg = `<svg class="empty-icon media-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3L8 8M16 3L15 8M22 8H2M6.8 21H17.2C18.8802 21 19.7202 21 20.362 20.673C20.9265 20.3854 21.3854 19.9265 21.673 19.362C22 18.7202 22 17.8802 22 16.2V7.8C22 6.11984 22 5.27976 21.673 4.63803C21.3854 4.07354 20.9265 3.6146 20.362 3.32698C19.7202 3 18.8802 3 17.2 3H6.8C5.11984 3 4.27976 3 3.63803 3.32698C3.07354 3.6146 2.6146 4.07354 2.32698 4.63803C2 5.27976 2 6.11984 2 7.8V16.2C2 17.8802 2 18.7202 2.32698 19.362C2.6146 19.9265 3.07354 20.3854 3.63803 20.673C4.27976 21 5.11984 21 6.8 21Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            const iconContainer = this.el("div", {
                innerHTML: iconSvg
            });
            loading.appendChild(iconContainer.firstElementChild);

            loading.appendChild(this.el("h3", { textContent: "Gathering media..." }));
            loading.appendChild(this.el("p", { textContent: "Looking for your downloaded images and videos." }));

            container.appendChild(loading);
            startLoading();

            return wrapper;
        }

        _canRender(token, container) {
            return token === this._renderToken &&
                this._container === container &&
                this.library?.activeTab === "media" &&
                container?.isConnected;
        }

        // [audit] SEC-4 — the MIME type is parsed out of the file's own metadata, so it is
        // attacker-controlled for any file the user downloaded. It ends up as a Blob type
        // behind a blob: URL created in privileged chrome. The URL only ever reaches an
        // <img src>, so this is contained today — but there is no reason to mint a
        // chrome-origin blob: URL claiming to be text/html or image/svg+xml on the strength
        // of four bytes in an ID3 frame.
        static COVER_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

        _coverMime(raw) {
            const mime = String(raw || "").trim().toLowerCase();
            if (ZenLibraryMedia.COVER_MIME_TYPES.has(mime)) return mime;
            // ID3v2.2 uses a three-character format code ("JPG"/"PNG") rather than a MIME type.
            if (mime === "jpg" || mime === "jpeg") return "image/jpeg";
            if (mime === "png") return "image/png";
            return "image/jpeg";
        }

        async _extractCover(file) {
            try {
                // [audit] PERF-2 — was nsIFileInputStream + nsIBinaryInputStream.readByteArray,
                // a blocking 2 MB main-thread read per audio file. IOUtils.read does the same
                // work off-thread.
                //
                // Read the first 2MB to be safe for MP4/FLAC metadata.
                const bytes = await IOUtils.read(file.path, { maxBytes: 2048 * 1024 });
                if (!bytes || bytes.length < 16) return null;

                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

                // 1. ID3v2 (MP3/WAV)
                if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
                    const version = view.getUint8(3);
                    let offset = 10;
                    const tagSize = ((view.getUint8(6) & 0x7f) << 21) | ((view.getUint8(7) & 0x7f) << 14) | ((view.getUint8(8) & 0x7f) << 7) | (view.getUint8(9) & 0x7f);

                    while (offset < tagSize && offset < bytes.length - 10) {
                        const frameId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
                        let frameSize;
                        if (version === 3) {
                            frameSize = view.getUint32(offset + 4);
                        } else if (version === 4) {
                            frameSize = ((view.getUint8(offset + 4) & 0x7f) << 21) | ((view.getUint8(offset + 5) & 0x7f) << 14) | ((view.getUint8(offset + 6) & 0x7f) << 7) | (view.getUint8(offset + 7) & 0x7f);
                        } else break;

                        if (frameId === "APIC") {
                            let innerOffset = offset + 10;
                            const encoding = view.getUint8(innerOffset++);
                            let mimeType = "";
                            while (innerOffset < bytes.length && view.getUint8(innerOffset) !== 0) {
                                mimeType += String.fromCharCode(view.getUint8(innerOffset++));
                            }
                            innerOffset++;
                            const picType = view.getUint8(innerOffset++);
                            if (encoding === 0 || encoding === 3) {
                                while (innerOffset < bytes.length && view.getUint8(innerOffset) !== 0) innerOffset++;
                                innerOffset++;
                            } else {
                                while (innerOffset < bytes.length - 1 && view.getUint16(innerOffset) !== 0) innerOffset += 2;
                                innerOffset += 2;
                            }
                            if (innerOffset >= bytes.length) return null;
                            const dataSize = (offset + 10 + frameSize) - innerOffset;
                            if (dataSize <= 0) return null;
                            const data = bytes.slice(innerOffset, innerOffset + dataSize);
                            return this._objectUrl(new Blob([data], { type: this._coverMime(mimeType) }));
                        }
                        if (frameSize <= 0) break;
                        offset += 10 + frameSize;
                    }
                }

                // 2. FLAC
                if (view.getUint8(0) === 0x66 && view.getUint8(1) === 0x4c && view.getUint8(2) === 0x61 && view.getUint8(3) === 0x43) {
                    let offset = 4;
                    let isLastBlock = false;
                    while (!isLastBlock && offset < bytes.length - 4) {
                        const header = view.getUint8(offset);
                        isLastBlock = (header & 0x80) !== 0;
                        const blockType = header & 0x7f;
                        const blockSize = (view.getUint8(offset + 1) << 16) | (view.getUint8(offset + 2) << 8) | view.getUint8(offset + 3);
                        if (blockType === 6) { // PICTURE
                            let pOffset = offset + 4;
                            pOffset += 4; // Skip type
                            const mimeLen = view.getUint32(pOffset); pOffset += 4;
                            let mimeType = "";
                            for (let i = 0; i < mimeLen; i++) mimeType += String.fromCharCode(view.getUint8(pOffset++));
                            const descLen = view.getUint32(pOffset); pOffset += 4;
                            pOffset += descLen + 16; // Skip desc, w, h, d, c
                            const dataLen = view.getUint32(pOffset); pOffset += 4;
                            if (pOffset + dataLen <= bytes.length) {
                                return this._objectUrl(new Blob(
                                    [bytes.slice(pOffset, pOffset + dataLen)],
                                    { type: this._coverMime(mimeType) }
                                ));
                            }
                        }
                        offset += 4 + blockSize;
                    }
                }

                // 3. MP4 (M4A/ALAC/MOV)
                // Search for 'covr' inside 'ilst'
                const findAtom = (start, end, target) => {
                    let i = start;
                    while (i < end - 8) {
                        const size = view.getUint32(i);
                        const type = String.fromCharCode(view.getUint8(i + 4), view.getUint8(i + 5), view.getUint8(i + 6), view.getUint8(i + 7));
                        // [audit] A size below the 8-byte atom header is malformed. It used
                        // to only break on exactly 0, so sizes 1-7 walked the whole buffer a
                        // byte or two at a time before giving up.
                        if (size < 8) break;
                        if (type === target) return { start: i + 8, end: i + size };
                        i += size;
                    }
                    return null;
                };

                const ftyp = findAtom(0, bytes.length, "ftyp");
                if (ftyp) {
                    const moov = findAtom(0, bytes.length, "moov");
                    if (moov) {
                        const udta = findAtom(moov.start, moov.end, "udta");
                        if (udta) {
                            const meta = findAtom(udta.start, udta.end, "meta");
                            if (meta) {
                                const ilst = findAtom(meta.start + 4, meta.end, "ilst"); // Skip 4 bytes for meta flag
                                if (ilst) {
                                    const covr = findAtom(ilst.start, ilst.end, "covr");
                                    if (covr) {
                                        const data = findAtom(covr.start, covr.end, "data");
                                        if (data) {
                                            // MP4 'data' atom: 8 bytes header, 4 bytes version/flag (skipped by findAtom), 4 bytes reserved
                                            // Actually findAtom moves to start of inner content.
                                            // The content of 'data' atom starts with 8 bytes: 4 flags + 4 empty
                                            const pOffset = data.start + 8;
                                            const dataLen = (data.end - data.start) - 8;
                                            if (pOffset + dataLen <= bytes.length) {
                                                return this._objectUrl(new Blob(
                                                    [bytes.slice(pOffset, pOffset + dataLen)],
                                                    { type: "image/jpeg" }
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) { }
            return null;
        }

        // [audit] PERF-1 — this was a fully synchronous recursive nsIFile walk
        // (directoryEntries / isDirectory / fileSize / lastModifiedTime are all blocking
        // main-thread I/O), and it was called straight from the search box's oninput and
        // from every filter-pill click. On a large Downloads folder that stalled the entire
        // browser UI once per keystroke.
        //
        // Three changes, in order of how much they matter:
        //   1. IOUtils.getChildren / IOUtils.stat instead — genuinely off-thread.
        //   2. A short-lived cache, so repeated calls within CACHE_MS reuse the last scan.
        //      Searching and filtering are pure functions of an already-fetched list; they
        //      have no business touching the disk at all. See renderList's callers.
        //   3. File.createFromNsIFile is no longer called for every file up front. It was
        //      building a Gecko File object for every media file in Downloads on every
        //      scan, purely so that a drag *might* be instant. It is now created on demand
        //      in the dragstart handler, which is early enough.
        // A newly downloaded file should still show up promptly, so this stays short.
        static CACHE_MS = 15000;

        async fetchDownloads({ force = false } = {}) {
            if (!force && this._scanCache && Date.now() - this._scanAt < ZenLibraryMedia.CACHE_MS) {
                return this._scanCache;
            }
            // Collapse concurrent callers onto one scan rather than starting several.
            if (this._scanPromise) return this._scanPromise;

            this._scanPromise = this._scan()
                .then(files => {
                    this._scanCache = files;
                    this._scanAt = Date.now();
                    return files;
                })
                .catch(e => {
                    console.error("ZenLibrary: Error scanning downloads", e);
                    return this._scanCache || [];
                })
                .finally(() => { this._scanPromise = null; });

            return this._scanPromise;
        }

        async _scan() {
            const getDir = (key) => {
                try {
                    return Services.dirsvc.get(key, Ci.nsIFile);
                } catch (e) { return null; }
            };

            let downloadsDir = getDir("Dwnld"); // OS Downloads
            if (!downloadsDir) {
                const home = getDir("Home");
                if (home) {
                    downloadsDir = home.clone();
                    downloadsDir.append("Downloads");
                }
            }
            if (!downloadsDir) {
                console.error("ZenLibrary: Could not find Downloads directory");
                return [];
            }

            const root = downloadsDir.path;
            if (!(await IOUtils.exists(root))) {
                console.error("ZenLibrary: Downloads directory does not exist:", root);
                return [];
            }

            const IMAGE_EXTS = ZenLibraryMedia.IMAGE_EXTS;
            const VIDEO_EXTS = ZenLibraryMedia.VIDEO_EXTS;
            const AUDIO_EXTS = ZenLibraryMedia.AUDIO_EXTS;

            const mediaFiles = [];
            // Breadth-first with an explicit queue rather than recursion, so the depth cap
            // is a property of the traversal instead of the call stack, and so a directory
            // that fails to read cannot abandon its siblings.
            let level = [root];
            for (let depth = 0; depth <= 3 && level.length; depth++) {
                const next = [];
                for (const dir of level) {
                    let children;
                    try {
                        children = await IOUtils.getChildren(dir);
                    } catch (e) {
                        continue;
                    }

                    const inspectChild = async (path) => {
                        const name = PathUtils.filename(path);
                        if (name.startsWith(".")) return null;

                        let info;
                        try {
                            info = await IOUtils.stat(path);
                        } catch (e) {
                            return null;
                        }

                        if (info.type === "directory") {
                            next.push(path);
                            return null;
                        }

                        const ext = name.split(".").pop().toLowerCase();
                        let contentType = "";
                        if (IMAGE_EXTS.includes(ext)) contentType = "image/" + (ext === "jpg" ? "jpeg" : ext);
                        else if (VIDEO_EXTS.includes(ext)) contentType = "video/" + ext;
                        else if (AUDIO_EXTS.includes(ext)) contentType = "audio/" + ext;
                        else return null;

                        // nsIFile is still what the drag path and the cover reader want, but
                        // it is now built from a path already known to be a file, so none of
                        // the blocking probes above happen.
                        let file;
                        try {
                            file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
                            file.initWithPath(path);
                        } catch (e) {
                            return null;
                        }

                        const modified = info.lastModified || 0;
                        const id = `local_${path}_${modified}`;

                        // No File object is built here. The drag carries the file as an
                        // application/x-moz-file nsIFile via mozSetDataAt, which is
                        // synchronous and needs nothing warmed ahead of it — see the
                        // dragstart handler. A Gecko File is only wanted on the fallback path
                        // for a build without mozSetDataAt, and the card's pointerdown
                        // handler covers that.
                        return {
                            id,
                            filename: name,
                            size: info.size || 0,
                            status: "completed",
                            url: Services.io.newFileURI(file).spec,
                            contentType,
                            timestamp: modified,
                            targetPath: path,
                            file,
                            raw: { target: { path }, lastModified: modified }
                        };
                    };

                    // Stat in chunks rather than one Promise.all over the whole directory:
                    // a Downloads folder with thousands of files would otherwise queue that
                    // many concurrent stats at once.
                    for (let i = 0; i < children.length; i += 64) {
                        const batch = await Promise.all(children.slice(i, i + 64).map(inspectChild));
                        mediaFiles.push(...batch.filter(Boolean));
                    }
                }
                level = next;
            }

            return mediaFiles.sort((a, b) => b.timestamp - a.timestamp);
        }

        renderList(downloads) {
            if (!this._container) return;
            // Emptying the container disconnects the drag source, and a disconnected source
            // never gets its dragend — so the arm/disarm pair has to be balanced here instead.
            this._disarmDragCancel();
            document.documentElement.removeAttribute("zen-library-dragging");
            this._disconnectLazyObservers();
            this._container.innerHTML = "";
            this._container.classList.add("scrollbar-visible");

            const { IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS } = ZenLibraryMedia;

            const mediaItems = downloads.filter(d => {
                const ext = d.filename.split('.').pop().toLowerCase();
                const contentType = (d.contentType || "").toLowerCase();

                const isImage = IMAGE_EXTS.includes(ext) || contentType.startsWith("image/");
                const isVideo = VIDEO_EXTS.includes(ext) || contentType.startsWith("video/");
                const isAudio = AUDIO_EXTS.includes(ext) || contentType.startsWith("audio/");

                if (this._filter === "images" && !isImage) return false;
                if (this._filter === "videos" && !isVideo) return false;
                if (this._filter === "audio" && !isAudio) return false;
                if (this._filter === "all" && !isImage && !isVideo && !isAudio) return false;

                if (this._searchTerm && !d.filename.toLowerCase().includes(this._searchTerm.toLowerCase())) {
                    return false;
                }
                return true;
            });

            // Update count
            const prevCount = this._itemCount;
            this._itemCount = mediaItems.length;
            window.gZenLibraryMediaCount = this._itemCount;

            if (this._itemCount !== prevCount) {
                if (this.library.update) this.library.update();
            }

            if (mediaItems.length === 0) {
                this._container.innerHTML = "";
                const emptyState = this.el("div", { className: "empty-state" });

                const iconSvg = `<svg class="empty-icon media-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3L8 8M16 3L15 8M22 8H2M6.8 21H17.2C18.8802 21 19.7202 21 20.362 20.673C20.9265 20.3854 21.3854 19.9265 21.673 19.362C22 18.7202 22 17.8802 22 16.2V7.8C22 6.11984 22 5.27976 21.673 4.63803C21.3854 4.07354 20.9265 3.6146 20.362 3.32698C19.7202 3 18.8802 3 17.2 3H6.8C5.11984 3 4.27976 3 3.63803 3.32698C3.07354 3.6146 2.6146 4.07354 2.32698 4.63803C2 5.27976 2 6.11984 2 7.8V16.2C2 17.8802 2 18.7202 2.32698 19.362C2.6146 19.9265 3.07354 20.3854 3.63803 20.673C4.27976 21 5.11984 21 6.8 21Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                const iconContainer = this.el("div");
                iconContainer.innerHTML = iconSvg;

                emptyState.appendChild(iconContainer.firstElementChild);
                emptyState.appendChild(this.el("h3", { textContent: this._searchTerm ? "No matching media" : "No media found" }));
                emptyState.appendChild(this.el("p", { textContent: this._searchTerm ? "Try a different search term." : `We couldn't find any ${this._filter !== 'all' ? this._filter : 'images, videos, or audio files'} in your downloads.` }));

                this._container.appendChild(emptyState);
                return;
            }

            // Sort by TS. The scanner also returns sorted data, but keep this here for
            // cached/renamed/deleted paths that may update the list outside a full scan.
            mediaItems.sort((a, b) => b.timestamp - a.timestamp);
            const visibleLimit = Math.min(this._visibleLimit || ZenLibraryMedia.INITIAL_RENDER_LIMIT, mediaItems.length);
            const visibleItems = mediaItems.slice(0, visibleLimit);

            const libWidth = parseFloat(this.library.style.getPropertyValue("--zen-library-width")) || 340;
            let colCount = 1;
            try {
                if (window.ZenLibrarySpacesRenderer && window.ZenLibrarySpacesRenderer.calculateMediaColumns) {
                    colCount = window.ZenLibrarySpacesRenderer.calculateMediaColumns(libWidth);
                } else if (window.ZenLibrarySpaces && window.ZenLibrarySpaces.calculateMediaColumns) {
                    colCount = window.ZenLibrarySpaces.calculateMediaColumns(libWidth);
                }
            } catch (e) { }

            const masonryWrapper = this.el("div", {
                className: "media-masonry-wrapper"
            });
            const grid = this._container;
            grid.innerHTML = "";
            grid.appendChild(masonryWrapper);

            // Create columns
            const columns = [];
            for (let i = 0; i < colCount; i++) {
                const col = this.el("div", { className: "media-masonry-column" });
                masonryWrapper.appendChild(col);
                columns.push(col);
            }

            // Smooth vertical scrolling
            grid.onwheel = (e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    if (e.deltaMode === 1) {
                        grid.scrollBy({ top: e.deltaY * 37.5, behavior: "smooth" });
                    } else {
                        grid.scrollTop += e.deltaY * 2.5;
                    }
                }
            };

            visibleItems.forEach((item, index) => {
                const ext = item.filename.split('.').pop().toLowerCase();
                const contentType = item.contentType.toLowerCase();
                const isVideo = VIDEO_EXTS.includes(ext) || contentType.startsWith("video/");
                const isAudio = AUDIO_EXTS.includes(ext) || contentType.startsWith("audio/");
                const isGif = ext === "gif" || contentType === "image/gif";
                const fileUrl = item.url;

                const card = this.el("div", {
                    className: `media-card ${isAudio && this._playingId === item.id ? 'playing' : ''}`,
                    dataset: { id: item.id },
                    draggable: true,
                    // A drag always begins with a press, and a press is followed by movement
                    // before dragstart fires. That gap is enough for File.createFromNsIFile
                    // to land, so this covers the one case the scan's warming cannot: a card
                    // dragged before the warming promise for it has resolved.
                    onpointerdown: () => {
                        if (this._fileCache.has(item.id) || !item.file) return;
                        File.createFromNsIFile(item.file)
                            .then(f => this._fileCache.set(item.id, f))
                            .catch(() => { });
                    },
                    ondragstart: (e) => {
                        // Reset webview position during drag
                        document.documentElement.setAttribute("zen-library-dragging", "true");
                        this._armDragCancel();

                        try {
                            if (!item.file || !item.file.exists()) return;

                            const dataTransfer = e.dataTransfer;
                            dataTransfer.effectAllowed = "all";

                            // Create a styled drag ghost image
                            const ghost = document.createElement("div");
                            ghost.style.cssText = `
                                position: fixed; top: -1000px; left: -1000px;
                                width: 160px; background: #1e1e23; border-radius: 12px;
                                overflow: hidden; z-index: 999999; pointer-events: none;
                                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08);
                            `;

                            const previewWrap = document.createElement("div");
                            previewWrap.style.cssText = `
                                width: 100%; height: 100px; overflow: hidden;
                                display: flex; align-items: center; justify-content: center;
                                background: rgba(255, 255, 255, 0.03);
                            `;

                            if (!isAudio && !isVideo) {
                                const thumb = document.createElement("img");
                                thumb.src = fileUrl;
                                thumb.style.cssText = `width: 100%; height: 100%; object-fit: cover;`;
                                previewWrap.appendChild(thumb);
                            } else {
                                const iconBox = document.createElement("div");
                                iconBox.style.cssText = `
                                    width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;
                                    background: linear-gradient(135deg, ${isAudio ? '#667eea 0%, #764ba2 100%' : '#1a1a1a 0%, #333 100%'});
                                    border-radius: 14px; border: 2px solid rgba(255,255,255,0.1);
                                    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
                                `;
                                if (isVideo) {
                                    previewWrap.style.background = "repeating-linear-gradient(-45deg, #111, #111 6px, #1a1a1a 6px, #1a1a1a 12px)";
                                    iconBox.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 5V19L19 12L8 5Z" fill="white"/></svg>`;
                                } else {
                                    iconBox.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
                                }
                                previewWrap.appendChild(iconBox);
                            }
                            ghost.appendChild(previewWrap);

                            const infoBox = document.createElement("div");
                            infoBox.style.cssText = `padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; border-top: 1px solid rgba(255,255,255,0.05);`;
                            const titleEl = document.createElement("div");
                            titleEl.textContent = item.filename;
                            titleEl.style.cssText = `font-size: 11px; color: rgba(255,255,255,0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600;`;
                            const metaEl = document.createElement("div");
                            metaEl.textContent = this.formatBytes(item.size);
                            metaEl.style.cssText = `font-size: 9px; color: rgba(255, 255, 255, 0.4);`;
                            infoBox.appendChild(titleEl);
                            infoBox.appendChild(metaEl);
                            ghost.appendChild(infoBox);

                            document.documentElement.appendChild(ghost);
                            dataTransfer.setDragImage(ghost, 80, 50);
                            setTimeout(() => ghost.remove(), 0);

                            // Native transfer.
                            //
                            // EXACTLY ONE file flavour may be attached. dataTransfer.files is
                            // built from every application/x-moz-file item on the transfer,
                            // and zen-easel's drop handler loops over that list placing each
                            // one 24px down and right of the last — so attaching the file
                            // twice puts two overlapping copies on the board.
                            //
                            // That is not hypothetical: the original code called both
                            // setData("application/x-moz-file", item.file) and items.add(),
                            // and got away with it only because setData is specified to take
                            // a DOMString. The nsIFile was stringified into something inert,
                            // so the flavour never actually existed and items.add() was doing
                            // all the work. Switching that line to mozSetDataAt made it real,
                            // and the duplicate appeared.
                            //
                            // mozSetDataAt is preferred as the one that carries the file: it
                            // is the documented way to put a non-string on a DataTransfer, it
                            // is what the Downloads section already uses, and — unlike
                            // items.add — it is synchronous and needs no warmed File object.
                            const usedNativeFlavor = typeof dataTransfer.mozSetDataAt === "function";
                            if (usedNativeFlavor) {
                                dataTransfer.mozSetDataAt("application/x-moz-file", item.file, 0);
                            }

                            const specStr = Services.io.newFileURI(item.file).spec;
                            dataTransfer.setData("text/uri-list", specStr);
                            // The filename, as a last resort for a drop target that
                            // understands nothing else. Note that the easel treats a bare
                            // text/plain drop as "make a text object", so if this is the only
                            // flavour that survives, a dropped picture becomes its own
                            // filename on the board. That is the symptom to look for if the
                            // file flavours above ever stop arriving.
                            dataTransfer.setData("text/plain", item.filename);

                            // Fallback only, for a build with no mozSetDataAt. Never runs
                            // alongside the native flavour above — see the duplicate note
                            // there. items.add() needs a File that already exists, because
                            // dragstart is synchronous and cannot await one into being; the
                            // cache is warmed during the scan and topped up on pointerdown
                            // for exactly that reason.
                            if (!usedNativeFlavor) {
                                const cachedGeckoFile = this._fileCache.get(item.id);
                                if (cachedGeckoFile) {
                                    dataTransfer.items.add(cachedGeckoFile);
                                } else {
                                    console.warn(
                                        "[ZenLibrary Media] no File cached for", item.filename,
                                        "— this drag carries only the path flavours"
                                    );
                                    File.createFromNsIFile(item.file).then(f => {
                                        this._fileCache.set(item.id, f);
                                    }).catch(() => { });
                                }
                            }

                            e.stopPropagation();
                        } catch (err) {
                            console.error("Drag error:", err);
                        }

                        card.classList.add("dragging");
                    },
                    ondragend: (e) => {
                        document.documentElement.removeAttribute("zen-library-dragging");
                        card.classList.remove("dragging");
                        this._disarmDragCancel();
                    },
                    oncontextmenu: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (document.documentElement.hasAttribute("zen-library-dragging")) {
                            this._cancelActiveDrag();
                            return;
                        }
                        this._showContextMenu(e, item);
                    },
                    onclick: (e) => {
                        if (isAudio) {
                            this.toggleAudio(item, card);
                        } else {
                            this.showGlance(item, e);
                        }
                    },
                    title: `${item.filename}\n(Right-click for options)`
                });

                const previewContainer = this.el("div", {
                    className: isAudio ? "audio-preview-container" : "media-preview-container"
                });

                if (isVideo) {
                    const videoEl = this.el("video", {
                        preload: "metadata",
                        muted: true
                    });
                    this._observePreview(videoEl, fileUrl);
                    previewContainer.appendChild(videoEl);

                    const durationBadge = this.el("div", { className: "video-duration-badge", textContent: "..." });
                    videoEl.addEventListener("loadedmetadata", () => {
                        const mins = Math.floor(videoEl.duration / 60);
                        const secs = Math.floor(videoEl.duration % 60);
                        durationBadge.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
                    });
                    previewContainer.appendChild(durationBadge);
                } else if (isGif) {
                    const imgEl = this.el("img", {
                        loading: "lazy",
                    });
                    this._observePreview(imgEl, fileUrl);
                    previewContainer.appendChild(imgEl);
                    const gifBadge = this.el("div", { className: "gif-badge", textContent: "GIF" });
                    previewContainer.appendChild(gifBadge);
                } else if (isAudio) {
                    const audioIconContainer = this.el("div", {
                        className: "audio-preview-icon"
                    });

                    const cachedCover = this._coverCache.get(item.id);
                    if (cachedCover) {
                        audioIconContainer.appendChild(this.el("img", { src: cachedCover, className: "cover-art" }));
                    } else {
                        audioIconContainer.appendChild(this.el("div", { className: "icon-mask icon-audio placeholder-icon" }));

                        // Only try extraction if we haven't failed before (cachedCover would be null if failed)
                        if (cachedCover === undefined) {
                            const updateCover = async () => {
                                const coverUrl = await this._extractCover(item.file);
                                this._coverCache.set(item.id, coverUrl);
                                if (coverUrl) {
                                    const placeholder = audioIconContainer.querySelector(".placeholder-icon");
                                    if (placeholder) {
                                        placeholder.replaceWith(this.el("img", { src: coverUrl, className: "cover-art" }));
                                    }
                                }
                            };
                            updateCover();
                        }
                    }

                    audioIconContainer.appendChild(this.el("div", { className: "progress-bar-container" }, [
                        this.el("div", { className: "progress-bar-fill" })
                    ]));
                    audioIconContainer.appendChild(this.el("div", { className: "audio-control-overlay" }, [
                        this.el("div", { className: "icon-mask icon-play" }),
                        this.el("div", { className: "icon-mask icon-pause" })
                    ]));
                    previewContainer.appendChild(audioIconContainer);

                    const durationBadge = this.el("div", { className: "video-duration-badge", textContent: "..." });

                    const audioEl = this.el("audio", {
                        preload: "metadata",
                        style: "display: none;"
                    });
                    this._observePreview(audioEl, fileUrl);

                    audioEl.addEventListener("loadedmetadata", () => {
                        const mins = Math.floor(audioEl.duration / 60);
                        const secs = Math.floor(audioEl.duration % 60);
                        durationBadge.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
                        audioEl.remove();
                    });

                    audioEl.addEventListener("error", () => {
                        durationBadge.textContent = "";
                        audioEl.remove();
                    });

                    previewContainer.appendChild(audioEl);
                    previewContainer.appendChild(durationBadge);
                } else {
                    const imgEl = this.el("img", {
                        loading: "lazy",
                    });
                    this._observePreview(imgEl, fileUrl);
                    previewContainer.appendChild(imgEl);
                }

                card.appendChild(previewContainer);
                card.appendChild(this.el("div", {
                    className: "media-card-name",
                    textContent: item.filename
                }));

                // Distribute round-robin to columns
                columns[index % colCount].appendChild(card);
            });

            if (visibleLimit < mediaItems.length) {
                const more = this.el("div", {
                    className: "media-load-more-sentinel",
                    "aria-hidden": "true"
                });
                masonryWrapper.appendChild(more);
                this._observeMore(more, downloads);
            }
        }

        _observeMore(sentinel, downloads) {
            if (!sentinel || !this._container) return;
            this._moreObserver?.disconnect();
            this._moreObserver = new IntersectionObserver((entries) => {
                if (!entries.some(entry => entry.isIntersecting)) return;
                this._moreObserver?.disconnect();
                this._moreObserver = null;
                // renderList() empties the scroll container, which clamps scrollTop to 0
                // and would otherwise throw the user back to the top of the grid on every
                // batch. Captured here, before the wipe, and restored after it.
                const prevScroll = this._container?.scrollTop || 0;
                this._visibleLimit = (this._visibleLimit || ZenLibraryMedia.INITIAL_RENDER_LIMIT) + ZenLibraryMedia.RENDER_BATCH_SIZE;
                requestAnimationFrame(() => {
                    this.renderList(downloads);
                    if (this._container) this._container.scrollTop = prevScroll;
                });
            }, { root: this._container, rootMargin: "350px 0px" });
            this._moreObserver.observe(sentinel);
        }

        _observePreview(el, fileUrl) {
            if (!el || !fileUrl) return;
            el.dataset.src = fileUrl;
            this._previewObserver = this._previewObserver || new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const media = entry.target;
                    this._previewObserver?.unobserve(media);
                    if (media.dataset.src && !media.src) {
                        media.src = media.dataset.src;
                    }
                }
            }, { root: this._container, rootMargin: "500px 0px" });
            this._previewObserver.observe(el);
        }

        _disconnectLazyObservers() {
            if (this._previewObserver) {
                this._previewObserver.disconnect();
                this._previewObserver = null;
            }
            if (this._moreObserver) {
                this._moreObserver.disconnect();
                this._moreObserver = null;
            }
        }

        _armDragCancel() {
            // Reset before the armed-guard, never after: dragend is NOT dispatched when the
            // source node is disconnected (Firefox asserts exactly this in EventUtils.js), and
            // renderList()/close() disconnect cards routinely. Leaving a stale _dragWasCancelled
            // here made the next drag start pre-cancelled and rejected every drop window-wide.
            this._dragWasCancelled = false;
            this._dragCancelledAt = 0;
            if (this._dragCancelArmed) return;
            this._dragCancelArmed = true;
            // `drag` fires on the chrome source even when the cursor is over the
            // easel webview, which is where a right-click would otherwise be lost.
            for (const type of DRAG_CANCEL_EVENTS) {
                window.addEventListener(type, this._onDragCancelEvent, true);
            }
        }

        _disarmDragCancel() {
            this._dragWasCancelled = false;
            this._dragCancelledAt = 0;
            if (!this._dragCancelArmed) return;
            this._dragCancelArmed = false;
            for (const type of DRAG_CANCEL_EVENTS) {
                window.removeEventListener(type, this._onDragCancelEvent, true);
            }
        }

        // The cancel latch only makes sense while the session it cancelled is still winding
        // down. Bounding it means that even if dragend never arrives, the listeners degrade to
        // a cheap attribute check instead of vetoing every drop in the window forever.
        _isCancelLatchLive() {
            return this._dragWasCancelled &&
                Date.now() - this._dragCancelledAt < DRAG_CANCEL_GRACE_MS;
        }

        _armContextMenuSuppress() {
            this._suppressContextMenuUntil = Date.now() + DRAG_CANCEL_GRACE_MS;
            if (!this._contextMenuSuppressArmed) {
                this._contextMenuSuppressArmed = true;
                window.addEventListener("contextmenu", this._onSuppressContextMenu, true);
                document.addEventListener("popupshowing", this._onSuppressContextMenu, true);
                // Hold the browser we armed. Disarming off a re-read of selectedBrowser would
                // detach from whichever tab is current 500ms later and leak this listener onto
                // the original one for the life of the window.
                try {
                    this._suppressBrowser = window.gBrowser?.selectedBrowser || null;
                    this._suppressBrowser?.addEventListener("contextmenu", this._onSuppressContextMenu, true);
                } catch (_) {
                    this._suppressBrowser = null;
                }
            }
            this._hideOpenContextMenus();
            if (this._contextMenuSuppressTimer) clearTimeout(this._contextMenuSuppressTimer);
            this._contextMenuSuppressTimer = setTimeout(() => this._disarmContextMenuSuppress(), DRAG_CANCEL_GRACE_MS);
        }

        _disarmContextMenuSuppress() {
            if (this._contextMenuSuppressTimer) {
                clearTimeout(this._contextMenuSuppressTimer);
                this._contextMenuSuppressTimer = null;
            }
            if (!this._contextMenuSuppressArmed) return;
            this._contextMenuSuppressArmed = false;
            this._suppressContextMenuUntil = 0;
            window.removeEventListener("contextmenu", this._onSuppressContextMenu, true);
            document.removeEventListener("popupshowing", this._onSuppressContextMenu, true);
            try {
                this._suppressBrowser?.removeEventListener("contextmenu", this._onSuppressContextMenu, true);
            } catch (_) {}
            this._suppressBrowser = null;
        }

        _onSuppressContextMenu(e) {
            if (Date.now() > this._suppressContextMenuUntil) return;
            // Scoped to menus. An unscoped popupshowing veto also swallowed the urlbar results
            // panel, notification anchors and tooltips for the whole suppression window.
            if (e.type === "popupshowing" && e.target?.localName !== "menupopup") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.type === "popupshowing") {
                try { e.target.hidePopup?.(); } catch (_) {}
            }
            this._hideOpenContextMenus();
        }

        _hideOpenContextMenus() {
            for (const id of ["contentAreaContextMenu", "zen-media-context-menu"]) {
                try { document.getElementById(id)?.hidePopup?.(); } catch (_) {}
            }
        }

        _isEaselTab(tab) {
            try {
                const spec = (tab?.linkedBrowser?.currentURI?.spec || "").toLowerCase();
                // Anchored to the scheme on purpose. A bare `includes("zen-easel")` also matched
                // https://evil.example/zen-easel, so any page could advertise itself as a valid
                // drop target and receive the file:// path and File for a dragged media item.
                return spec.startsWith("about:easel") ||
                    spec.startsWith("chrome://sine/content/zen-easel");
            } catch (_) {
                return false;
            }
        }

        _isEmptyTab(tab) {
            if (!tab) return false;
            if (tab.hasAttribute?.("zen-empty-tab")) return true;
            try {
                const spec = (tab.linkedBrowser?.currentURI?.spec || "").toLowerCase();
                return spec === "about:blank" || spec === "about:newtab" ||
                    spec === "about:home" || spec === "about:privatebrowsing";
            } catch (_) {
                return false;
            }
        }

        _isAllowedMediaDropTab(tab) {
            return this._isEaselTab(tab) || this._isEmptyTab(tab);
        }

        _eventPath(e) {
            try {
                return e.composedPath?.() || [];
            } catch (_) {
                return [];
            }
        }

        _isTabNode(n) {
            return n.matches?.(".tabbrowser-tab") ||
                (n.localName === "tab" && n.classList?.contains("tabbrowser-tab"));
        }

        // One pass over one composedPath, classifying as it goes. This runs on every dragover,
        // which Gecko fires per mouse move — the previous shape walked the path three times and
        // then re-walked the ancestors again with closest() as a fallback that, since
        // composedPath already contains every ancestor, could not match anything new.
        _classifyDropTarget(e) {
            let tab = null;
            let overTabChrome = false;
            let overBrowser = false;

            for (const n of this._eventPath(e)) {
                if (!n || n.nodeType !== 1) continue;

                if (this._isTabNode(n)) {
                    tab = n;
                    break;
                }
                if (n.hasAttribute?.("zen-essential") ||
                    n.id === "tabbrowser-tabs" || n.id === "TabsToolbar" ||
                    n.id === "navigator-toolbox" ||
                    n.id === "vertical-pinned-tabs-container" || n.id === "pinned-tabs-container") {
                    overTabChrome = true;
                    break;
                }
                if (n.id === "tabbrowser-tabpanels" || n.id === "tabbrowser-tabbox" ||
                    n.id === "zen-tabbox-wrapper" || n.localName === "browser" ||
                    n.classList?.contains("browserSidebarContainer")) {
                    overBrowser = true;
                    break;
                }
            }

            return { tab, overTabChrome, overBrowser };
        }

        _shouldRejectMediaDrop(e) {
            const { tab, overTabChrome, overBrowser } = this._classifyDropTarget(e);
            if (tab) return !this._isAllowedMediaDropTab(tab);
            if (overTabChrome) return true;
            if (overBrowser) return !this._isAllowedMediaDropTab(window.gBrowser?.selectedTab);
            return false;
        }

        _rejectMediaDrop(e) {
            if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
            e.preventDefault();
            e.stopImmediatePropagation();
        }

        _onDragCancelEvent(e) {
            if ((e.type === "drop" || e.type === "dragover") && this._isCancelLatchLive()) {
                this._rejectMediaDrop(e);
                return;
            }
            if (!document.documentElement.hasAttribute("zen-library-dragging")) return;

            if (e.type === "dragover" && this._shouldRejectMediaDrop(e)) {
                this._rejectMediaDrop(e);
                return;
            }
            if (e.type === "drop" && this._shouldRejectMediaDrop(e)) {
                this._rejectMediaDrop(e);
                this._cancelActiveDrag();
                return;
            }

            if (e.type !== "contextmenu" && e.button !== 2 && !(e.buttons & 2)) return;
            e.preventDefault();
            e.stopPropagation();
            this._cancelActiveDrag();
        }

        _cancelActiveDrag() {
            if (this._dragWasCancelled) return;
            this._dragWasCancelled = true;
            this._dragCancelledAt = Date.now();
            // dragend runs inside endDragSession and would drop the drag listeners
            // before the easel's contextmenu arrives — keep a separate suppress.
            this._armContextMenuSuppress();
            document.documentElement.removeAttribute("zen-library-dragging");
            this._container?.querySelectorAll(".media-card.dragging").forEach(c => {
                c.classList.remove("dragging");
            });
            try {
                const dragService = Cc["@mozilla.org/widget/dragservice;1"].getService(Ci.nsIDragService);
                let session = null;
                try {
                    session = dragService.getCurrentSession(window);
                } catch (_) {
                    try { session = dragService.getCurrentSession(); } catch (_) {}
                }
                if (session) {
                    // endDragSession(false) means "left the window", not cancel — that
                    // still lets the easel receive the drop. Mark the user cancel, clear
                    // the effect, then end the session as finished.
                    //
                    // userCancelled is a boolean attribute on nsIDragSession, not a method, so
                    // the previous `typeof === "function"` guard was never true and this step
                    // silently never ran.
                    try { session.userCancelled = true; } catch (_) {}
                    try { session.canDrop = false; } catch (_) {}
                    try { session.dragAction = Ci.nsIDragService.DRAGDROP_ACTION_NONE; } catch (_) {}
                    try {
                        if (session.dataTransfer) session.dataTransfer.dropEffect = "none";
                    } catch (_) {}
                    if (typeof session.endDragSession === "function") {
                        session.endDragSession(true);
                    } else if (typeof dragService.endDragSession === "function") {
                        dragService.endDragSession(true);
                    }
                }
            } catch (err) {
                console.warn("[ZenLibrary Media] Failed to cancel drag:", err);
            }
        }

        _ensureContextMenu() {
            if (document.getElementById("zen-media-context-menu")) return;
            const popup = document.createXULElement("menupopup");
            popup.id = "zen-media-context-menu";

            const copyItem = document.createXULElement("menuitem");
            copyItem.id = "zen-media-ctx-copy";
            copyItem.setAttribute("label", "Copy file");

            const showItem = document.createXULElement("menuitem");
            showItem.id = "zen-media-ctx-show";
            showItem.setAttribute("label", "Show in folder");

            const renameItem = document.createXULElement("menuitem");
            renameItem.id = "zen-media-ctx-rename";
            renameItem.setAttribute("label", "Rename file");

            const deleteItem = document.createXULElement("menuitem");
            deleteItem.id = "zen-media-ctx-delete";
            deleteItem.setAttribute("label", "Delete file");

            popup.appendChild(copyItem);
            popup.appendChild(showItem);
            popup.appendChild(document.createXULElement("menuseparator"));
            popup.appendChild(renameItem);
            popup.appendChild(deleteItem);
            (document.getElementById("mainPopupSet") || document.body).appendChild(popup);
        }

        _showContextMenu(e, item) {
            this._ensureContextMenu();
            const popup = document.getElementById("zen-media-context-menu");

            // Clone all items to rebind listeners
            for (const id of ["zen-media-ctx-copy", "zen-media-ctx-show", "zen-media-ctx-rename", "zen-media-ctx-delete"]) {
                const el = document.getElementById(id);
                if (el) el.replaceWith(el.cloneNode(true));
            }

            document.getElementById("zen-media-ctx-copy").addEventListener("command", () => this.copyFile(item));

            document.getElementById("zen-media-ctx-show").addEventListener("command", () => {
                if (item.file && item.file.exists()) {
                    try { item.file.reveal(); } catch (_) { item.file.parent.launch(); }
                }
            });

            document.getElementById("zen-media-ctx-rename").addEventListener("command", () => {
                if (!item.file || !item.file.exists()) return;
                const input = { value: item.filename };
                const ok = Services.prompt.prompt(window, "Rename File", null, input, null, { value: false });
                if (!ok || !input.value.trim() || input.value.trim() === item.filename) return;
                try {
                    const newName = input.value.trim();
                    item.file.moveTo(item.file.parent, newName);
                    // Update card title in place
                    const card = this._container?.querySelector(`.media-card[data-id="${CSS.escape(item.id)}"]`);
                    if (card) card.querySelector(".media-title").textContent = newName;
                    item.filename = newName;
                    item.id = `local_${item.file.path}_${item.file.lastModifiedTime}`;
                } catch (err) {
                    console.error("[ZenLibrary Media] Rename failed:", err);
                }
            });

            document.getElementById("zen-media-ctx-delete").addEventListener("command", () => {
                if (!item.file) return;
                const confirmed = Services.prompt.confirm(window, "Delete File", `Delete "${item.filename}"? This cannot be undone.`);
                if (!confirmed) return;
                try {
                    if (item.file.exists()) item.file.remove(false);
                    if (this._scanCache) {
                        this._scanCache = this._scanCache.filter(d => d.id !== item.id);
                    }
                    this._itemCount = Math.max(0, (this._itemCount || 1) - 1);
                    window.gZenLibraryMediaCount = this._itemCount;
                    const card = this._container?.querySelector(`.media-card[data-id="${CSS.escape(item.id)}"]`);
                    if (!card) return;
                    const siblings = [...this._container.querySelectorAll(".media-card")].filter(n => n !== card);
                    window.ZenLibraryUtil.animateCardRemove(card, { siblings }).then(() => {
                        if (this._container?.isConnected && !this._container.querySelector(".media-card")) {
                            this.renderList(this._scanCache || []);
                        }
                    });
                } catch (err) {
                    console.error("[ZenLibrary Media] Delete failed:", err);
                }
            });

            popup.openPopupAtScreen(e.screenX, e.screenY, true);
        }

        _stopCurrentAudio() {
            if (this._currentAudio) {
                this._currentAudio.onended = null;
                this._currentAudio.onerror = null;
                this._currentAudio.pause();
                this._currentAudio.src = "";
                this._currentAudio.load();
                this._currentAudio = null;
            }
            if (this._playingId) {
                const oldCard = this._container?.querySelector(`.media-card[data-id="${CSS.escape(this._playingId)}"]`);
                if (oldCard) {
                    oldCard.classList.remove("playing");
                    const progress = oldCard.querySelector(".progress-bar-fill");
                    if (progress) progress.style.width = "0%";
                }
            }
            this._playingId = null;
            this._playingCard = null;
        }

        toggleAudio(item, cardEl) {
            const fileUrl = item.url;
            if (this._playingId === item.id) {
                this._stopCurrentAudio();
                return;
            }
            this._stopCurrentAudio();
            this._playingId = item.id;
            this._playingCard = cardEl;
            this._currentAudio = new Audio(fileUrl);

            this._currentAudio.onended = () => {
                this._stopCurrentAudio();
            };

            this._currentAudio.ontimeupdate = () => {
                if (this._playingId === item.id && this._currentAudio.duration) {
                    const percent = (this._currentAudio.currentTime / this._currentAudio.duration) * 100;
                    const progress = cardEl.querySelector(".progress-bar-fill");
                    if (progress) progress.style.width = `${percent}%`;
                }
            };

            this._currentAudio.onerror = (e) => {
                console.error("Audio playback error", e);
                this._stopCurrentAudio();
            };

            this._currentAudio.play().then(() => {
                if (this._playingId === item.id) {
                    cardEl.classList.add("playing");
                } else {
                    this._stopCurrentAudio();
                }
            }).catch(e => {
                console.error("Play request failed", e);
                this._stopCurrentAudio();
            });
        }

        showGlance(item, event) {
            const fileUrl = item.url;
            if (window.gZenGlanceManager) {
                if (window.gZenGlanceManager.closeGlance) {
                    window.gZenGlanceManager.closeGlance();
                }

                const rect = event.currentTarget.getBoundingClientRect();
                window.gZenGlanceManager.openGlance({
                    url: fileUrl,
                    clientX: rect.left,
                    clientY: rect.top,
                    width: rect.width,
                    height: rect.height
                });
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

        // [audit] LEAK-1 — this module had no destroy() at all, so ZenLibrary.destroy()'s
        // cleanup loop skipped it entirely. Every cover-art blob: URL and a Gecko File
        // object for every media file in the Downloads folder stayed pinned for the whole
        // lifetime of the browser window, and a Sine rebuild added another set.
        //
        // Modelled on Easels.destroy(), which already did this correctly.
        destroy() {
            try { this._stopCurrentAudio(); } catch (e) { }
            this._disarmDragCancel();
            this._disarmContextMenuSuppress();
            document.documentElement.removeAttribute("zen-library-dragging");
            this._disconnectLazyObservers();

            for (const url of this._objectUrls) {
                try { URL.revokeObjectURL(url); } catch (e) { }
            }
            this._objectUrls.clear();

            this._coverCache.clear();
            this._fileCache.clear();
            this._durations.clear();
            this._scanCache = null;
            this._scanPromise = null;
            this._renderToken++;
            this._container = null;
        }
    }

    window.ZenLibraryMedia = ZenLibraryMedia;
})();