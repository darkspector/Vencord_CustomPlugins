/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, migratePluginSettings, PlainSettings, Settings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findCssClasses } from "@webpack";
import { ApplicationStreamingStore, ChannelRouter, ChannelStore, SelectedChannelStore, UserStore } from "@webpack/common";

// Discord's class names are hashed (e.g. "pictureInPictureWindow_a1b2c3"), so match on the prefix.
const PIP_WINDOW = '[class*="pictureInPictureWindow"]';
const PIP_ROOT = '[class*="pictureInPicture_"]';
// Discord's stack of full-window layers (the main UI, settings, ...). Popouts, menus and tooltips live
// in separate layer containers, so shrinking this keeps their positions lined up with the cursor.
const APP_LAYERS = '[class*="layers_"]';
// The voice channel's call view, where Discord shows the stream full size
const CALL_VIEW = '[class*="callContainer"]';

const A_WINDOW = "data-vc-streamdock-window";
const A_ANCESTOR = "data-vc-streamdock-ancestor";
const A_APP = "data-vc-streamdock-app";
const A_BAR = "data-vc-streamdock-bar";
// Toolbar shown over the full call view, with a button to dock the stream again
const A_CALL_BAR = "data-vc-streamdock-callbar";
// Set on a toolbar when it's been placed in Discord's own control row instead of floating
const A_INLINE = "data-vc-streamdock-inline";
const A_TOOLTIP = "data-vc-streamdock-tooltip";
// Discord's Full Screen / Pop Out buttons, matched by their (English) labels; our buttons go next to them
const NATIVE_CONTROL = /full ?screen|pop ?out/i;
const A_HANDLE = "data-vc-streamdock-handle";
// Elements between the popout window and its <video>, stretched to fill the docked window
const A_FILL = "data-vc-streamdock-fill";

// The stream never takes more than this much of the window height, or more than its own height at full width
const MAX_FRACTION = 0.5;
const MIN_HEIGHT = 120;

const GUILD_VOICE = 2;
const GUILD_STAGE_VOICE = 13;
// How long after "watch stream" Discord's jump to the call view counts as caused by it
const WATCH_WINDOW_MS = 2000;

const ICONS = {
    undock: "M19 11h-8v6h8v-6Zm2-8H3a2 2 0 0 0-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5a2 2 0 0 0-2-2Zm0 16.01H3V4.98h18v14.03Z",
    dock: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v6h14V5H5Z",
    down: "M11 4h2v12.17l5.59-5.58L20 12l-8 8-8-8 1.41-1.41L11 16.17V4Z",
    up: "M13 20h-2V7.83l-5.59 5.58L4 12l8-8 8 8-1.41 1.41L13 7.83V20Z",
    fullView: "M12 5.83 15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83Zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17Z"
};

const settings = definePluginSettings({
    startIn: {
        type: OptionType.SELECT,
        displayName: "Start Streams In",
        description: "How a stream opens when you click Watch. Leaving the full view docks it, unless you pick Mini player.",
        options: [
            { label: "Docked: stay in your text channel with the stream docked", value: "docked", default: true },
            { label: "Full view: Discord's full call view", value: "fullView" },
            { label: "Mini player: stay in your text channel with Discord's floating player", value: "miniPlayer" }
        ]
    },
    position: {
        type: OptionType.SELECT,
        description: "Whether the stream docks at the top or bottom of the window",
        options: [
            { label: "Top", value: "top", default: true },
            { label: "Bottom", value: "bottom" }
        ],
        onChange: () => scheduleUpdate()
    }
}).withPrivateSettings<{
    // Height set with the drag handle, as % of the window height. Unset = fit the stream's aspect ratio.
    height?: number;
}>();

