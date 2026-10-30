/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import definePlugin, { makeRange, OptionType } from "@utils/types";

// Discord's class names are hashed (e.g. "pictureInPictureWindow_a1b2c3"), so match on the prefix.
const PIP_WINDOW = '[class*="pictureInPictureWindow"]';
const PIP_ROOT = '[class*="pictureInPicture_"]';
const CHAT = '[class*="chatContent"]';

const A_WINDOW = "data-vc-streamdock-window";
const A_ANCESTOR = "data-vc-streamdock-ancestor";
const A_CHAT = "data-vc-streamdock-chat";
const A_BAR = "data-vc-streamdock-bar";

const settings = definePluginSettings({
    autoDock: {
        type: OptionType.BOOLEAN,
        description: "Automatically dock the stream popout into the chat when it appears",
        default: true
    },
    position: {
        type: OptionType.SELECT,
        description: "Where in the chat the stream docks",
        options: [
            { label: "Top", value: "top", default: true },
            { label: "Bottom", value: "bottom" }
        ],
        onChange: () => scheduleUpdate()
    },
    ratio: {
        type: OptionType.SLIDER,
        description: "How much of the chat height the stream takes (%)",
        markers: makeRange(20, 80, 10),
        default: 50,
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
[${A_CHAT}] {
    box-sizing: border-box !important;
}
[${A_CHAT}="top"] {
    padding-top: var(--vc-sd-height) !important;
}
[${A_CHAT}="bottom"] {
    padding-bottom: var(--vc-sd-height) !important;
}
[${A_BAR}] {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 10;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s;
}
[${A_BAR}] button {
    padding: 4px 8px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
    cursor: pointer;
}
[${A_BAR}] button:hover {
    background: rgba(0, 0, 0, 0.8);
}
${PIP_WINDOW}:hover [${A_BAR}] {
    opacity: 1;
}
`;

let style: HTMLStyleElement | null = null;
let observer: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let observedChat: Element | null = null;
let rafId = 0;
// null = follow autoDock; otherwise the user's explicit choice for the current popout
let userDocked: boolean | null = null;
let lastWindow: Element | null = null;

function scheduleUpdate() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
        rafId = 0;
        update();
    });
}

function clearMarks() {
    for (const attr of [A_WINDOW, A_ANCESTOR, A_CHAT])
        document.querySelectorAll(`[${attr}]`).forEach(el => el.removeAttribute(attr));
}

function makeButton(onClick: () => void) {
    const btn = document.createElement("button");
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

function setText(el: HTMLElement, text: string) {
    if (el.textContent !== text) el.textContent = text;
}

function ensureButtons(win: Element, docked: boolean) {
    let bar = win.querySelector<HTMLDivElement>(`[${A_BAR}]`);
    if (!bar) {
        bar = document.createElement("div");
        bar.setAttribute(A_BAR, "");
        bar.append(
            makeButton(() => userDocked = !isDocked()),
            makeButton(() => settings.store.position = settings.store.position === "top" ? "bottom" : "top")
        );
        win.appendChild(bar);
    }
    const [dockBtn, posBtn] = bar.children as HTMLCollectionOf<HTMLButtonElement>;
    setText(dockBtn, docked ? "Undock" : "Dock to chat");
    setText(posBtn, settings.store.position === "top" ? "↓ Move to bottom" : "↑ Move to top");
    posBtn.style.display = docked ? "" : "none";
}

function isDocked() {
    return userDocked ?? settings.store.autoDock;
}

function observeChat(chat: Element | null) {
    if (chat === observedChat) return;
    if (observedChat) resizeObserver?.unobserve(observedChat);
    observedChat = chat;
    if (chat) resizeObserver?.observe(chat);
}

function update() {
    const win = document.querySelector(PIP_WINDOW);
    const chat = document.querySelector(CHAT);

    if (win !== lastWindow) {
        // New popout (or popout closed): forget the manual toggle
        lastWindow = win;
        userDocked = null;
    }

    observeChat(chat);

    if (!win) {
        clearMarks();
        return;
    }

    const docked = isDocked() && !!chat;
    ensureButtons(win, docked);

    if (!docked) {
        clearMarks();
        return;
    }

    // Measure before applying our padding would matter: padding is inside a border-box, so the outer rect is stable
    const rect = chat!.getBoundingClientRect();
    const height = Math.round(rect.height * settings.store.ratio / 100);
    const { position } = settings.store;
    const top = position === "top" ? rect.top : rect.bottom - height;
    const root = document.documentElement.style;
    root.setProperty("--vc-sd-top", `${Math.round(top)}px`);
    root.setProperty("--vc-sd-left", `${Math.round(rect.left)}px`);
    root.setProperty("--vc-sd-width", `${Math.round(rect.width)}px`);
    root.setProperty("--vc-sd-height", `${height}px`);

    if (!win.hasAttribute(A_WINDOW)) win.setAttribute(A_WINDOW, "");
    if (chat!.getAttribute(A_CHAT) !== position) {
        document.querySelectorAll(`[${A_CHAT}]`).forEach(el => el.removeAttribute(A_CHAT));
        chat!.setAttribute(A_CHAT, position);
    }

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
    description: "Docks the stream popout into the top part of the chat so you can watch and text at the same time",
    authors: [{ name: "chris", id: 0n }],
    settings,

    start() {
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
        observer = resizeObserver = observedChat = lastWindow = null;
        userDocked = null;
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
