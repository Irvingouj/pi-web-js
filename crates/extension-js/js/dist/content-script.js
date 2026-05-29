"use strict";
// Content script for JS Notebook extension
// Runs in isolated world, handles tab.* operations via chrome.runtime.onMessage.
Object.defineProperty(exports, "__esModule", { value: true });
const __LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };
let __logLevel = 3; // default "error"
const logger = {
    debug: (...args) => {
        if (__logLevel <= 0)
            console.log(...args);
    },
    info: (...args) => {
        if (__logLevel <= 1)
            console.log(...args);
    },
    warn: (...args) => {
        if (__logLevel <= 2)
            console.warn(...args);
    },
    error: (...args) => {
        if (__logLevel <= 3)
            console.error(...args);
    },
};
window.__jsNotebookSetLogLevel = (level) => {
    __logLevel = __LOG_LEVELS[level] ?? 3;
};
if (window.__jsNotebookContentScriptInjected) {
    throw new Error("Content script already injected");
}
window.__jsNotebookContentScriptInjected = true;
function getElementByRefId(refId) {
    return document.querySelector(`[data-ref-id='${CSS.escape(String(refId))}']`);
}
function findElementByLabel(query) {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery)
        return null;
    const all = Array.from(document.querySelectorAll('input, textarea, select, button, a, [role="button"], [role="link"]'));
    for (const el of all) {
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel && ariaLabel.toLowerCase().trim() === lowerQuery)
            return el;
        const placeholder = el.placeholder;
        if (placeholder && placeholder.toLowerCase().trim() === lowerQuery)
            return el;
        const id = el.id;
        if (id) {
            const label = document.querySelector(`label[for='${CSS.escape(id)}']`);
            if (label && label.textContent?.trim().toLowerCase() === lowerQuery)
                return el;
        }
        const parentLabel = el.closest("label");
        if (parentLabel &&
            parentLabel.textContent?.trim().toLowerCase() === lowerQuery)
            return el;
        const text = el.textContent?.trim().toLowerCase() || "";
        if (text === lowerQuery)
            return el;
    }
    return null;
}
function findCandidateLabels(query) {
    const lowerQuery = query.toLowerCase().trim();
    const candidates = new Set();
    const all = Array.from(document.querySelectorAll('input, textarea, select, button, a, [role="button"], [role="link"]'));
    for (const el of all) {
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel)
            candidates.add(ariaLabel.trim());
        const placeholder = el.placeholder;
        if (placeholder)
            candidates.add(placeholder.trim());
        const text = el.textContent?.trim() || "";
        if (text)
            candidates.add(text);
    }
    return Array.from(candidates)
        .filter((c) => c.toLowerCase().includes(lowerQuery))
        .slice(0, 5);
}
function asRecord(obj) {
    return typeof obj === "object" && obj !== null && !Array.isArray(obj)
        ? obj
        : {};
}
function getStringParam(params, key) {
    const val = asRecord(params)[key];
    return typeof val === "string" ? val : "";
}
function getNumberParam(params, key, fallback) {
    const val = asRecord(params)[key];
    return typeof val === "number" ? val : fallback;
}
function getAccessibleRole(el) {
    const tag = el.tagName.toLowerCase();
    const ariaRole = el.getAttribute("role");
    if (ariaRole)
        return ariaRole;
    if (tag === "button" ||
        (tag === "input" && el.type === "submit"))
        return "button";
    if (tag === "a")
        return "link";
    if (tag === "input") {
        const type = el.type;
        if (type === "text" ||
            type === "email" ||
            type === "password" ||
            type === "search")
            return "textbox";
        if (type === "checkbox")
            return "checkbox";
        if (type === "radio")
            return "radio";
        if (type === "submit" || type === "button")
            return "button";
    }
    if (tag === "textarea")
        return "textbox";
    if (tag === "select")
        return "combobox";
    if (tag === "img")
        return "img";
    if (tag === "h1" ||
        tag === "h2" ||
        tag === "h3" ||
        tag === "h4" ||
        tag === "h5" ||
        tag === "h6")
        return "heading";
    if (tag === "li")
        return "listitem";
    if (tag === "ul" || tag === "ol")
        return "list";
    if (tag === "table")
        return "table";
    if (tag === "tr")
        return "row";
    if (tag === "td" || tag === "th")
        return "cell";
    if (tag === "nav")
        return "navigation";
    if (tag === "main")
        return "main";
    if (tag === "article")
        return "article";
    if (tag === "section")
        return "region";
    if (tag === "aside")
        return "complementary";
    if (tag === "form")
        return "form";
    if (tag === "dialog" || tag === "modal")
        return "dialog";
    if (tag === "figure")
        return "figure";
    if (tag === "figcaption")
        return "caption";
    if (el.getAttribute("onclick") || el.onclick)
        return "button";
    return "generic";
}
function getAccessibleName(el) {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel)
        return ariaLabel;
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        if (labelEl)
            return labelEl.textContent?.slice(0, 60) || "";
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "img") {
        const alt = el.getAttribute("alt");
        if (alt)
            return alt;
    }
    const title = el.title;
    if (title)
        return title;
    const role = getAccessibleRole(el);
    if (role !== "generic" &&
        role !== "list" &&
        role !== "table" &&
        role !== "row" &&
        role !== "region" &&
        role !== "navigation" &&
        role !== "main") {
        const text = el.textContent?.trim().slice(0, 60) || "";
        return text;
    }
    return "";
}
function shouldInclude(el) {
    const role = getAccessibleRole(el);
    if (role === "generic")
        return false;
    if (role === "presentation" || role === "none")
        return false;
    if (el.hidden)
        return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden")
        return false;
    return true;
}
function inlineSnapshot(maxNodes) {
    let nextRefId = 1;
    const nodes = [];
    const lines = [];
    function traverse(el, depth) {
        if (nodes.length >= maxNodes)
            return;
        const tag = el.tagName.toLowerCase();
        if (tag === "script" ||
            tag === "style" ||
            tag === "noscript" ||
            tag === "template")
            return;
        const included = shouldInclude(el);
        let currentDepth = depth;
        if (included) {
            const refId = nextRefId++;
            el.setAttribute("data-ref-id", String(refId));
            const role = getAccessibleRole(el);
            const name = getAccessibleName(el);
            const node = { refId, role, tag };
            if (name)
                node.name = name;
            nodes.push(node);
            const indent = "  ".repeat(depth);
            const parts = [`${indent}- ${role}`];
            if (name)
                parts.push(`"${name.replace(/"/g, '\\"')}"`);
            parts.push(`[ref=${refId}]`);
            lines.push(parts.join(" "));
            currentDepth = depth + 1;
        }
        for (const child of el.children) {
            traverse(child, currentDepth);
        }
    }
    if (document.body) {
        traverse(document.body, 0);
    }
    const header = [
        `URL: ${window.location.href}`,
        `Title: ${document.title}`,
        "",
    ];
    return {
        text: header.concat(lines).join("\n"),
        nodes,
        url: window.location.href,
        title: document.title,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
        },
    };
}
const handlers = {
    click: (params) => {
        const refId = getStringParam(params, "refId");
        const label = getStringParam(params, "label");
        let el = refId ? getElementByRefId(refId) : null;
        if (!el && label) {
            el = findElementByLabel(label);
        }
        if (!el) {
            const query = label || refId;
            const candidates = query ? findCandidateLabels(query) : [];
            throw new Error(`Element not found${query ? ` by label: "${query}"` : ""}. Candidates: ${candidates.join(", ") || "none"}`);
        }
        el.click();
        return null;
    },
    fill: (params) => {
        const refId = getStringParam(params, "refId");
        const label = getStringParam(params, "label");
        const value = getStringParam(params, "value");
        let el = refId ? getElementByRefId(refId) : null;
        if (!el && label) {
            el = findElementByLabel(label);
        }
        if (!el) {
            const query = label || refId;
            const candidates = query ? findCandidateLabels(query) : [];
            throw new Error(`Element not found${query ? ` by label: "${query}"` : ""}. Candidates: ${candidates.join(", ") || "none"}`);
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value = value;
            const ev = new InputEvent("input", { bubbles: true });
            el.dispatchEvent(ev);
            return null;
        }
        throw new Error("Element is not an input");
    },
    type: (params) => {
        const refId = getStringParam(params, "refId");
        const label = getStringParam(params, "label");
        const text = getStringParam(params, "text");
        let el = refId ? getElementByRefId(refId) : null;
        if (!el && label) {
            el = findElementByLabel(label);
        }
        if (!el) {
            const query = label || refId;
            const candidates = query ? findCandidateLabels(query) : [];
            throw new Error(`Element not found${query ? ` by label: "${query}"` : ""}. Candidates: ${candidates.join(", ") || "none"}`);
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value = text;
            const ev = new InputEvent("input", { bubbles: true });
            el.dispatchEvent(ev);
            return null;
        }
        throw new Error("Element is not an input");
    },
    append: (params) => {
        const refId = getStringParam(params, "refId");
        const label = getStringParam(params, "label");
        const text = getStringParam(params, "text");
        let el = refId ? getElementByRefId(refId) : null;
        if (!el && label) {
            el = findElementByLabel(label);
        }
        if (!el) {
            const query = label || refId;
            const candidates = query ? findCandidateLabels(query) : [];
            throw new Error(`Element not found${query ? ` by label: "${query}"` : ""}. Candidates: ${candidates.join(", ") || "none"}`);
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value += text;
            const ev = new InputEvent("input", { bubbles: true });
            el.dispatchEvent(ev);
            return null;
        }
        throw new Error("Element is not an input");
    },
    press: (params) => {
        const key = getStringParam(params, "key");
        const evDown = new KeyboardEvent("keydown", { key, bubbles: true });
        document.dispatchEvent(evDown);
        const evUp = new KeyboardEvent("keyup", { key, bubbles: true });
        document.dispatchEvent(evUp);
        return null;
    },
    select: (params) => {
        const refId = getStringParam(params, "refId");
        const value = getStringParam(params, "value");
        const el = refId ? getElementByRefId(refId) : null;
        if (!el)
            throw new Error(`Element ${refId} not found`);
        if (el instanceof HTMLSelectElement) {
            el.value = value;
            return null;
        }
        throw new Error("Element is not a select");
    },
    check: (params) => {
        const refId = getStringParam(params, "refId");
        const checked = (() => {
            const obj = asRecord(params);
            return typeof obj.checked === "boolean" ? obj.checked : true;
        })();
        const el = refId ? getElementByRefId(refId) : null;
        if (!el)
            throw new Error(`Element ${refId} not found`);
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
            el.checked = checked;
            return null;
        }
        throw new Error("Element is not a checkbox");
    },
    hover: (params) => {
        const refId = getStringParam(params, "refId");
        const el = refId ? getElementByRefId(refId) : null;
        if (!el)
            throw new Error(`Element ${refId} not found`);
        const ev = new MouseEvent("mouseenter", { bubbles: true });
        el.dispatchEvent(ev);
        return null;
    },
    unhover: () => {
        const ev = new MouseEvent("mouseleave", { bubbles: true });
        document.body.dispatchEvent(ev);
        return null;
    },
    scroll: (params) => {
        const obj = asRecord(params);
        const direction = obj.direction ?? "down";
        const amount = typeof obj.amount === "number" ? obj.amount : 300;
        window.scrollBy({
            top: direction === "down" ? amount : -amount,
            behavior: "smooth",
        });
        return true;
    },
    dblclick: (params) => {
        const refId = getStringParam(params, "refId");
        const el = refId ? getElementByRefId(refId) : null;
        if (!el)
            throw new Error(`Element ${refId} not found`);
        const ev = new MouseEvent("dblclick", { bubbles: true });
        el.dispatchEvent(ev);
        return null;
    },
    forward: () => {
        window.history.forward();
        return true;
    },
    reload: () => {
        window.location.reload();
        return true;
    },
    scrollTo: (params) => {
        const refId = getStringParam(params, "refId");
        const x = getNumberParam(params, "x", 0);
        const y = getNumberParam(params, "y", 0);
        if (refId) {
            const el = getElementByRefId(refId);
            if (el) {
                el.scrollIntoView({ behavior: "smooth" });
                return true;
            }
            throw new Error(`Element ${refId} not found`);
        }
        window.scrollTo({ top: y, left: x, behavior: "smooth" });
        return true;
    },
    evaluate: (params) => {
        const code = getStringParam(params, "code");
        if (typeof code !== "string") {
            throw new Error("evaluate requires a string argument");
        }
        // Use new Function to avoid capturing local scope (marginally safer than eval)
        return new Function(code)();
    },
    back: () => {
        window.history.back();
        return true;
    },
    ping: () => {
        return { ok: true };
    },
    snapshot: async (params) => {
        const obj = asRecord(params);
        const maxNodes = typeof obj.max_nodes === "number" ? obj.max_nodes : 500;
        logger.debug("[content-script] snapshot called, maxNodes:", maxNodes, "document.body:", !!document.body);
        const r = inlineSnapshot(maxNodes);
        logger.debug("[content-script] snapshot result nodes:", r.nodes.length);
        return r;
    },
    fetch: async (params) => {
        const obj = asRecord(params);
        const url = obj.url;
        const method = (obj.method || "GET").toString().toUpperCase();
        const headers = obj.headers || {};
        const body = obj.body ?? null;
        const timeout = typeof obj.timeout === "number" ? obj.timeout : 30_000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout || 30_000);
        try {
            const fetchOpts = {
                method: method || "GET",
                headers: typeof headers === "object" && headers !== null
                    ? headers
                    : {},
                signal: controller.signal,
            };
            if (body !== null && body !== undefined) {
                fetchOpts.body = typeof body === "string" ? body : String(body);
            }
            const resp = await fetch(url, fetchOpts);
            clearTimeout(timeoutId);
            const text = await resp.text();
            return {
                status: resp.status,
                ok: resp.ok,
                headers: Object.fromEntries(resp.headers.entries()),
                body: text,
            };
        }
        catch (e) {
            clearTimeout(timeoutId);
            throw e;
        }
    },
};
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    const action = request?.action;
    logger.debug("[content-script] received action:", action, "params:", request?.params);
    const handler = handlers[action];
    if (!handler) {
        logger.debug("[content-script] no handler for action:", action);
        sendResponse({
            ok: false,
            error: `Unknown content script action: ${action}`,
        });
        return false;
    }
    try {
        const result = handler(request?.params);
        if (result instanceof Promise) {
            result
                .then((value) => {
                logger.debug("[content-script] async response for", action, ":", typeof value);
                sendResponse(value);
            })
                .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                logger.debug("[content-script] async error for", action, ":", msg);
                sendResponse({ ok: false, error: msg || String(err) });
            });
            return true;
        }
        logger.debug("[content-script] sync response for", action, ":", typeof result);
        sendResponse(result);
        return false;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug("[content-script] sync error for", action, ":", msg);
        sendResponse({ ok: false, error: msg || String(err) });
        return false;
    }
});