const css = `
[${A_ANCESTOR}] {
    transform: none !important;
    will-change: auto !important;
    filter: none !important;
    contain: none !important;
}
[${A_WINDOW}] {
    position: fixed !important;
    top: var(--vc-sd-top) !important;
    left: var(--vc-sd-left) !important;
    width: var(--vc-sd-width) !important;
    height: var(--vc-sd-height) !important;
    max-width: none !important;
    max-height: none !important;
    transform: none !important;
    border-radius: 0 !important;
    background: #000 !important;
    z-index: 100 !important;
}
[${A_FILL}] {
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
}
[${A_WINDOW}] video {
    object-fit: contain !important;
}
[${A_APP}] {
    height: calc(100% - var(--vc-sd-height)) !important;
    max-height: calc(100% - var(--vc-sd-height)) !important;
}
[${A_APP}="top"] {
    margin-top: var(--vc-sd-height) !important;
}
[${A_BAR}]:not([${A_INLINE}]) {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 12;
    display: flex;
    gap: 2px;
    padding: 4px;
    border-radius: 8px;
    background: rgba(17, 18, 20, 0.9);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    opacity: 0;
    transition: opacity 0.15s;
}
[${A_HANDLE}] {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 11;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ns-resize;
}
[${A_HANDLE}="bottom"] {
    bottom: 0;
}
[${A_HANDLE}="top"] {
    top: 0;
}
[${A_HANDLE}]::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: #5865f2;
    opacity: 0;
    transition: opacity 0.1s;
}
[${A_HANDLE}="bottom"]::before {
    bottom: 0;
}
[${A_HANDLE}="top"]::before {
    top: 0;
}
[${A_HANDLE}]::after {
    content: "";
    width: 48px;
    height: 4px;
    border-radius: 2px;
    background: #dbdee1;
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
    opacity: 0;
    transition: opacity 0.15s, background-color 0.1s, width 0.1s;
}
${PIP_WINDOW}:hover [${A_HANDLE}]::after {
    opacity: 0.7;
}
[${A_HANDLE}]:hover::before, [${A_HANDLE}][data-dragging]::before {
    opacity: 1;
}
[${A_HANDLE}]:hover::after, [${A_HANDLE}][data-dragging]::after {
    opacity: 1;
    width: 64px;
    background: #5865f2;
}
${PIP_WINDOW}:hover [${A_BAR}], [${A_BAR}]:focus-within {
    opacity: 1;
}
[${A_INLINE}] {
    display: contents;
}
[${A_INLINE}] button span {
    display: none;
}
[${A_TOOLTIP}] {
    position: fixed;
    z-index: 10000;
    pointer-events: none;
    transform: translate(-50%, -100%);
    animation: vc-streamdock-tip-in 0.1s ease-out;
}
[${A_TOOLTIP}][data-below] {
    transform: translate(-50%, 0);
}
@keyframes vc-streamdock-tip-in {
    from { opacity: 0; scale: 0.95; }
}
/* Used only when Discord's own tooltip classes can't be found */
[${A_TOOLTIP}][data-fallback] > div {
    position: relative;
    max-width: 190px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    line-height: 16px;
    color: var(--text-normal, #dbdee1);
    background: var(--background-floating, #111214);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
    word-wrap: break-word;
}
[${A_TOOLTIP}][data-fallback] > div::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 100%;
    margin-left: -5px;
    border: 5px solid transparent;
    border-top-color: var(--background-floating, #111214);
}
[${A_TOOLTIP}][data-fallback][data-below] > div::after {
    top: auto;
    bottom: 100%;
    border-top-color: transparent;
    border-bottom-color: var(--background-floating, #111214);
}
/* Zero specificity, so the copied Discord classes win; this only removes the browser's default button look */
:where([${A_INLINE}] button) {
    appearance: none;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
}
[${A_CALL_BAR}]:not([${A_INLINE}]) {
    position: fixed;
    z-index: 10;
    display: flex;
    padding: 4px;
    border-radius: 8px;
    background: rgba(17, 18, 20, 0.9);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    transform: translateX(-50%);
}
:is([${A_BAR}], [${A_CALL_BAR}]):not([${A_INLINE}]) button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    line-height: 16px;
    color: #dbdee1;
    background: transparent;
    cursor: pointer;
    transition: background-color 0.1s, color 0.1s;
}
:is([${A_BAR}], [${A_CALL_BAR}]):not([${A_INLINE}]) button:hover {
    color: #fff;
    background: #5865f2;
}
:is([${A_BAR}], [${A_CALL_BAR}]):not([${A_INLINE}]) button:active {
    background: #4752c4;
}
:is([${A_BAR}], [${A_CALL_BAR}]):not([${A_INLINE}]) button:focus-visible {
    outline: 2px solid #00a8fc;
    outline-offset: 1px;
}
:is([${A_BAR}], [${A_CALL_BAR}]):not([${A_INLINE}]) svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
}
:is([${A_BAR}], [${A_CALL_BAR}]) svg path {
    fill: currentColor;
}
`;

