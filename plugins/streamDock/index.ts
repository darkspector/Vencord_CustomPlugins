/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { ChannelRouter, ChannelStore, SelectedChannelStore, UserStore } from "@webpack/common";

// Discord's class names are hashed (e.g. "pictureInPictureWindow_a1b2c3"), so match on the prefix.
const PIP_WINDOW = '[class*="pictureInPictureWindow"]';
const PIP_ROOT = '[class*="pictureInPicture_"]';
// Discord's stack of full-window layers (the main UI, settings, ...). Popouts, menus and tooltips live
// in separate layer containers, so shrinking this keeps their positions lined up with the cursor.
const APP_LAYERS = '[class*="layers_"]';

const A_WINDOW = "data-vc-streamdock-window";
const A_ANCESTOR = "data-vc-streamdock-ancestor";
const A_APP = "data-vc-streamdock-app";
const A_BAR = "data-vc-streamdock-bar";

const GUILD_VOICE = 2;
const GUILD_STAGE_VOICE = 13;
// How long after "watch stream" Discord's jump to the call view counts as caused by it
const WATCH_WINDOW_MS = 2000;

const ICONS = {
    undock: "M15 3h6v6h-2V6.41l-7.29 7.3-1.42-1.42L17.59 5H15V3ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
    dock: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v6h14V5H5Z",
    down: "M11 4h2v12.17l5.59-5.58L20 12l-8 8-8-8 1.41-1.41L11 16.17V4Z",
    up: "M13 20h-2V7.83l-5.59 5.58L4 12l8-8 8 8-1.41 1.41L13 7.83V20Z"
};

const settings = definePluginSettings({
    autoDock: {
        type: OptionType.BOOLEAN,
        description: "Automatically dock the stream popout when it appears",
        default: true
    },
    stayInChat: {
        type: OptionType.BOOLEAN,
        description: "When you start watching a stream, stay in your text channel with the stream docked instead of opening the full call view",
        default: true
    },
    position: {
        type: OptionType.SELECT,
        description: "Whether the stream docks at the top or bottom of the window",
        options: [
            { label: "Top", value: "top", default: true },
            { label: "Bottom", value: "bottom" }
        ],
        onChange: () => scheduleUpdate()
    },
    maxHeight: {
        type: OptionType.SLIDER,
        description: "The stream fills the window width at its own aspect ratio, up to this much of the window height (%)",
        markers: makeRange(30, 90, 10),
        default: 70,
        stickToMarkers: false,
        onChange: () => scheduleUpdate()
    }
});

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
[${A_WINDOW}] > div {
    width: 100% !important;
    height: 100% !important;
}
[${A_WINDOW}] video {
    width: 100% !important;
    height: 100% !important;
    object-fit: contain !important;
}
[${A_APP}] {
    height: calc(100% - var(--vc-sd-height)) !important;
    max-height: calc(100% - var(--vc-sd-height)) !important;
}
[${A_APP}="top"] {
    margin-top: var(--vc-sd-height) !important;
}
[${A_BAR}] {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 10;
    display: flex;
    gap: 2px;
    padding: 4px;
    border-radius: 8px;
    background: rgba(17, 18, 20, 0.9);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    opacity: 0;
    transition: opacity 0.15s;
}
${PIP_WINDOW}:hover [${A_BAR}], [${A_BAR}]:focus-within {
    opacity: 1;
}
[${A_BAR}] button {
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
[${A_BAR}] button:hover {
    color: #fff;
    background: #5865f2;
}
[${A_BAR}] button:active {
    background: #4752c4;
}
[${A_BAR}] button:focus-visible {
    outline: 2px solid #00a8fc;
    outline-offset: 1px;
}
[${A_BAR}] svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
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
// null = follow autoDock; otherwise the user's explicit choice for the current popout
let userDocked: boolean | null = null;
let lastWindow: Element | null = null;
// Last non-voice channel the user was looking at, to return to when they start watching a stream
let lastTextChannelId: string | null = null;
let watchStartedAt = 0;

function scheduleUpdate() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
        rafId = 0;
        update();
    });
}

