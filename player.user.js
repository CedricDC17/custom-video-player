// ==UserScript==
// @name         Custom Video Player Overlay
// @namespace    custom-video-player
// @version      0.1.0
// @description  Replaces a page's video controls with a custom player — loop, speed menu, export clip, screenshot, PiP.
// @author       you
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// ============================================
// This file is player-core.js's engine (see that file in the project
// folder for the full explanation of how/why it's built the way it is)
// PLUS video-detection logic, combined into one self-contained script,
// because Tampermonkey userscripts can't @require a local file and this
// project intentionally avoids fetching external resources.
//
// player-core.js is the real source — if you change player behavior there,
// re-copy the engine section below from it. The only difference from
// player-core.js itself: this version calls initCustomPlayer directly
// within its own closure instead of exposing it on `window`, since nothing
// outside this script needs to call it.
// ============================================

(function () {
    'use strict';

    const CSS = `
        :host {
            all: initial; /* stop the host page's inherited styles (font, color, line-height...) leaking in */
            --bg: #12161B;
            --panel: #1B2128;
            --panel-2: #232A32;
            --line: #2B333C;
            --text: #E8ECEF;
            --text-dim: #8B95A1;
            --accent: #4FD1C5;
            --accent-dim: #2E8F86;
            --radius: 10px;
            --mono: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
            --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
            font-family: var(--sans);
        }

        * {
            box-sizing: border-box;
        }

        /* ============================================
           ON-VIDEO OVERLAY CONTROLS
           ============================================ */
        .video-controls-overlay {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px 8px;
            background: linear-gradient(to top, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0));
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }

        .video-controls-overlay.visible {
            opacity: 1;
            pointer-events: auto;
        }

        .overlay-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .overlay-row-main {
            flex: 1;
            min-width: 0;
        }

        .overlay-row-secondary {
            justify-content: flex-end;
        }

        @media (max-width: 640px) {
            .video-controls-overlay {
                flex-direction: column;
                align-items: stretch;
            }

            .overlay-row-main {
                flex: initial;
            }
        }

        .video-controls-top {
            position: absolute;
            left: 0;
            right: 0;
            top: 0;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 8px 20px;
            background: linear-gradient(to bottom, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0));
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }

        .video-controls-top.visible {
            opacity: 1;
            pointer-events: auto;
        }

        .overlay-left {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .overlay-volume {
            flex: none;
            width: 56px;
        }

        .overlay-seek-wrap {
            position: relative;
            flex: 1;
            min-width: 80px;
        }

        .loop-marker {
            position: absolute;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 2px;
            height: 12px;
            background: var(--accent);
            pointer-events: none;
            display: none;
        }

        .menu-wrap {
            position: relative;
        }

        .overlay-btn {
            background: transparent;
            border: none;
            color: var(--text);
            height: 34px;
            padding: 0 10px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            font-family: var(--mono);
            white-space: nowrap;
        }

        .overlay-btn:hover {
            background: var(--panel-2);
        }

        .overlay-btn.active {
            background: var(--accent-dim);
            color: var(--accent);
        }

        .popup-menu {
            position: absolute;
            bottom: calc(100% + 8px);
            right: 0;
            background: var(--panel-2);
            border: 1px solid var(--line);
            border-radius: var(--radius);
            padding: 4px;
            display: none;
            flex-direction: column;
            gap: 2px;
            min-width: 88px;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
        }

        .popup-menu.open {
            display: flex;
        }

        .popup-menu-down {
            bottom: auto;
            top: calc(100% + 8px);
            left: 0;
            right: auto;
        }

        .popup-item {
            background: transparent;
            border: none;
            color: var(--text);
            text-align: left;
            padding: 7px 10px;
            border-radius: 6px;
            font-size: 12px;
            font-family: var(--sans);
            cursor: pointer;
            white-space: nowrap;
        }

        .popup-item:hover {
            background: var(--panel);
        }

        .popup-item.active {
            color: var(--accent);
        }

        .popup-menu-wide {
            min-width: 170px;
        }

        .export-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .export-time-input {
            width: 56px;
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 6px;
            color: var(--text);
            font-family: var(--mono);
            font-size: 11px;
            padding: 4px 6px;
            text-align: center;
        }

        .export-cut-btn {
            text-align: center;
            color: var(--accent);
            font-weight: 600;
        }

        .export-status {
            font-size: 10px;
            color: var(--text-dim);
            text-align: center;
            padding: 2px 4px;
            min-height: 12px;
        }

        .time {
            font-family: var(--mono);
            font-size: 12px;
            color: var(--text-dim);
            min-width: 46px;
            text-align: center;
        }

        input[type="range"] {
            -webkit-appearance: none;
            appearance: none;
            flex: 1;
            width: 100%;
            height: 20px;
            background: transparent;
            outline: none;
            cursor: pointer;
            margin: 0;
        }

        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 13px;
            height: 13px;
            border-radius: 50%;
            background: var(--accent);
            cursor: pointer;
            margin-top: -4.5px;
        }

        input[type="range"]::-moz-range-thumb {
            width: 13px;
            height: 13px;
            border-radius: 50%;
            background: var(--accent);
            border: none;
            cursor: pointer;
        }

        input[type="range"]::-webkit-slider-runnable-track {
            -webkit-appearance: none;
            height: 4px;
            border-radius: 2px;
            background: linear-gradient(to right, var(--accent) 0%, var(--accent) var(--fill, 0%), var(--line) var(--fill, 0%));
        }

        input[type="range"]::-moz-range-track {
            height: 4px;
            border-radius: 2px;
            background: var(--line);
        }

        #seek {
            --fill: 0%;
        }

        .icon-btn {
            background: transparent;
            border: none;
            color: var(--text);
            width: 34px;
            height: 34px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
        }

        .icon-btn:hover {
            background: var(--panel-2);
        }
    `;

    // Builds one element via document.createElement + setAttribute/
    // textContent — never innerHTML. Sites that enforce a Trusted Types
    // CSP (YouTube included) throw a hard TypeError on ANY raw-string
    // innerHTML assignment, no exceptions — that's exactly what broke this
    // on YouTube. createElement/appendChild/textContent aren't part of
    // that restriction at all, so building the UI this way works
    // regardless of what CSP a site has. attrs.text sets textContent;
    // attrs.class sets the class; everything else is set via setAttribute.
    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        for (const key in (attrs || {})) {
            if (key === 'text') node.textContent = attrs[key];
            else if (key === 'class') node.className = attrs[key];
            else node.setAttribute(key, attrs[key]);
        }
        (children || []).forEach((child) => node.appendChild(child));
        return node;
    }

    function buildControlsUI() {
        const playBtn = el('button', { class: 'icon-btn', id: 'playBtn', title: 'Play/Pause (Space)', text: '▶' });
        const muteBtn = el('button', { class: 'icon-btn', id: 'muteBtn', title: 'Mute (M)', text: '🔊' });
        const volumeSlider = el('input', { type: 'range', id: 'volume', class: 'overlay-volume', min: '0', max: '1', step: '0.01', value: '1' });
        const overlayLeft = el('div', { class: 'overlay-left' }, [playBtn, muteBtn, volumeSlider]);

        const currentTimeEl = el('span', { class: 'time', id: 'currentTime', text: '0:00' });
        const seek = el('input', { type: 'range', id: 'seek', min: '0', max: '100', value: '0', step: '0.1' });
        const markerA = el('div', { class: 'loop-marker', id: 'markerA' });
        const markerB = el('div', { class: 'loop-marker', id: 'markerB' });
        const seekWrap = el('div', { class: 'overlay-seek-wrap' }, [seek, markerA, markerB]);
        const durationEl = el('span', { class: 'time', id: 'duration', text: '0:00' });

        const rowMain = el('div', { class: 'overlay-row overlay-row-main' }, [overlayLeft, currentTimeEl, seekWrap, durationEl]);

        const speedBtn = el('button', { class: 'overlay-btn', id: 'speedBtn', title: 'Playback speed', text: '1×' });
        const speedItems = ['0.25', '0.5', '0.75', '1', '1.25', '1.5', '2'].map((s) =>
            el('button', { class: 'popup-item', 'data-speed': s, text: s + '×' })
        );
        const speedMenu = el('div', { class: 'popup-menu', id: 'speedMenu' }, speedItems);
        const speedWrap = el('div', { class: 'menu-wrap' }, [speedBtn, speedMenu]);

        const pipBtn = el('button', { class: 'overlay-btn', id: 'pipBtn', title: 'Picture-in-Picture', text: 'PiP' });
        const fullscreenBtn = el('button', { class: 'icon-btn', id: 'fullscreenBtn', title: 'Fullscreen (F)', text: '⛶' });

        const rowSecondary = el('div', { class: 'overlay-row overlay-row-secondary' }, [speedWrap, pipBtn, fullscreenBtn]);

        const videoControlsOverlay = el('div', { class: 'video-controls-overlay', id: 'videoControlsOverlay' }, [rowMain, rowSecondary]);

        const loopBtn = el('button', { class: 'overlay-btn', id: 'loopBtn', title: 'A/B loop', text: 'Loop' });
        const menuSetA = el('button', { class: 'popup-item', id: 'menuSetA', text: 'Set A' });
        const menuSetB = el('button', { class: 'popup-item', id: 'menuSetB', text: 'Set B' });
        const menuLoopToggle = el('button', { class: 'popup-item', id: 'menuLoopToggle', text: 'Loop: Off' });
        const loopMenu = el('div', { class: 'popup-menu popup-menu-down', id: 'loopMenu' }, [menuSetA, menuSetB, menuLoopToggle]);
        const loopWrap = el('div', { class: 'menu-wrap' }, [loopBtn, loopMenu]);

        const menuSetStart = el('button', { class: 'popup-item', id: 'menuSetStart', text: 'Set start' });
        const exportStartInput = el('input', { type: 'text', id: 'exportStartInput', class: 'export-time-input', value: '0:00' });
        const exportRow1 = el('div', { class: 'export-row' }, [menuSetStart, exportStartInput]);

        const menuSetEnd = el('button', { class: 'popup-item', id: 'menuSetEnd', text: 'Set end' });
        const exportEndInput = el('input', { type: 'text', id: 'exportEndInput', class: 'export-time-input', value: '0:00' });
        const exportRow2 = el('div', { class: 'export-row' }, [menuSetEnd, exportEndInput]);

        const exportCutBtn = el('button', { class: 'popup-item export-cut-btn', id: 'exportCutBtn', text: 'Cut' });
        const exportStatus = el('div', { class: 'export-status', id: 'exportStatus' });
        const exportMenu = el('div', { class: 'popup-menu popup-menu-down popup-menu-wide', id: 'exportMenu' }, [exportRow1, exportRow2, exportCutBtn, exportStatus]);
        const exportBtn = el('button', { class: 'overlay-btn', id: 'exportBtn', title: 'Export clip', text: 'Export' });
        const exportWrap = el('div', { class: 'menu-wrap' }, [exportBtn, exportMenu]);

        const screenshotBtn = el('button', { class: 'icon-btn', id: 'screenshotBtn', title: 'Save current frame as image', text: '📷' });

        const videoControlsTop = el('div', { class: 'video-controls-top', id: 'videoControlsTop' }, [loopWrap, exportWrap, screenshotBtn]);

        return { videoControlsOverlay, videoControlsTop };
    }

    const MAX_Z = 2147483647;

    function isEditableElement(el) {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }

    function getDeepActiveElement() {
        let el = document.activeElement;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) {
            el = el.shadowRoot.activeElement;
        }
        return el;
    }

    function initCustomPlayer(video, options) {
        options = options || {};
        const hasContainer = !!options.container;

        const stageEl = hasContainer ? options.container : null;

        // Turn off the browser's own default control bar so it doesn't
        // render underneath (and double-handle clicks alongside) ours. A
        // no-op for sites that never used it in the first place.
        video.controls = false;

        // pointer-events:none always — only the actual control bars (via
        // their own CSS) capture clicks when visible. This used to be
        // 'auto' across the whole tracked area in no-container mode, which
        // seemed fine for one video but broke real pages: most pages have
        // several <video> elements (ads, thumbnails, previews), each
        // getting its own full-area click-eating layer, swallowing normal
        // clicks anywhere near them. Never do that again.
        const overlayHost = document.createElement('div');
        overlayHost.style.pointerEvents = 'none';

        if (hasContainer) {
            overlayHost.style.position = 'absolute';
            overlayHost.style.inset = '0';
            stageEl.appendChild(overlayHost);
        } else {
            overlayHost.style.position = 'fixed';
            overlayHost.style.zIndex = String(MAX_Z);
            document.body.appendChild(overlayHost);
        }

        const shadowRoot = overlayHost.attachShadow({ mode: 'open' });
        const styleEl = document.createElement('style');
        styleEl.textContent = CSS; // .textContent on <style> isn't a Trusted Types sink — only innerHTML is
        shadowRoot.appendChild(styleEl);
        const ui = buildControlsUI();
        shadowRoot.appendChild(ui.videoControlsOverlay);
        shadowRoot.appendChild(ui.videoControlsTop);

        function $(id) {
            return shadowRoot.getElementById(id);
        }

        const videoControlsOverlay = $('videoControlsOverlay');
        const videoControlsTop = $('videoControlsTop');
        const playBtn = $('playBtn');
        const muteBtn = $('muteBtn');
        const volumeSlider = $('volume');
        const pipBtn = $('pipBtn');
        const fullscreenBtn = $('fullscreenBtn');

        const seek = $('seek');
        const currentTimeEl = $('currentTime');
        const durationEl = $('duration');
        const markerA = $('markerA');
        const markerB = $('markerB');

        const speedBtn = $('speedBtn');
        const speedMenu = $('speedMenu');
        const loopBtn = $('loopBtn');
        const loopMenu = $('loopMenu');
        const menuSetA = $('menuSetA');
        const menuSetB = $('menuSetB');
        const menuLoopToggle = $('menuLoopToggle');

        const exportBtn = $('exportBtn');
        const exportMenu = $('exportMenu');
        const menuSetStart = $('menuSetStart');
        const menuSetEnd = $('menuSetEnd');
        const exportStartInput = $('exportStartInput');
        const exportEndInput = $('exportEndInput');
        const exportCutBtn = $('exportCutBtn');
        const exportStatus = $('exportStatus');

        const screenshotBtn = $('screenshotBtn');

        // Without a container, overlayHost has pointer-events:none (see
        // above), so it can't receive real mouse events — the video
        // element itself is the actual interaction target. Trade-off: the
        // host page's own click-to-pause handler (if any) may also fire on
        // the same click, occasionally double-toggling play on that one
        // video — much smaller and more localized than the alternative.
        const interactionTarget = hasContainer ? stageEl : video;

        const FRAME_DURATION = 1 / 30;

        let loopA = null;
        let loopB = null;
        let loopEnabled = false;

        let exportStart = 0;
        let exportEnd = 0;

        let isScrubbing = false;

        function togglePlay() {
            if (video.paused) video.play();
            else video.pause();
        }
        playBtn.addEventListener('click', togglePlay);

        let videoClickTimer = null;
        interactionTarget.addEventListener('click', () => {
            if (videoClickTimer) {
                clearTimeout(videoClickTimer);
                videoClickTimer = null;
                return;
            }
            videoClickTimer = setTimeout(() => {
                togglePlay();
                videoClickTimer = null;
            }, 250);
        });
        interactionTarget.addEventListener('dblclick', () => {
            toggleFullscreen();
        });
        video.addEventListener('play', () => {
            playBtn.textContent = '⏸';
            showOverlay();
        });
        video.addEventListener('pause', () => {
            playBtn.textContent = '▶';
            showOverlay();
        });

        function stepFrame(direction) {
            video.pause();
            const target = video.currentTime + direction * FRAME_DURATION;
            video.currentTime = Math.max(0, Math.min(video.duration || 0, target));
        }

        speedBtn.addEventListener('click', () => {
            syncSpeedMenuActive();
            toggleMenu(speedMenu);
        });
        speedMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.popup-item');
            if (!item) return;
            video.playbackRate = parseFloat(item.dataset.speed);
            speedBtn.textContent = item.textContent;
            closeAllMenus();
        });
        function syncSpeedMenuActive() {
            speedMenu.querySelectorAll('.popup-item').forEach((item) => {
                item.classList.toggle('active', parseFloat(item.dataset.speed) === video.playbackRate);
            });
        }

        volumeSlider.addEventListener('input', () => {
            video.volume = volumeSlider.value;
            video.muted = video.volume === 0;
            muteBtn.textContent = video.muted ? '🔇' : '🔊';
        });
        muteBtn.addEventListener('click', () => {
            video.muted = !video.muted;
            muteBtn.textContent = video.muted ? '🔇' : '🔊';
        });

        function refreshForNewSource() {
            seek.max = video.duration || 100;
            durationEl.textContent = formatTime(video.duration);
            exportStart = 0;
            exportEnd = video.duration || 0;
            exportStartInput.value = formatTime(exportStart);
            exportEndInput.value = formatTime(exportEnd);
            showOverlay();
        }
        video.addEventListener('loadedmetadata', refreshForNewSource);
        video.addEventListener('emptied', resetLoop);

        function updateTimeDisplay(time) {
            const t = time === undefined ? video.currentTime : time;
            currentTimeEl.textContent = formatTime(t);
            seek.value = t;
            updateSeekFill(t);
        }

        let syncFrameCount = 0;
        function renderLoop() {
            if (destroyed) return; // declared further down, but this only ever runs async (next frame), after it's initialized
            if (!video.paused && !isScrubbing) {
                updateTimeDisplay();
            }
            checkLoop();
            if (!hasContainer) {
                // getBoundingClientRect() forces a layout read — cheap
                // alone, but adds up fast on a DOM-heavy page. Every 4th
                // frame (~15fps) is still smooth for tracking scroll/resize
                // without doing it 60 times a second.
                syncFrameCount++;
                if (syncFrameCount % 4 === 0) syncPosition();
            }
            requestAnimationFrame(renderLoop);
        }
        requestAnimationFrame(renderLoop);

        let pendingSeekFrame = null;
        seek.addEventListener('pointerdown', () => { isScrubbing = true; });
        window.addEventListener('pointerup', () => { isScrubbing = false; });
        seek.addEventListener('input', () => {
            updateTimeDisplay(parseFloat(seek.value));
            if (pendingSeekFrame === null) {
                pendingSeekFrame = requestAnimationFrame(() => {
                    video.currentTime = seek.value;
                    pendingSeekFrame = null;
                });
            }
        });

        video.addEventListener('seeked', () => {
            if (video.paused && !isScrubbing) {
                updateTimeDisplay();
            }
        });

        function updateSeekFill(time) {
            const t = time === undefined ? video.currentTime : time;
            const pct = video.duration ? (t / video.duration) * 100 : 0;
            seek.style.setProperty('--fill', pct + '%');
        }

        function formatTime(sec) {
            if (!isFinite(sec)) return '0:00';
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        }

        function syncPosition() {
            const rect = video.getBoundingClientRect();
            overlayHost.style.top = rect.top + 'px';
            overlayHost.style.left = rect.left + 'px';
            overlayHost.style.width = rect.width + 'px';
            overlayHost.style.height = rect.height + 'px';
        }
        if (!hasContainer) syncPosition();

        let hideOverlayTimer = null;
        let anyMenuOpen = false;
        let isHovering = false;

        function showOverlay() {
            videoControlsOverlay.classList.add('visible');
            videoControlsTop.classList.add('visible');
            clearTimeout(hideOverlayTimer);
            if (!video.paused && !anyMenuOpen) {
                hideOverlayTimer = setTimeout(() => {
                    if (!isScrubbing) {
                        videoControlsOverlay.classList.remove('visible');
                        videoControlsTop.classList.remove('visible');
                    }
                }, 2500);
            }
        }

        function hideOverlayIfIdle() {
            if (!video.paused && !isScrubbing && !anyMenuOpen) {
                videoControlsOverlay.classList.remove('visible');
                videoControlsTop.classList.remove('visible');
            }
        }

        // mouseenter/mouseleave on the video itself would miss entirely on
        // sites whose own control layer sits visually on top of the raw
        // <video> tag (very common — the video would just never receive
        // the event). Checking cursor position against the video's tracked
        // rect on every document-wide mousemove works regardless of what's
        // on top, and since it only reads position (never blocks/redirects
        // the event), it can't interfere with the host page's own handling
        // of that same mousemove.
        let onDocumentMouseMove = null;
        if (hasContainer) {
            interactionTarget.addEventListener('mousemove', showOverlay);
            interactionTarget.addEventListener('mouseenter', () => { isHovering = true; });
            interactionTarget.addEventListener('mouseleave', () => {
                isHovering = false;
                hideOverlayIfIdle();
            });
        } else {
            onDocumentMouseMove = (e) => {
                const rect = video.getBoundingClientRect();
                const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom;
                if (inside) {
                    isHovering = true;
                    showOverlay();
                } else if (isHovering) {
                    isHovering = false;
                    hideOverlayIfIdle();
                }
            };
            document.addEventListener('mousemove', onDocumentMouseMove);
        }

        function closeAllMenus() {
            speedMenu.classList.remove('open');
            loopMenu.classList.remove('open');
            exportMenu.classList.remove('open');
            anyMenuOpen = false;
            showOverlay();
        }

        function toggleMenu(menuEl) {
            const wasOpen = menuEl.classList.contains('open');
            closeAllMenus();
            if (!wasOpen) {
                menuEl.classList.add('open');
                anyMenuOpen = true;
                clearTimeout(hideOverlayTimer);
            }
        }

        function onDocumentClick(e) {
            if (!anyMenuOpen) return;
            const path = e.composedPath();
            const insideMenu = path.some((el) => el.classList && el.classList.contains('menu-wrap'));
            if (!insideMenu) closeAllMenus();
        }
        document.addEventListener('click', onDocumentClick);

        loopBtn.addEventListener('click', () => toggleMenu(loopMenu));

        menuSetA.addEventListener('click', () => {
            loopA = video.currentTime;
            positionMarker(markerA, loopA);
        });
        menuSetB.addEventListener('click', () => {
            loopB = video.currentTime;
            positionMarker(markerB, loopB);
        });
        menuLoopToggle.addEventListener('click', () => {
            if (loopA === null || loopB === null) return;
            loopEnabled = !loopEnabled;
            updateLoopUI();
        });
        function updateLoopUI() {
            menuLoopToggle.textContent = loopEnabled ? 'Loop: On' : 'Loop: Off';
            loopBtn.classList.toggle('active', loopEnabled);
        }

        let seekLatency = 0.05;
        let seekStartedAt = 0;
        video.addEventListener('seeking', () => {
            seekStartedAt = performance.now();
        });
        video.addEventListener('seeked', () => {
            const elapsed = (performance.now() - seekStartedAt) / 1000;
            seekLatency = seekLatency * 0.7 + elapsed * 0.3;
        });

        function checkLoop() {
            if (!loopEnabled || loopA === null || loopB === null) return;
            const loopLength = loopB - loopA;
            const lookahead = Math.min(seekLatency * video.playbackRate, loopLength / 2);
            if (video.currentTime >= loopB - lookahead) {
                video.currentTime = loopA;
            }
        }

        function positionMarker(el, time) {
            if (!video.duration) return;
            const pct = (time / video.duration) * 100;
            el.style.left = pct + '%';
            el.style.display = 'block';
        }

        function resetLoop() {
            loopA = null;
            loopB = null;
            loopEnabled = false;
            updateLoopUI();
            markerA.style.display = 'none';
            markerB.style.display = 'none';
        }

        exportBtn.addEventListener('click', () => toggleMenu(exportMenu));

        menuSetStart.addEventListener('click', () => {
            exportStart = video.currentTime;
            exportStartInput.value = formatTime(exportStart);
        });
        menuSetEnd.addEventListener('click', () => {
            exportEnd = video.currentTime;
            exportEndInput.value = formatTime(exportEnd);
        });

        function parseTimeInput(str) {
            const parts = str.trim().split(':').map(Number);
            if (parts.some(isNaN)) return null;
            return parts.reduce((total, part) => total * 60 + part, 0);
        }
        exportStartInput.addEventListener('change', () => {
            const t = parseTimeInput(exportStartInput.value);
            if (t !== null && video.duration) exportStart = Math.max(0, Math.min(video.duration, t));
            exportStartInput.value = formatTime(exportStart);
        });
        exportEndInput.addEventListener('change', () => {
            const t = parseTimeInput(exportEndInput.value);
            if (t !== null && video.duration) exportEnd = Math.max(0, Math.min(video.duration, t));
            exportEndInput.value = formatTime(exportEnd);
        });

        exportCutBtn.addEventListener('click', exportClip);

        async function exportClip() {
            if (!video.src && !video.currentSrc) {
                exportStatus.textContent = 'No video source found';
                return;
            }
            if (exportEnd <= exportStart) {
                exportStatus.textContent = 'End must be after start';
                return;
            }

            let stream;
            try {
                stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
            } catch (err) {
                exportStatus.textContent = "This source can't be captured (cross-origin?)";
                return;
            }

            let recorder;
            try {
                recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            } catch (err) {
                exportStatus.textContent = 'Recording not supported in this browser';
                return;
            }

            const chunks = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

            exportCutBtn.disabled = true;
            const wasLoopEnabled = loopEnabled;
            loopEnabled = false;

            video.pause();
            video.currentTime = exportStart;
            await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));

            recorder.start();
            exportStatus.textContent = 'Recording clip…';
            video.play();

            await new Promise((resolve) => {
                function checkEnd() {
                    if (video.currentTime >= exportEnd || video.paused) {
                        video.removeEventListener('timeupdate', checkEnd);
                        resolve();
                    }
                }
                video.addEventListener('timeupdate', checkEnd);
            });

            video.pause();
            recorder.stop();
            await new Promise((resolve) => { recorder.onstop = resolve; });

            loopEnabled = wasLoopEnabled;
            exportCutBtn.disabled = false;

            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `clip-${Math.round(exportStart)}s-${Math.round(exportEnd)}s.webm`;
            a.click();
            URL.revokeObjectURL(url);

            exportStatus.textContent = 'Done — check your downloads';
        }

        screenshotBtn.addEventListener('click', () => {
            if (!video.videoWidth) return;

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

            try {
                canvas.toBlob((blob) => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `frame-${formatTime(video.currentTime).replace(':', '-')}.png`;
                    a.click();
                    URL.revokeObjectURL(url);
                }, 'image/png');
            } catch (err) {
                console.warn('Screenshot failed (likely a cross-origin video without CORS headers):', err);
            }
        });

        if (!document.pictureInPictureEnabled) {
            pipBtn.style.display = 'none';
        }
        pipBtn.addEventListener('click', async () => {
            try {
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                } else {
                    await video.requestPictureInPicture();
                }
            } catch (err) {
                console.warn('Picture-in-Picture failed:', err);
            }
        });
        video.addEventListener('enterpictureinpicture', () => pipBtn.classList.add('active'));
        video.addEventListener('leavepictureinpicture', () => pipBtn.classList.remove('active'));

        let fakeFullscreen = false;
        let videoOriginalStyle = '';
        let videoOriginalParent = null;
        let videoOriginalNextSibling = null;

        function toggleFullscreen() {
            if (hasContainer) {
                if (document.fullscreenElement) document.exitFullscreen();
                else stageEl.requestFullscreen();
                return;
            }

            fakeFullscreen = !fakeFullscreen;
            fullscreenBtn.classList.toggle('active', fakeFullscreen);
            if (fakeFullscreen) {
                // position:fixed;inset:0 alone isn't reliable — verified
                // against real YouTube, the computed style and
                // getBoundingClientRect() both correctly reported a full-
                // viewport box, yet it still visually rendered at normal
                // in-page size. Some ancestor was establishing a
                // containing block for fixed-position descendants
                // (transform/filter/perspective/contain/content-visibility
                // all do this) that trapped the actual paint. Rather than
                // detecting exactly which one, this sidesteps it: move the
                // video to a direct child of <body> (recording exactly
                // where it came from to restore on exit) — body is never
                // going to have one of those properties. overlayHost is
                // re-appended right after so it stays the later sibling
                // (paints on top) despite both sitting at the same z-index.
                videoOriginalParent = video.parentNode;
                videoOriginalNextSibling = video.nextSibling;
                videoOriginalStyle = video.getAttribute('style') || '';
                document.body.appendChild(video);
                document.body.appendChild(overlayHost);
                video.style.setProperty('position', 'fixed', 'important');
                video.style.setProperty('inset', '0', 'important');
                video.style.setProperty('width', '100vw', 'important');
                video.style.setProperty('height', '100vh', 'important');
                video.style.setProperty('z-index', String(MAX_Z), 'important');
                video.style.setProperty('margin', '0', 'important'); // inset:0 positions the margin edge, so leftover margin would still offset the box
                // The video element's box genuinely does become full-
                // viewport here (verified: getBoundingClientRect stayed
                // rock-stable at the exact window size). But sites often
                // set object-fit:contain on their video (preserve aspect
                // ratio instead of stretching) — verified true on YouTube —
                // which letterboxes the actual picture inside that box.
                // The letterbox gaps are only opaque if the element has a
                // background; without one they're transparent, showing the
                // page content right through them, which looked exactly
                // like "fullscreen isn't really covering the screen."
                // Forcing black here is what actually fixes that.
                video.style.setProperty('background', '#000', 'important');
            } else {
                video.setAttribute('style', videoOriginalStyle);
                if (videoOriginalNextSibling && videoOriginalNextSibling.parentNode === videoOriginalParent) {
                    videoOriginalParent.insertBefore(video, videoOriginalNextSibling);
                } else {
                    videoOriginalParent.appendChild(video);
                }
            }
            syncPosition();
        }
        fullscreenBtn.addEventListener('click', toggleFullscreen);

        function onDocumentKeydown(e) {
            if (!isHovering) return;
            if (isEditableElement(getDeepActiveElement())) return;

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'ArrowRight':
                    video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
                    break;
                case 'ArrowLeft':
                    video.currentTime = Math.max(0, video.currentTime - 5);
                    break;
                case ',':
                    stepFrame(-1);
                    break;
                case '.':
                    stepFrame(1);
                    break;
                case 'm':
                case 'M':
                    muteBtn.click();
                    break;
                case 'f':
                case 'F':
                    toggleFullscreen();
                    break;
                case 'Escape':
                    if (fakeFullscreen) toggleFullscreen();
                    break;
            }
        }
        document.addEventListener('keydown', onDocumentKeydown);

        if (video.readyState >= 1) refreshForNewSource();
        if (!video.paused) playBtn.textContent = '⏸';

        // Called by the detection logic below when this video is no longer
        // the one we should be attached to (removed from the page, or a
        // larger/more-relevant video took over).
        let destroyed = false;
        function destroy() {
            destroyed = true;
            document.removeEventListener('click', onDocumentClick);
            document.removeEventListener('keydown', onDocumentKeydown);
            if (onDocumentMouseMove) document.removeEventListener('mousemove', onDocumentMouseMove);
            overlayHost.remove();
        }
        return destroy;
    }

    // ============================================
    // VIDEO DETECTION
    // Attaches to at most ONE video at a time: the largest eligible one
    // currently on the page. Earlier this attached to every <video> found
    // — but most real pages have several (ads, thumbnails, autoplay
    // previews), and each one got its own overlay, which caused real
    // problems (see the pointer-events comments above). "Biggest video on
    // the page" is a simple, cheap stand-in for "the one you're actually
    // trying to watch," and re-checked continuously so it can switch to a
    // bigger one if the real content loads in after an ad, or detach
    // cleanly if the current video is removed from the page.
    // ============================================
    const MIN_WIDTH = 200;
    const MIN_HEIGHT = 150;

    let currentVideo = null;
    let currentDestroy = null;

    function videoArea(video) {
        const rect = video.getBoundingClientRect();
        return rect.width * rect.height;
    }

    function isEligible(video) {
        const rect = video.getBoundingClientRect();
        return rect.width >= MIN_WIDTH && rect.height >= MIN_HEIGHT;
    }

    // On a page with a real sidebar (related-video thumbnails, autoplay
    // Shorts previews, end-screen suggestions), several videos can be
    // eligible by size at once — "biggest wins" isn't reliable there.
    // Sites we specifically care about get a direct, targeted selector for
    // their actual player instead of guessing by size.
    function findPreferredVideo() {
        if (location.hostname.endsWith('youtube.com')) {
            const v = document.querySelector('#movie_player video, .html5-video-player video');
            if (v && isEligible(v)) return v;
        }
        return null;
    }

    function detachCurrent() {
        if (currentDestroy) currentDestroy();
        currentVideo = null;
        currentDestroy = null;
    }

    function attachTo(video) {
        if (video === currentVideo) return;
        if (currentVideo) detachCurrent();
        try {
            currentDestroy = initCustomPlayer(video);
            currentVideo = video;
        } catch (err) {
            console.error('Custom Video Player: failed to attach', err);
        }
    }

    function scan() {
        if (currentVideo && !currentVideo.isConnected) {
            detachCurrent(); // the video we were attached to left the page
        }

        const preferred = findPreferredVideo();
        if (preferred) {
            attachTo(preferred);
            return;
        }

        const candidates = Array.from(document.querySelectorAll('video')).filter(isEligible);
        if (candidates.length === 0) return;

        const largest = candidates.reduce((a, b) => (videoArea(a) >= videoArea(b) ? a : b));
        if (largest === currentVideo) return; // already attached to the right one

        // Require a meaningfully bigger candidate (not just a few pixels)
        // before switching, so two similarly-sized videos don't cause
        // rapid attach/detach thrashing against each other.
        if (currentVideo && videoArea(largest) <= videoArea(currentVideo) * 1.2) return;

        attachTo(largest);
    }

    // Sites whose own control chrome should be hidden so it doesn't show
    // alongside ours — this is unavoidably site-specific (their internal
    // class names, not a stable public API, so it can break if they change
    // their markup) and was only worth doing for a site actually verified
    // against its real, current page rather than guessed at.
    function injectSiteSpecificCSS() {
        if (location.hostname.endsWith('youtube.com')) {
            const style = document.createElement('style');
            style.textContent = `
                .ytp-chrome-bottom, .ytp-chrome-top, .ytp-gradient-bottom,
                .ytp-gradient-top, .ytp-large-play-button, .ytp-pause-overlay {
                    display: none !important;
                }
            `;
            document.head.appendChild(style); // .textContent, not innerHTML — not a Trusted Types sink
        }
    }

    // A raw `new MutationObserver(scan)` re-runs scan() on every DOM
    // mutation anywhere under <body> — fine on a static page, but sites
    // like YouTube mutate constantly (live counts, chat, lazy-loaded
    // recommendations, ads), which could fire scan() dozens of times a
    // second. Each scan reads layout (getBoundingClientRect) for every
    // <video> on the page, and forcing that repeatedly on an already
    // DOM-heavy page is a real way to peg the CPU. Debouncing caps scan()
    // to at most once per 400ms no matter how bursty the mutations are.
    let scanScheduled = false;
    function scheduleScan() {
        if (scanScheduled) return;
        scanScheduled = true;
        setTimeout(() => {
            scanScheduled = false;
            scan();
        }, 400);
    }

    // document.head / document.body can both throw ("Cannot read
    // properties of null") if this runs before the DOM has parsed that
    // far — and since everything here runs as one top-level function, an
    // exception on ANY of these lines silently kills everything AFTER it
    // too, including the setInterval fallback. Verified by direct
    // reproduction against real YouTube: injecting this early left the
    // video permanently un-attached forever, not just delayed — because
    // neither the observer nor the interval ever actually got set up
    // (the crash happened on the document.head.appendChild call above,
    // before either was reached). @run-at document-idle should normally
    // mean the DOM is already ready, but gating all of this behind an
    // explicit readiness check costs nothing and removes an entire class
    // of "silently never recovers" failure.
    function init() {
        injectSiteSpecificCSS();
        scan();
        new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
        setInterval(scan, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