let style: HTMLStyleElement | null = null;
let observer: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let observedApp: Element | null = null;
let observedVideo: HTMLVideoElement | null = null;
let rafId = 0;
// Height we've currently taken from the app layers, to work out their original rect while they're shrunk
let appliedHeight = 0;
// The app layers' rect without the stream, from the last update; the drag handle measures against it
let fullTop = 0;
let fullHeight = 0;
// The stream's height at full window width and its own aspect ratio
let streamHeight = 0;
// Height (% of window) while the handle is being dragged; only saved to settings when the drag ends
let dragHeight: number | null = null;
// null = follow the Start Streams In setting; otherwise the user's explicit choice for the current popout
let userDocked: boolean | null = null;
let lastWindow: Element | null = null;
// Last non-voice channel the user was looking at, to return to when they start watching a stream
let lastTextChannelId: string | null = null;
let watchStartedAt = 0;
// Set by the Dock button in the call view so the next popout docks even if auto dock is off
let forceDock = false;

function scheduleUpdate() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
        rafId = 0;
        update();
    });
}

function clearMarks() {
    for (const attr of [A_WINDOW, A_ANCESTOR, A_APP, A_FILL])
        document.querySelectorAll(`[${attr}]`).forEach(el => el.removeAttribute(attr));
    appliedHeight = 0;
}

function isVoiceChannel(channelId: string | null | undefined) {
    const type = channelId ? ChannelStore.getChannel(channelId)?.type : undefined;
    return type === GUILD_VOICE || type === GUILD_STAGE_VOICE;
}

function returnToChat() {
    watchStartedAt = 0;
    if (lastTextChannelId && isVoiceChannel(SelectedChannelStore.getChannelId()))
        ChannelRouter.transitionToChannel(lastTextChannelId);
}

// Discord's own tooltip classes, so ours look the same; null if they can't be found
let tooltipClasses: Record<string, string> | null | undefined;
function getTooltipClasses() {
    if (tooltipClasses === undefined) {
        try {
            const c = findCssClasses("tooltip", "tooltipTop", "tooltipBottom", "tooltipPrimary", "tooltipPointer", "tooltipContent");
            tooltipClasses = c.tooltip ? c : null;
        } catch {
            tooltipClasses = null;
        }
    }
    return tooltipClasses;
}

let tooltipTarget: HTMLElement | null = null;

function hideTooltip() {
    tooltipTarget = null;
    document.querySelector(`[${A_TOOLTIP}]`)?.remove();
}

function showTooltip(target: HTMLElement) {
    const label = target.dataset.tooltip;
    if (!label) return;
    hideTooltip();

    const rect = target.getBoundingClientRect();
    const below = rect.top < 48;
    const tip = document.createElement("div");
    tip.setAttribute(A_TOOLTIP, "");
    if (below) tip.setAttribute("data-below", "");
    tip.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    tip.style.top = `${Math.round(below ? rect.bottom + 8 : rect.top - 8)}px`;

    const c = getTooltipClasses();
    const box = document.createElement("div");
    const content = document.createElement("div");
    content.textContent = label;
    if (c) {
        box.className = `${c.tooltip} ${below ? c.tooltipBottom : c.tooltipTop} ${c.tooltipPrimary}`;
        const pointer = document.createElement("div");
        pointer.className = c.tooltipPointer;
        content.className = c.tooltipContent;
        box.append(pointer, content);
    } else {
        tip.setAttribute("data-fallback", "");
        box.append(content);
    }
    tip.append(box);
    document.body.append(tip);
    tooltipTarget = target;
}

// Discord-style tooltip instead of the slow browser one from the title attribute.
// onlyInline: skip it while the element's label is already visible in the floating toolbar.
function addTooltip(el: HTMLElement, onlyInline: boolean) {
    el.addEventListener("mouseenter", () => {
        if (!onlyInline || el.closest(`[${A_INLINE}]`)) showTooltip(el);
    });
    for (const ev of ["mouseleave", "pointerdown", "blur"])
        el.addEventListener(ev, hideTooltip);
}

function makeButton(onClick: () => void) {
    const btn = document.createElement("button");
    btn.type = "button";
    // Stop the popout from treating this as a drag or a "jump to call" click
    for (const ev of ["mousedown", "pointerdown", "mouseup", "pointerup"])
        btn.addEventListener(ev, e => e.stopPropagation());
    btn.addEventListener("click", e => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
        scheduleUpdate();
    });
    addTooltip(btn, true);
    return btn;
}