function clearMarks() {
    for (const attr of [A_WINDOW, A_ANCESTOR, A_APP])
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
    return btn;
}

function setButton(btn: HTMLButtonElement, icon: keyof typeof ICONS, label: string) {
    if (btn.dataset.icon === icon) return;
    btn.dataset.icon = icon;
    btn.title = label;
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon]}"/></svg><span></span>`;
    btn.querySelector("span")!.textContent = label;
}

function ensureButtons(win: Element, docked: boolean) {
    let bar = win.querySelector<HTMLDivElement>(`[${A_BAR}]`);
    if (!bar) {
        bar = document.createElement("div");
        bar.setAttribute(A_BAR, "");
        bar.append(
            makeButton(() => settings.store.position = settings.store.position === "top" ? "bottom" : "top"),
            makeButton(() => userDocked = !isDocked())
        );
        win.appendChild(bar);
    }
    const [posBtn, dockBtn] = bar.children as HTMLCollectionOf<HTMLButtonElement>;
    if (settings.store.position === "top") setButton(posBtn, "down", "Move to bottom");
    else setButton(posBtn, "up", "Move to top");
    if (docked) setButton(dockBtn, "undock", "Undock");
    else setButton(dockBtn, "dock", "Dock");
    posBtn.style.display = docked ? "" : "none";
}

function isDocked() {
    return userDocked ?? settings.store.autoDock;
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

function update() {
    const win = document.querySelector(PIP_WINDOW);
    const app = document.querySelector(APP_LAYERS);

    if (win !== lastWindow) {
        // New popout (or popout closed): forget the manual toggle
        lastWindow = win;
        userDocked = null;
    }

    observeApp(app);

    if (!win) {
        observeVideo(null);
        clearMarks();
        return;
    }

    const video = win.querySelector("video");
    observeVideo(video);

    const docked = isDocked() && !!app;
    ensureButtons(win, docked);

    if (!docked) {
        clearMarks();
        return;
    }

    // Undo our own shrinking to get the rect the app layers would have without the stream
    const rect = app!.getBoundingClientRect();
    const fullTop = rect.top - (app!.getAttribute(A_APP) === "top" ? appliedHeight : 0);
    const fullHeight = rect.height + (app!.hasAttribute(A_APP) ? appliedHeight : 0);

    const aspect = video?.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16;
    const height = Math.round(Math.min(rect.width * aspect, fullHeight * settings.store.maxHeight / 100));
    const { position } = settings.store;
    const top = position === "top" ? fullTop : fullTop + fullHeight - height;
    const root = document.documentElement.style;
    root.setProperty("--vc-sd-top", `${Math.round(top)}px`);
    root.setProperty("--vc-sd-left", `${Math.round(rect.left)}px`);
    root.setProperty("--vc-sd-width", `${Math.round(rect.width)}px`);
    root.setProperty("--vc-sd-height", `${height}px`);

    if (!win.hasAttribute(A_WINDOW)) win.setAttribute(A_WINDOW, "");
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
            // Watching a stream opens its voice channel's call view; go back to the chat with the stream docked
            if (watchStartedAt && Date.now() - watchStartedAt < WATCH_WINDOW_MS)
                setTimeout(returnToChat, 0);
        },

        STREAM_WATCH({ streamKey }: { streamKey: string; }) {
            if (!settings.store.stayInChat) return;
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
        window.removeEventListener("resize", scheduleUpdate);
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;

        clearMarks();
        document.querySelectorAll(`[${A_BAR}]`).forEach(el => el.remove());
        for (const v of ["--vc-sd-top", "--vc-sd-left", "--vc-sd-width", "--vc-sd-height"])
            document.documentElement.style.removeProperty(v);
        style?.remove();
        style = null;
    }
});