function setButton(btn: HTMLButtonElement, icon: keyof typeof ICONS, label: string) {
    if (btn.dataset.icon === icon) return;
    btn.dataset.icon = icon;
    btn.dataset.tooltip = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon]}"/></svg><span></span>`;
    btn.querySelector("span")!.textContent = label;
}

function findNativeControl(scope: Element, ours: Element) {
    for (const el of scope.querySelectorAll("button[aria-label], [role=button][aria-label]")) {
        if (!ours.contains(el) && NATIVE_CONTROL.test(el.getAttribute("aria-label")!)) return el;
    }
    return null;
}

// Put the toolbar's buttons in Discord's own control row, styled like its buttons, when we can find it.
// Otherwise the toolbar floats in floatParent.
function placeBar(bar: HTMLElement, scope: Element | null, floatParent: Element) {
    const control = scope && findNativeControl(scope, bar);
    const buttons = bar.children as HTMLCollectionOf<HTMLButtonElement>;

    if (!control) {
        if (bar.parentElement !== floatParent) floatParent.appendChild(bar);
        bar.removeAttribute(A_INLINE);
        for (const btn of buttons) btn.className = "";
        return false;
    }

    // Discord wraps each control in a tooltip wrapper; go next to the wrapper, not inside it
    const anchor = control.parentElement?.childElementCount === 1 ? control.parentElement : control;
    if (bar.nextElementSibling !== anchor) anchor.before(bar);
    if (!bar.hasAttribute(A_INLINE)) bar.setAttribute(A_INLINE, "");

    const nativeSvg = control.querySelector("svg");
    for (const btn of buttons) {
        if (btn.className !== control.className) btn.className = control.className;
        const svg = btn.querySelector("svg");
        if (svg && nativeSvg) {
            svg.setAttribute("width", nativeSvg.getAttribute("width") ?? "24");
            svg.setAttribute("height", nativeSvg.getAttribute("height") ?? "24");
        }
    }
    return true;
}

function ensureButtons(win: Element, docked: boolean) {
    let bar = win.querySelector<HTMLDivElement>(`[${A_BAR}]`);
    if (!bar) {
        bar = document.createElement("div");
        bar.setAttribute(A_BAR, "");
        bar.append(
            makeButton(() => settings.store.position = settings.store.position === "top" ? "bottom" : "top"),
            makeButton(openFullView),
            makeButton(() => userDocked = !isDocked())
        );
        win.appendChild(bar);
    }
    placeBar(bar, win, win);
    const [posBtn, fullBtn, dockBtn] = bar.children as HTMLCollectionOf<HTMLButtonElement>;
    setButton(fullBtn, "fullView", "Full view");
    if (settings.store.position === "top") setButton(posBtn, "down", "Move to bottom");
    else setButton(posBtn, "up", "Move to top");
    if (docked) setButton(dockBtn, "undock", "Undock to mini player");
    else setButton(dockBtn, "dock", "Dock");
    posBtn.style.display = docked ? "" : "none";
}

function ensureHandle(win: Element, docked: boolean) {
    let handle = win.querySelector<HTMLDivElement>(`[${A_HANDLE}]`);
    if (!handle) {
        handle = document.createElement("div");
        handle.dataset.tooltip = "Drag to resize, double-click to fit the stream";
        addTooltip(handle, false);
        // Keep the popout from dragging itself or jumping to the call
        for (const ev of ["mousedown", "mouseup", "click"])
            handle.addEventListener(ev, e => e.stopPropagation());

        handle.addEventListener("pointerdown", e => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            handle!.setPointerCapture(e.pointerId);
            handle!.setAttribute("data-dragging", "");
            document.body.style.cursor = "ns-resize";
        });
        handle.addEventListener("pointermove", e => {
            if (!handle!.hasPointerCapture(e.pointerId) || !fullHeight) return;
            const height = settings.store.position === "top"
                ? e.clientY - fullTop
                : fullTop + fullHeight - e.clientY;
            dragHeight = clampHeight(height) / fullHeight * 100;
            scheduleUpdate();
        });
        const endDrag = (e: PointerEvent) => {
            e.stopPropagation();
            if (dragHeight != null) settings.store.height = dragHeight;
            dragHeight = null;
            handle!.removeAttribute("data-dragging");
            document.body.style.cursor = "";
        };
        handle.addEventListener("pointerup", endDrag);
        handle.addEventListener("pointercancel", endDrag);
        handle.addEventListener("dblclick", e => {
            e.stopPropagation();
            settings.store.height = undefined;
            scheduleUpdate();
        });
        win.appendChild(handle);
    }
    // The handle sits on the edge facing the rest of Discord
    const edge = settings.store.position === "top" ? "bottom" : "top";
    if (handle.getAttribute(A_HANDLE) !== edge) handle.setAttribute(A_HANDLE, edge);
    handle.style.display = docked ? "" : "none";
}

function clampHeight(height: number) {
    const max = Math.min(fullHeight * MAX_FRACTION, streamHeight);
    return Math.max(Math.min(MIN_HEIGHT, max), Math.min(height, max));
}

function isDocked() {
    return userDocked ?? settings.store.startIn !== "miniPlayer";
}

function observeApp(app: Element | null) {
    if (app === observedApp) return;
    if (observedApp) resizeObserver?.unobserve(observedApp);
    observedApp = app;
    if (app) resizeObserver?.observe(app);
}

// The video's "resize" event fires when the stream's resolution (and so its aspect ratio) is known or changes
function observeVideo(video: HTMLVideoElement | null) {
    if (video === observedVideo) return;
    observedVideo?.removeEventListener("resize", scheduleUpdate);
    observedVideo = video;
    video?.addEventListener("resize", scheduleUpdate);
}

// The stream we're watching (not our own Go Live), if any
function getWatchedStream() {
    const myId = UserStore.getCurrentUser()?.id;
    return ApplicationStreamingStore.getAllActiveStreams().find(s => s.ownerId !== myId) ?? null;
}

function openFullView() {
    const channelId = getWatchedStream()?.channelId ?? SelectedChannelStore.getVoiceChannelId();
    if (channelId) ChannelRouter.transitionToChannel(channelId);
}

function dockFromFullView() {
    if (!lastTextChannelId) return;
    forceDock = true;
    ChannelRouter.transitionToChannel(lastTextChannelId);
}

// Show a Dock button over the call view while it's showing the stream we're watching
function updateCallBar(app: Element | null) {
    const selected = SelectedChannelStore.getChannelId();
    const inFullView = !!lastTextChannelId && isVoiceChannel(selected) && getWatchedStream()?.channelId === selected;
    const callView = inFullView ? document.querySelector(CALL_VIEW) : null;
    const host = inFullView ? callView ?? app : null;

    let bar = document.querySelector<HTMLDivElement>(`[${A_CALL_BAR}]`);
    if (!host) {
        bar?.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement("div");
        bar.setAttribute(A_CALL_BAR, "");
        const btn = makeButton(dockFromFullView);
        setButton(btn, "dock", "Dock stream");
        bar.append(btn);
        document.body.appendChild(bar);
    }
    if (placeBar(bar, callView, document.body)) return;
    const rect = host.getBoundingClientRect();
    bar.style.top = `${Math.round(rect.top + 12)}px`;
    bar.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
}

function update() {
    const win = document.querySelector(PIP_WINDOW);
    const app = document.querySelector(APP_LAYERS);

    if (win !== lastWindow) {
        // New popout (or popout closed): forget the manual toggle
        lastWindow = win;
        userDocked = null;
        if (win && forceDock) {
            userDocked = true;
            forceDock = false;
        }
    }

    observeApp(app);
    updateCallBar(app);
    // mouseleave never fires if Discord removes the element we're hovering
    if (tooltipTarget && !tooltipTarget.isConnected) hideTooltip();

    if (!win) {
        observeVideo(null);
        clearMarks();
        return;
    }

    const video = win.querySelector("video");
    observeVideo(video);

    const docked = isDocked() && !!app;
    ensureButtons(win, docked);
    ensureHandle(win, docked);

    if (!docked) {
        clearMarks();
        return;
    }

    // Undo our own shrinking to get the rect the app layers would have without the stream
    const rect = app!.getBoundingClientRect();
    fullTop = rect.top - (app!.getAttribute(A_APP) === "top" ? appliedHeight : 0);
    fullHeight = rect.height + (app!.hasAttribute(A_APP) ? appliedHeight : 0);

    const aspect = video?.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16;
    const savedHeight = dragHeight ?? settings.store.height;
    streamHeight = rect.width * aspect;
    const wanted = savedHeight ? fullHeight * savedHeight / 100 : streamHeight;
    const height = Math.round(clampHeight(wanted));
    const { position } = settings.store;
    const top = position === "top" ? fullTop : fullTop + fullHeight - height;
    const root = document.documentElement.style;
    root.setProperty("--vc-sd-top", `${Math.round(top)}px`);
    root.setProperty("--vc-sd-left", `${Math.round(rect.left)}px`);
    root.setProperty("--vc-sd-width", `${Math.round(rect.width)}px`);
    root.setProperty("--vc-sd-height", `${height}px`);

    if (!win.hasAttribute(A_WINDOW)) win.setAttribute(A_WINDOW, "");
    for (let el: Element | null = video; el && el !== win; el = el.parentElement)
        if (!el.hasAttribute(A_FILL)) el.setAttribute(A_FILL, "");
    if (app!.getAttribute(A_APP) !== position) {
        document.querySelectorAll(`[${A_APP}]`).forEach(el => el.removeAttribute(A_APP));
        app!.setAttribute(A_APP, position);
    }
    appliedHeight = height;

    // Any transformed ancestor would make position: fixed relative to it instead of the viewport
    const pipRoot = win.closest(PIP_ROOT);
    for (let el = win.parentElement; el && el !== document.body; el = el.parentElement) {
        if (!el.hasAttribute(A_ANCESTOR)) el.setAttribute(A_ANCESTOR, "");
        if (el === pipRoot) break;
    }
}

// The ★ prefix sorts our plugins to the top of the Vencord plugin list
migratePluginSettings("★ StreamDock", "StreamDock");
// Earlier versions had two toggles ("Auto dock" and "Start Stream Docked", once called stayInChat)
const oldSettings = PlainSettings.plugins["★ StreamDock"];
if (oldSettings && !("startIn" in oldSettings) && ["autoDock", "startDocked", "stayInChat"].some(k => k in oldSettings)) {
    const startDocked = oldSettings.startDocked ?? oldSettings.stayInChat ?? true;
    const autoDock = oldSettings.autoDock ?? true;
    Settings.plugins["★ StreamDock"].startIn = !startDocked ? "fullView" : autoDock ? "docked" : "miniPlayer";
}
export default definePlugin({
    name: "★ StreamDock",
    description: "Docks the stream across the top or bottom of the window and moves Discord out of its way, so you can watch and text at the same time",
    authors: [{ name: "chris", id: 0n }],
    settings,

    flux: {
        CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            if (!channelId) return;
            if (!isVoiceChannel(channelId)) {
                lastTextChannelId = channelId;
                return;
            }
            // Watching a stream opens its voice channel's call view; go back to the chat where the popout appears
            if (watchStartedAt && Date.now() - watchStartedAt < WATCH_WINDOW_MS)
                setTimeout(returnToChat, 0);
        },

        STREAM_WATCH({ streamKey }: { streamKey: string; }) {
            if (settings.store.startIn === "fullView") return;
            // streamKey is "guild:<guildId>:<channelId>:<userId>" or "call:<channelId>:<userId>"; skip our own Go Live
            if (streamKey?.split(":").pop() === UserStore.getCurrentUser()?.id) return;
            watchStartedAt = Date.now();
            // If we were already looking at the voice channel there's no CHANNEL_SELECT to react to
            setTimeout(() => {
                if (watchStartedAt && isVoiceChannel(SelectedChannelStore.getChannelId())) returnToChat();
            }, 300);
        }
    },

    start() {
        const current = SelectedChannelStore.getChannelId();
        if (current && !isVoiceChannel(current)) lastTextChannelId = current;

        style = document.createElement("style");
        style.id = "vc-streamdock";
        style.textContent = css;
        document.head.appendChild(style);

        resizeObserver = new ResizeObserver(scheduleUpdate);
        observer = new MutationObserver(scheduleUpdate);
        observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener("resize", scheduleUpdate);
        scheduleUpdate();
    },

    stop() {
        observer?.disconnect();
        resizeObserver?.disconnect();
        observeVideo(null);
        observer = resizeObserver = observedApp = lastWindow = null;
        userDocked = null;
        watchStartedAt = 0;
        dragHeight = null;
        forceDock = false;
        window.removeEventListener("resize", scheduleUpdate);
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;

        clearMarks();
        document.querySelectorAll(`[${A_BAR}], [${A_HANDLE}], [${A_CALL_BAR}]`).forEach(el => el.remove());
        hideTooltip();
        document.body.style.cursor = "";
        for (const v of ["--vc-sd-top", "--vc-sd-left", "--vc-sd-width", "--vc-sd-height"])
            document.documentElement.style.removeProperty(v);
        style?.remove();
        style = null;
    }
});
