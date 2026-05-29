/// <reference types="chrome" />
// Main-thread command executor for extension-js runner
// Handles all commands relayed from the extension Worker.

import {
  collectDocument,
  formatSnapshot,
  init as initDomSnapshot,
  type TreeSnapshot,
} from "@pi-oxide/dom-semantic-tree";
import { logger } from "./logger.js";

let domSnapshotReady: Promise<void> | null = null;

function ensureDomSnapshot(): Promise<void> {
  if (!domSnapshotReady) {
    domSnapshotReady = initDomSnapshot();
  }
  return domSnapshotReady;
}

// ─── Runner lifecycle abort signal ───────────────────────────────

let runnerAbortController: AbortController | null = null;

export function setRunnerAbortController(controller: AbortController | null) {
  runnerAbortController = controller;
}

function getRunnerSignal(): AbortSignal | undefined {
  return runnerAbortController?.signal;
}

function throwIfAborted(): void {
  const signal = getRunnerSignal();
  if (signal?.aborted) {
    throw new Error("Runner aborted: ExtensionSession stopped");
  }
}

// ─── Generated types from Rust ts-rs ───────────────────────────

import type {
  DomSnapshotParams,
  FetchParams,
  PageCheckParams,
  PageExtractParams,
  PageFillParams,
  PageFindParams,
  PageGotoParams,
  PagePressParams,
  PageScrollParams,
  PageSelectParams,
  PageTypeParams,
  PageWaitForParams,
  PageWaitParams,
  SleepParams,
  StorageDeleteParams,
  StorageGetParams,
  StorageSetParams,
} from "./generated.js";

declare global {
  interface Window {
    __hostHandlers?: Record<string, HostHandler>;
  }
}

// ─── Types ─────────────────────────────────────────────────────

type HostHandler<T = unknown, R = unknown> = (params: T) => Promise<R>;

export interface Command {
  action: string;
  params: unknown;
}

// ─── Shared response types ─────────────────────────────────────

type AsyncError = {
  message: string;
  code: string;
  category?: string;
};

type AsyncResponse<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: AsyncError };

type FetchValue = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
};

type DomSnapshotValue = {
  data: TreeSnapshot;
  text: string;
};

type TabMessage =
  | { action: "click"; params: { refId?: string; label?: string } }
  | {
      action: "fill";
      params: { refId?: string; value: string; label?: string };
    }
  | { action: "type"; params: { refId?: string; text: string; label?: string } }
  | {
      action: "append";
      params: { refId?: string; text: string; label?: string };
    }
  | { action: "press"; params: { key: string } }
  | { action: "select"; params: { refId: string; value: string } }
  | { action: "check"; params: { refId: string; checked: boolean } }
  | { action: "hover"; params: { refId: string } }
  | { action: "unhover"; params: Record<string, never> }
  | { action: "scroll"; params: { direction: string; amount: number } }
  | { action: "scrollTo"; params: { x: number; y: number; refId?: string } }
  | { action: "dblclick"; params: { refId: string } }
  | { action: "back"; params: Record<string, never> };

type DomNode = {
  refId: number;
  role: string;
  tag: string;
  name?: string;
};

type SnapshotFormat = "compact-text" | "json" | "json-pretty";

type DomFormatParams = {
  snapshot: TreeSnapshot;
  format?: SnapshotFormat;
};

// ─── Host handler registry ─────────────────────────────────────

const hostHandlers: Record<string, HostHandler> = {};

export function registerHostHandler<T, R>(
  action: string,
  handler: (params: T) => Promise<R>,
) {
  hostHandlers[action] = handler as HostHandler;
}

export function registerHostHandlers(handlers: Record<string, HostHandler>) {
  Object.assign(hostHandlers, handlers);
}

// ─── Typed params helper ───────────────────────────────────────

function expectParams<T>(params: unknown): T {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error(
      `Expected params object, got ${params === null ? "null" : Array.isArray(params) ? "array" : typeof params}`,
    );
  }
  return params as T;
}

// ─── Helpers for extracting values from unknown params ─────────

function asRecord(params: unknown): Record<string, unknown> {
  return typeof params === "object" && params !== null && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function extractTabId(params: unknown): number | null {
  if (Array.isArray(params)) {
    const first = params[0];
    if (typeof first === "number") return first;
    const firstObj = asRecord(first);
    if (typeof firstObj.id === "number") return firstObj.id;
    if (typeof firstObj.tabId === "number") return firstObj.tabId;
    if (typeof firstObj.tab_id === "number") return firstObj.tab_id;
    return null;
  }
  if (typeof params === "number") return params;
  const obj = asRecord(params);
  if (typeof obj.id === "number") return obj.id;
  const tabId = obj.tabId ?? obj.tab_id;
  return typeof tabId === "number" ? tabId : null;
}

function extractArg<T>(params: unknown, index: number, fallback?: T): T {
  if (Array.isArray(params)) return (params[index] ?? fallback) as T;
  if (typeof params === "object" && params !== null) return fallback as T;
  if (index === 0) return params as T;
  return fallback as T;
}

function _getStringParam(params: unknown, key: string): string {
  const val = asRecord(params)[key];
  return typeof val === "string" ? val : "";
}

function _getNumberParam(
  params: unknown,
  key: string,
  fallback: number,
): number {
  const val = asRecord(params)[key];
  return typeof val === "number" ? val : fallback;
}

// ─── Main command dispatcher ─────────────────────────────────────

export async function executeMainThreadCommand(
  command: Command,
): Promise<AsyncResponse> {
  const params = command.params;
  switch (command.action) {
    case "storage_get": {
      try {
        const { key } = expectParams<StorageGetParams>(params);
        const value = localStorage.getItem(key);
        return { ok: true, value };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: { message, code: "ESTORAGE", category: "storage" },
        };
      }
    }
    case "storage_set": {
      try {
        const { key, value } = expectParams<StorageSetParams>(params);
        localStorage.setItem(key, value);
        return { ok: true, value: null };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: { message, code: "ESTORAGE", category: "storage" },
        };
      }
    }
    case "storage_delete": {
      try {
        const { key } = expectParams<StorageDeleteParams>(params);
        localStorage.removeItem(key);
        return { ok: true, value: null };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: { message, code: "ESTORAGE", category: "storage" },
        };
      }
    }
    case "storage_list": {
      try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) keys.push(key);
        }
        return { ok: true, value: keys };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: { message, code: "ESTORAGE", category: "storage" },
        };
      }
    }
    case "clipboard_read": {
      try {
        const text = await navigator.clipboard.readText();
        return { ok: true, value: text };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: { message, code: "ECLIPBOARD", category: "permission" },
        };
      }
    }
    case "clipboard_write": {
      try {
        let text = "";
        if (Array.isArray(params)) {
          const first = params[0];
          if (typeof first === "object" && first !== null) {
            text = String((first as Record<string, unknown>).text ?? first);
          } else {
            text = String(first);
          }
        } else {
          const obj = asRecord(params);
          text = (obj.text as string) || (obj.value as string) || "";
        }
        await navigator.clipboard.writeText(text);
        return { ok: true, value: null };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: { message, code: "ECLIPBOARD", category: "permission" },
        };
      }
    }
    case "fetch": {
      return handleFetch(expectParams<FetchParams>(params));
    }
    case "sleep": {
      const { duration } = expectParams<SleepParams>(params);
      await new Promise((resolve) => setTimeout(resolve, Number(duration)));
      return { ok: true, value: null };
    }
    case "page_url": {
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      return executeInTab(activeTab, () => window.location.href, []);
    }
    case "page_title": {
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      return executeInTab(activeTab, () => document.title, []);
    }
    case "page_goto": {
      const { url } = expectParams<PageGotoParams>(params);
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      return handleChromeApi({
        action: "chrome_tabs_update",
        params: { tabId: activeTab, update: { url } },
      });
    }
    case "page_back": {
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      return sendMessageToTab(activeTab, { action: "back", params: {} });
    }
    case "page_forward": {
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      return executeInTab(activeTab, () => {
        window.history.forward();
        return true;
      }, []);
    }
    case "page_reload": {
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      return handleChromeApi({
        action: "chrome_tabs_reload",
        params: { tabId: activeTab },
      });
    }
    case "page_wait": {
      const { duration } = expectParams<PageWaitParams>(params);
      await new Promise((resolve) => setTimeout(resolve, Number(duration)));
      return { ok: true, value: true };
    }
    case "page_click": {
      const activeTab = getActiveTabId();
      const obj = asRecord(params);
      const refId = extractRefId(params);
      const label = obj.label ?? "";
      if (!refId && !label) {
        return {
          ok: false,
          error: {
            message: "page_click requires refId or label",
            code: "E_MISSING_PARAM",
          },
        };
      }
      return sendMessageToTab(activeTab, {
        action: "click",
        params: { refId, label: String(label) },
      });
    }
    case "page_fill": {
      const activeTab = getActiveTabId();
      const obj = asRecord(params);
      const refId = extractRefId(params);
      const value = obj.value ?? "";
      const label = obj.label ?? "";
      if (!refId && !label) {
        return {
          ok: false,
          error: {
            message: "page_fill requires refId or label",
            code: "E_MISSING_PARAM",
          },
        };
      }
      return sendMessageToTab(activeTab, {
        action: "fill",
        params: { refId, label: String(label), value: String(value) },
      });
    }
    case "page_type": {
      const activeTab = getActiveTabId();
      const obj = asRecord(params);
      const refId = extractRefId(params);
      const text = obj.text ?? "";
      const label = obj.label ?? "";
      if (!refId && !label) {
        return {
          ok: false,
          error: {
            message: "page_type requires refId or label",
            code: "E_MISSING_PARAM",
          },
        };
      }
      return sendMessageToTab(activeTab, {
        action: "type",
        params: { refId, label: String(label), text: String(text) },
      });
    }
    case "page_append": {
      const activeTab = getActiveTabId();
      const obj = asRecord(params);
      const refId = extractRefId(params);
      const text = obj.text ?? "";
      const label = obj.label ?? "";
      if (!refId && !label) {
        return {
          ok: false,
          error: {
            message: "page_append requires refId or label",
            code: "E_MISSING_PARAM",
          },
        };
      }
      return sendMessageToTab(activeTab, {
        action: "append",
        params: { refId, label: String(label), text: String(text) },
      });
    }
    case "page_press": {
      const activeTab = getActiveTabId();
      const { key } = expectParams<PagePressParams>(params);
      return sendMessageToTab(activeTab, { action: "press", params: { key } });
    }
    case "page_select": {
      const activeTab = getActiveTabId();
      const obj = asRecord(params);
      const refId = extractRefId(params);
      const value = obj.value ?? "";
      if (!refId) {
        return {
          ok: false,
          error: {
            message: "page_select requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      }
      return sendMessageToTab(activeTab, {
        action: "select",
        params: { refId, value: String(value) },
      });
    }
    case "page_check": {
      const activeTab = getActiveTabId();
      const obj = asRecord(params);
      const refId = extractRefId(params);
      const checked = typeof obj.checked === "boolean" ? obj.checked : true;
      if (!refId) {
        return {
          ok: false,
          error: {
            message: "page_check requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      }
      return sendMessageToTab(activeTab, {
        action: "check",
        params: { refId, checked },
      });
    }
    case "page_hover": {
      const activeTab = getActiveTabId();
      const refId = extractRefId(params);
      if (!refId) {
        return {
          ok: false,
          error: {
            message: "page_hover requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      }
      return sendMessageToTab(activeTab, {
        action: "hover",
        params: { refId },
      });
    }
    case "page_unhover": {
      const activeTab = getActiveTabId();
      return sendMessageToTab(activeTab, { action: "unhover", params: {} });
    }
    case "page_scroll": {
      const activeTab = getActiveTabId();
      const { direction, amount } = expectParams<PageScrollParams>(params);
      return sendMessageToTab(activeTab, {
        action: "scroll",
        params: { direction, amount },
      });
    }
    case "page_scroll_to": {
      const activeTab = getActiveTabId();
      const refId = extractRefId(params);
      if (!refId) {
        return {
          ok: false,
          error: {
            message: "page_scroll_to requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      }
      return sendMessageToTab(activeTab, {
        action: "scrollTo",
        params: { x: 0, y: 0, refId },
      });
    }
    case "page_dblclick": {
      const activeTab = getActiveTabId();
      const refId = extractRefId(params);
      if (!refId) {
        return {
          ok: false,
          error: {
            message: "page_dblclick requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      }
      return sendMessageToTab(activeTab, {
        action: "dblclick",
        params: { refId },
      });
    }
    case "page_find": {
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      const { selector } = expectParams<PageFindParams>(params);
      return executeInTab(
        activeTab,
        (sel: unknown) => {
          const elements = Array.from(document.querySelectorAll(String(sel)));
          return elements.map((el) => ({
            tag: el.tagName,
            refId: el.getAttribute("data-ref-id"),
            text: el.textContent?.slice(0, 100) || "",
          }));
        },
        [selector],
      );
    }
    case "page_wait_for": {
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      const { selector, timeout } = expectParams<PageWaitForParams>(params);
      const start = Date.now();
      const timeoutMs = Number(timeout) || 30_000;
      while (true) {
        throwIfAborted();
        const result = await executeInTab(
          activeTab,
          (sel: unknown) => !!document.querySelector(String(sel)),
          [selector],
        );
        if (result.ok && result.value === true) {
          return { ok: true, value: true };
        }
        if (Date.now() - start >= timeoutMs) {
          return {
            ok: false,
            error: {
              message: `Timeout waiting for selector: ${selector}`,
              code: "E_TIMEOUT",
              category: "timeout",
            },
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      break;
    }
    case "page_extract": {
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      const { fields } = expectParams<PageExtractParams>(params);
      return executeInTab(
        activeTab,
        (fieldsArg: unknown) => {
          const fieldList = Array.isArray(fieldsArg) ? fieldsArg : [];
          const result: Record<string, unknown> = {};
          for (const field of fieldList) {
            switch (field) {
              case "title":
                result.title = document.title;
                break;
              case "url":
                result.url = window.location.href;
                break;
              case "headings": {
                const headings = Array.from(
                  document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
                );
                result.headings = headings.map((el) => ({
                  tag: el.tagName,
                  text: el.textContent?.trim().slice(0, 200) || "",
                }));
                break;
              }
              case "links": {
                const links = Array.from(document.querySelectorAll("a[href]"));
                result.links = links.map((el) => ({
                  href: el.getAttribute("href"),
                  text: el.textContent?.trim().slice(0, 100) || "",
                }));
                break;
              }
              case "text":
                result.text =
                  document.body?.textContent?.trim().slice(0, 500) || "";
                break;
            }
          }
          return result;
        },
        [fields],
      );
    }
    case "sidepanel_click":
      return handleSidepanelAction("sidepanel_click", params);
    case "sidepanel_dblclick":
      return handleSidepanelAction("sidepanel_dblclick", params);
    case "sidepanel_fill":
      return handleSidepanelAction("sidepanel_fill", params);
    case "sidepanel_type":
      return handleSidepanelAction("sidepanel_type", params);
    case "sidepanel_press":
      return handleSidepanelAction("sidepanel_press", params);
    case "sidepanel_select":
      return handleSidepanelAction("sidepanel_select", params);
    case "sidepanel_check":
      return handleSidepanelAction("sidepanel_check", params);
    case "sidepanel_hover":
      return handleSidepanelAction("sidepanel_hover", params);
    case "sidepanel_unhover":
      return handleSidepanelAction("sidepanel_unhover", params);
    case "sidepanel_scroll":
      return handleSidepanelAction("sidepanel_scroll", params);
    case "sidepanel_scroll_to":
      return handleSidepanelAction("sidepanel_scroll_to", params);
    case "sidepanel_append":
      return handleSidepanelAction("sidepanel_append", params);
    case "sidepanel_url":
      return { ok: true, value: window.location.href };
    case "sidepanel_title":
      return { ok: true, value: document.title };
    case "sidepanel_wait": {
      const { duration } = expectParams<PageWaitParams>(params);
      await new Promise((resolve) => setTimeout(resolve, Number(duration)));
      return { ok: true, value: true };
    }
    case "sidepanel_snapshot":
    case "sidepanel_snapshot_text": {
      const result = await handleDomSnapshot(
        expectParams<DomSnapshotParams>(params),
      );
      if (result.ok && result.value && typeof result.value === "object") {
        const val = result.value as Record<string, unknown>;
        return { ok: true, value: val.text };
      }
      return {
        ok: false,
        error: {
          message: "Failed to get sidepanel snapshot",
          code: "E_SNAPSHOT",
        },
      };
    }
    case "sidepanel_snapshot_data": {
      return handleDomSnapshot(expectParams<DomSnapshotParams>(params));
    }
    case "page_snapshot":
    case "page_snapshot_text": {
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      const obj = asRecord(params);
      const maxNodes = typeof obj.max_nodes === "number" ? obj.max_nodes : 500;
      const result = await executeInTab(
        activeTab,
        (maxNodesArg: unknown) => {
          const maxNodesNum =
            typeof maxNodesArg === "number" ? maxNodesArg : 500;
          // inlineSnapshot is injected into content-script.ts
          // but executeInTab runs in MAIN world where it may not exist.
          // We inline a minimal snapshot here.
          function getAccessibleRole(el: Element): string {
            const tag = el.tagName.toLowerCase();
            const ariaRole = el.getAttribute("role");
            if (ariaRole) return ariaRole;
            if (
              tag === "button" ||
              (tag === "input" && (el as HTMLInputElement).type === "submit")
            )
              return "button";
            if (tag === "a") return "link";
            if (tag === "input") {
              const type = (el as HTMLInputElement).type;
              if (
                type === "text" ||
                type === "email" ||
                type === "password" ||
                type === "search"
              )
                return "textbox";
              if (type === "checkbox") return "checkbox";
              if (type === "radio") return "radio";
              if (type === "submit" || type === "button") return "button";
            }
            if (tag === "textarea") return "textbox";
            if (tag === "select") return "combobox";
            if (tag === "img") return "img";
            if (
              tag === "h1" ||
              tag === "h2" ||
              tag === "h3" ||
              tag === "h4" ||
              tag === "h5" ||
              tag === "h6"
            )
              return "heading";
            if (tag === "li") return "listitem";
            if (tag === "ul" || tag === "ol") return "list";
            if (tag === "table") return "table";
            if (tag === "tr") return "row";
            if (tag === "td" || tag === "th") return "cell";
            if (tag === "nav") return "navigation";
            if (tag === "main") return "main";
            if (tag === "article") return "article";
            if (tag === "section") return "region";
            if (tag === "aside") return "complementary";
            if (tag === "form") return "form";
            if (tag === "dialog" || tag === "modal") return "dialog";
            if (tag === "figure") return "figure";
            if (tag === "figcaption") return "caption";
            if (el.getAttribute("onclick") || (el as HTMLElement).onclick)
              return "button";
            return "generic";
          }
          function getAccessibleName(el: Element): string {
            const ariaLabel = el.getAttribute("aria-label");
            if (ariaLabel) return ariaLabel;
            const labelledBy = el.getAttribute("aria-labelledby");
            if (labelledBy) {
              const labelEl = document.getElementById(labelledBy);
              if (labelEl) return labelEl.textContent?.slice(0, 60) || "";
            }
            const tag = el.tagName.toLowerCase();
            if (tag === "img") {
              const alt = el.getAttribute("alt");
              if (alt) return alt;
            }
            const title = (el as HTMLElement).title;
            if (title) return title;
            const role = getAccessibleRole(el);
            if (
              role !== "generic" &&
              role !== "list" &&
              role !== "table" &&
              role !== "row" &&
              role !== "region" &&
              role !== "navigation" &&
              role !== "main"
            ) {
              const text = el.textContent?.trim().slice(0, 60) || "";
              return text;
            }
            return "";
          }
          function shouldInclude(el: Element): boolean {
            const role = getAccessibleRole(el);
            if (role === "generic") return false;
            if (role === "presentation" || role === "none") return false;
            if ((el as HTMLElement).hidden) return false;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden")
              return false;
            return true;
          }
          type DomNode = {
            refId: number;
            role: string;
            tag: string;
            name?: string;
          };
          const nodes: DomNode[] = [];
          const lines: string[] = [];
          let nextRefId = 1;
          function traverse(el: Element, depth: number) {
            if (nodes.length >= maxNodesNum) return;
            const tag = el.tagName.toLowerCase();
            if (
              tag === "script" ||
              tag === "style" ||
              tag === "noscript" ||
              tag === "template"
            )
              return;
            const included = shouldInclude(el);
            let currentDepth = depth;
            if (included) {
              const refId = nextRefId++;
              el.setAttribute("data-ref-id", String(refId));
              const role = getAccessibleRole(el);
              const name = getAccessibleName(el);
              const node: DomNode = { refId, role, tag };
              if (name) node.name = name;
              nodes.push(node);
              const indent = "  ".repeat(depth);
              const parts: string[] = [`${indent}- ${role}`];
              if (name) parts.push(`"${name.replace(/"/g, '\\"')}"`);
              parts.push(`[ref=${refId}]`);
              lines.push(parts.join(" "));
              currentDepth = depth + 1;
            }
            for (const child of el.children) {
              traverse(child, currentDepth);
            }
          }
          if (document.body) traverse(document.body, 0);
          const header = [
            `URL: ${window.location.href}`,
            `Title: ${document.title}`,
            "",
          ];
          const text = header.concat(lines).join("\n");
          return {
            text,
            nodes,
            url: window.location.href,
            title: document.title,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
        },
        [maxNodes],
      );
      if (result.ok && result.value && typeof result.value === "object") {
        const val = result.value as Record<string, unknown>;
        return { ok: true, value: val.text };
      }
      return {
        ok: false,
        error: { message: "Failed to get page snapshot", code: "E_SNAPSHOT" },
      };
    }
    case "page_snapshot_data": {
      const activeTab = getActiveTabId();
      if (activeTab === null) {
        return {
          ok: false,
          error: { message: "No active tab", code: "E_NO_TAB" },
        };
      }
      const obj = asRecord(params);
      const maxNodes = typeof obj.max_nodes === "number" ? obj.max_nodes : 500;
      return executeInTab(
        activeTab,
        (maxNodesArg: unknown) => {
          const maxNodesNum =
            typeof maxNodesArg === "number" ? maxNodesArg : 500;
          function getAccessibleRole(el: Element): string {
            const tag = el.tagName.toLowerCase();
            const ariaRole = el.getAttribute("role");
            if (ariaRole) return ariaRole;
            if (
              tag === "button" ||
              (tag === "input" && (el as HTMLInputElement).type === "submit")
            )
              return "button";
            if (tag === "a") return "link";
            if (tag === "input") {
              const type = (el as HTMLInputElement).type;
              if (
                type === "text" ||
                type === "email" ||
                type === "password" ||
                type === "search"
              )
                return "textbox";
              if (type === "checkbox") return "checkbox";
              if (type === "radio") return "radio";
              if (type === "submit" || type === "button") return "button";
            }
            if (tag === "textarea") return "textbox";
            if (tag === "select") return "combobox";
            if (tag === "img") return "img";
            if (
              tag === "h1" ||
              tag === "h2" ||
              tag === "h3" ||
              tag === "h4" ||
              tag === "h5" ||
              tag === "h6"
            )
              return "heading";
            if (tag === "li") return "listitem";
            if (tag === "ul" || tag === "ol") return "list";
            if (tag === "table") return "table";
            if (tag === "tr") return "row";
            if (tag === "td" || tag === "th") return "cell";
            if (tag === "nav") return "navigation";
            if (tag === "main") return "main";
            if (tag === "article") return "article";
            if (tag === "section") return "region";
            if (tag === "aside") return "complementary";
            if (tag === "form") return "form";
            if (tag === "dialog" || tag === "modal") return "dialog";
            if (tag === "figure") return "figure";
            if (tag === "figcaption") return "caption";
            if (el.getAttribute("onclick") || (el as HTMLElement).onclick)
              return "button";
            return "generic";
          }
          function getAccessibleName(el: Element): string {
            const ariaLabel = el.getAttribute("aria-label");
            if (ariaLabel) return ariaLabel;
            const labelledBy = el.getAttribute("aria-labelledby");
            if (labelledBy) {
              const labelEl = document.getElementById(labelledBy);
              if (labelEl) return labelEl.textContent?.slice(0, 60) || "";
            }
            const tag = el.tagName.toLowerCase();
            if (tag === "img") {
              const alt = el.getAttribute("alt");
              if (alt) return alt;
            }
            const title = (el as HTMLElement).title;
            if (title) return title;
            const role = getAccessibleRole(el);
            if (
              role !== "generic" &&
              role !== "list" &&
              role !== "table" &&
              role !== "row" &&
              role !== "region" &&
              role !== "navigation" &&
              role !== "main"
            ) {
              const text = el.textContent?.trim().slice(0, 60) || "";
              return text;
            }
            return "";
          }
          function shouldInclude(el: Element): boolean {
            const role = getAccessibleRole(el);
            if (role === "generic") return false;
            if (role === "presentation" || role === "none") return false;
            if ((el as HTMLElement).hidden) return false;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden")
              return false;
            return true;
          }
          type DomNode = {
            refId: number;
            role: string;
            tag: string;
            name?: string;
          };
          const nodes: DomNode[] = [];
          const lines: string[] = [];
          let nextRefId = 1;
          function traverse(el: Element, depth: number) {
            if (nodes.length >= maxNodesNum) return;
            const tag = el.tagName.toLowerCase();
            if (
              tag === "script" ||
              tag === "style" ||
              tag === "noscript" ||
              tag === "template"
            )
              return;
            const included = shouldInclude(el);
            let currentDepth = depth;
            if (included) {
              const refId = nextRefId++;
              el.setAttribute("data-ref-id", String(refId));
              const role = getAccessibleRole(el);
              const name = getAccessibleName(el);
              const node: DomNode = { refId, role, tag };
              if (name) node.name = name;
              nodes.push(node);
              const indent = "  ".repeat(depth);
              const parts: string[] = [`${indent}- ${role}`];
              if (name) parts.push(`"${name.replace(/"/g, '\\"')}"`);
              parts.push(`[ref=${refId}]`);
              lines.push(parts.join(" "));
              currentDepth = depth + 1;
            }
            for (const child of el.children) {
              traverse(child, currentDepth);
            }
          }
          if (document.body) traverse(document.body, 0);
          const header = [
            `URL: ${window.location.href}`,
            `Title: ${document.title}`,
            "",
          ];
          const text = header.concat(lines).join("\n");
          return {
            data: {
              nodes,
              elements: nodes,
              url: window.location.href,
              title: document.title,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
              },
              version: "1.0",
            },
            text,
          };
        },
        [maxNodes],
      );
    }
    case "dom_snapshot": {
      return handleDomSnapshot(expectParams<DomSnapshotParams>(params));
    }
    case "dom_format": {
      return handleDomFormat(expectParams<DomFormatParams>(params));
    }
    case "page_close": {
      const _obj = asRecord(params);
      const tabId = extractTabId(params);
      return handleChromeApi({
        action: "chrome_tabs_remove",
        params: tabId,
      });
    }
    case "page_active_tab": {
      return handleChromeApi({
        action: "chrome_tabs_query",
        params: { active: true, currentWindow: true },
      });
    }
    case "tab_query":
      return handleChromeApi({ action: "chrome_tabs_query", params });
    case "tab_create":
      return handleChromeApi({ action: "chrome_tabs_create", params });
    case "tab_activate": {
      const obj = asRecord(params);
      const tabId = obj.tabId ?? params;
      return handleChromeApi({
        action: "chrome_tabs_update",
        params: { tabId, update: { active: true } },
      });
    }
    case "tab_close": {
      const obj = asRecord(params);
      const tabId = obj.tabId ?? params;
      return handleChromeApi({ action: "chrome_tabs_remove", params: tabId });
    }
    case "tab_execute_script":
      return handleChromeApi({
        action: "chrome_scripting_executeScript",
        params,
      });
    case "tab_click": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const refId = extractArg(params, 1, obj.refId ?? obj.ref_id);
      if (!refId)
        return {
          ok: false,
          error: {
            message: "tab_click requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      return sendMessageToTab(tabId, {
        action: "click",
        params: { refId: String(refId) },
      });
    }
    case "tab_fill": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const refId = extractArg(params, 1, obj.refId ?? obj.ref_id);
      const value = extractArg(params, 2, obj.value ?? "");
      if (!refId)
        return {
          ok: false,
          error: {
            message: "tab_fill requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      return sendMessageToTab(tabId, {
        action: "fill",
        params: { refId: String(refId), value: String(value) },
      });
    }
    case "tab_scroll_to": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const x = Number(extractArg(params, 1, obj.x ?? 0));
      const y = Number(extractArg(params, 2, obj.y ?? 0));
      const refId = extractArg(params, 3, obj.refId ?? obj.ref_id);
      return sendMessageToTab(tabId, {
        action: "scrollTo",
        params: { x, y, refId: refId ? String(refId) : undefined },
      });
    }
    case "tab_type": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const refId = extractArg(params, 1, obj.refId ?? obj.ref_id);
      const text = extractArg(params, 2, obj.text ?? "");
      if (!refId)
        return {
          ok: false,
          error: {
            message: "tab_type requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      return sendMessageToTab(tabId, {
        action: "type",
        params: { refId: String(refId), text: String(text) },
      });
    }
    case "tab_press": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const key = extractArg(params, 1, obj.key ?? "");
      return sendMessageToTab(tabId, {
        action: "press",
        params: { key: String(key) },
      });
    }
    case "tab_select": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const refId = extractArg(params, 1, obj.refId ?? obj.ref_id);
      const value = extractArg(params, 2, obj.value ?? "");
      if (!refId)
        return {
          ok: false,
          error: {
            message: "tab_select requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      return sendMessageToTab(tabId, {
        action: "select",
        params: { refId: String(refId), value: String(value) },
      });
    }
    case "tab_check": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const refId = extractArg(params, 1, obj.refId ?? obj.ref_id);
      const checked = typeof obj.checked === "boolean" ? obj.checked : true;
      if (!refId)
        return {
          ok: false,
          error: {
            message: "tab_check requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      return sendMessageToTab(tabId, {
        action: "check",
        params: { refId: String(refId), checked },
      });
    }
    case "tab_hover": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const refId = extractArg(params, 1, obj.refId ?? obj.ref_id);
      if (!refId)
        return {
          ok: false,
          error: {
            message: "tab_hover requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      return sendMessageToTab(tabId, {
        action: "hover",
        params: { refId: String(refId) },
      });
    }
    case "tab_unhover": {
      const tabId = extractTabId(params);
      return sendMessageToTab(tabId, {
        action: "unhover",
        params: {},
      });
    }
    case "tab_scroll": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const direction = extractArg(params, 1, obj.direction ?? "down");
      const amount = extractArg(params, 2, obj.amount ?? 300);
      return sendMessageToTab(tabId, {
        action: "scroll",
        params: {
          direction: String(direction),
          amount: typeof amount === "number" ? amount : 300,
        },
      });
    }
    case "tab_dblclick": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const refId = extractArg(params, 1, obj.refId ?? obj.ref_id);
      if (!refId)
        return {
          ok: false,
          error: {
            message: "tab_dblclick requires refId",
            code: "E_MISSING_PARAM",
          },
        };
      return sendMessageToTab(tabId, {
        action: "dblclick",
        params: { refId: String(refId) },
      });
    }
    case "tab_evaluate": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const script = extractArg(
        params,
        1,
        obj.script ?? obj.code ?? obj.js ?? "",
      );
      return executeInTab(
        tabId,
        (code: unknown) => {
          const codeStr = String(code);
          if (typeof code !== "string") {
            throw new Error("tab.evaluate requires a string argument");
          }
          // Use new Function to avoid capturing local scope (marginally safer than eval)
          return new Function(codeStr)();
        },
        [String(script)],
      );
    }
    case "tab_back": {
      const tabId = extractTabId(params);
      return sendMessageToTab(tabId, {
        action: "back",
        params: {},
      });
    }
    case "tab_wait_for_load": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const timeoutArg = extractArg(params, 1, obj.timeout);
      const timeout = typeof timeoutArg === "number" ? timeoutArg : 30_000;
      return waitForTabLoad(tabId, timeout);
    }
    case "tab_fetch": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const url = extractArg(params, 1, obj.url);
      const opts = extractArg(params, 2, obj);
      const optsRec = asRecord(opts);
      const method = (optsRec.method as string) ?? "GET";
      const headers = optsRec.headers ?? {};
      const body = optsRec.body ?? null;
      const timeout =
        typeof optsRec.timeout === "number" ? optsRec.timeout : 30_000;
      return executeInTab(
        tabId,
        (
          urlArg: unknown,
          methodArg: unknown,
          headersArg: unknown,
          bodyArg: unknown,
          timeoutArg: unknown,
        ) => {
          const urlStr = typeof urlArg === "string" ? urlArg : "";
          const methodStr = typeof methodArg === "string" ? methodArg : "GET";
          const headersRec =
            typeof headersArg === "object" && headersArg !== null
              ? (headersArg as Record<string, string>)
              : {};
          const bodyStr =
            bodyArg !== null && bodyArg !== undefined ? String(bodyArg) : null;
          const timeoutNum =
            typeof timeoutArg === "number" ? timeoutArg : 30_000;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutNum);
          const fetchOpts: RequestInit = {
            method: methodStr || "GET",
            headers: headersRec,
            signal: controller.signal,
          };
          if (bodyStr !== null) {
            fetchOpts.body = bodyStr;
          }
          return fetch(urlStr, fetchOpts)
            .then(async (resp) => {
              clearTimeout(timeoutId);
              const text = await resp.text();
              return {
                status: resp.status,
                ok: resp.ok,
                headers: Object.fromEntries(resp.headers.entries()),
                body: text,
              };
            })
            .catch((e) => {
              clearTimeout(timeoutId);
              throw e;
            });
        },
        [url, method, headers, body, timeout],
      );
    }
    case "tab_snapshot": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const opts = extractArg(params, 1, obj.options ?? obj);
      const optRec = asRecord(opts);
      const maxNodes =
        typeof optRec.max_nodes === "number" ? optRec.max_nodes : 500;
      const result = await executeInTab(
        tabId,
        (maxNodesArg: unknown) => {
          const maxNodesNum =
            typeof maxNodesArg === "number" ? maxNodesArg : 500;

          function getAccessibleRole(el: Element): string {
            const tag = el.tagName.toLowerCase();
            const ariaRole = el.getAttribute("role");
            if (ariaRole) return ariaRole;
            if (
              tag === "button" ||
              (tag === "input" && (el as HTMLInputElement).type === "submit")
            )
              return "button";
            if (tag === "a") return "link";
            if (tag === "input") {
              const type = (el as HTMLInputElement).type;
              if (
                type === "text" ||
                type === "email" ||
                type === "password" ||
                type === "search"
              )
                return "textbox";
              if (type === "checkbox") return "checkbox";
              if (type === "radio") return "radio";
              if (type === "submit" || type === "button") return "button";
            }
            if (tag === "textarea") return "textbox";
            if (tag === "select") return "combobox";
            if (tag === "img") return "img";
            if (
              tag === "h1" ||
              tag === "h2" ||
              tag === "h3" ||
              tag === "h4" ||
              tag === "h5" ||
              tag === "h6"
            )
              return "heading";
            if (tag === "li") return "listitem";
            if (tag === "ul" || tag === "ol") return "list";
            if (tag === "table") return "table";
            if (tag === "tr") return "row";
            if (tag === "td" || tag === "th") return "cell";
            if (tag === "nav") return "navigation";
            if (tag === "main") return "main";
            if (tag === "article") return "article";
            if (tag === "section") return "region";
            if (tag === "aside") return "complementary";
            if (tag === "form") return "form";
            if (tag === "dialog" || tag === "modal") return "dialog";
            if (tag === "figure") return "figure";
            if (tag === "figcaption") return "caption";
            if (el.getAttribute("onclick") || (el as HTMLElement).onclick)
              return "button";
            return "generic";
          }

          function getAccessibleName(el: Element): string {
            const ariaLabel = el.getAttribute("aria-label");
            if (ariaLabel) return ariaLabel;

            const labelledBy = el.getAttribute("aria-labelledby");
            if (labelledBy) {
              const labelEl = document.getElementById(labelledBy);
              if (labelEl) return labelEl.textContent?.slice(0, 60) || "";
            }

            const tag = el.tagName.toLowerCase();
            if (tag === "img") {
              const alt = el.getAttribute("alt");
              if (alt) return alt;
            }

            const title = (el as HTMLElement).title;
            if (title) return title;

            const role = getAccessibleRole(el);
            if (
              role !== "generic" &&
              role !== "list" &&
              role !== "table" &&
              role !== "row" &&
              role !== "region" &&
              role !== "navigation" &&
              role !== "main"
            ) {
              const text = el.textContent?.trim().slice(0, 60) || "";
              return text;
            }
            return "";
          }

          function shouldInclude(el: Element): boolean {
            const role = getAccessibleRole(el);
            if (role === "generic") return false;
            if (role === "presentation" || role === "none") return false;
            if ((el as HTMLElement).hidden) return false;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden")
              return false;
            return true;
          }

          function inlineSnapshot(maxNodes: number) {
            let nextRefId = 1;
            const nodes: DomNode[] = [];
            const lines: string[] = [];

            function traverse(el: Element, depth: number) {
              if (nodes.length >= maxNodes) return;

              const tag = el.tagName.toLowerCase();
              if (
                tag === "script" ||
                tag === "style" ||
                tag === "noscript" ||
                tag === "template"
              )
                return;

              const included = shouldInclude(el);
              let currentDepth = depth;

              if (included) {
                const refId = nextRefId++;
                el.setAttribute("data-ref-id", String(refId));
                const role = getAccessibleRole(el);
                const name = getAccessibleName(el);
                const node: DomNode = { refId, role, tag };
                if (name) node.name = name;
                nodes.push(node);

                const indent = "  ".repeat(depth);
                const parts: string[] = [`${indent}- ${role}`];
                if (name) parts.push(`"${name.replace(/"/g, '\\"')}"`);
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

          return inlineSnapshot(maxNodesNum);
        },
        [maxNodes],
      );
      if (result.ok && result.value && typeof result.value === "object") {
        return {
          ok: true,
          value: (result.value as Record<string, unknown>).text,
        };
      }
      return result;
    }
    case "tab_snapshot_text": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const opts = extractArg(params, 1, obj.options ?? obj);
      const optRec = asRecord(opts);
      const maxNodes =
        typeof optRec.max_nodes === "number" ? optRec.max_nodes : 500;
      const result = await executeInTab(
        tabId,
        (maxNodesArg: unknown) => {
          const maxNodesNum =
            typeof maxNodesArg === "number" ? maxNodesArg : 500;

          function getAccessibleRole(el: Element): string {
            const tag = el.tagName.toLowerCase();
            const ariaRole = el.getAttribute("role");
            if (ariaRole) return ariaRole;
            if (
              tag === "button" ||
              (tag === "input" && (el as HTMLInputElement).type === "submit")
            )
              return "button";
            if (tag === "a") return "link";
            if (tag === "input") {
              const type = (el as HTMLInputElement).type;
              if (
                type === "text" ||
                type === "email" ||
                type === "password" ||
                type === "search"
              )
                return "textbox";
              if (type === "checkbox") return "checkbox";
              if (type === "radio") return "radio";
              if (type === "submit" || type === "button") return "button";
            }
            if (tag === "textarea") return "textbox";
            if (tag === "select") return "combobox";
            if (tag === "img") return "img";
            if (
              tag === "h1" ||
              tag === "h2" ||
              tag === "h3" ||
              tag === "h4" ||
              tag === "h5" ||
              tag === "h6"
            )
              return "heading";
            if (tag === "li") return "listitem";
            if (tag === "ul" || tag === "ol") return "list";
            if (tag === "table") return "table";
            if (tag === "tr") return "row";
            if (tag === "td" || tag === "th") return "cell";
            if (tag === "nav") return "navigation";
            if (tag === "main") return "main";
            if (tag === "article") return "article";
            if (tag === "section") return "region";
            if (tag === "aside") return "complementary";
            if (tag === "form") return "form";
            if (tag === "dialog" || tag === "modal") return "dialog";
            if (tag === "figure") return "figure";
            if (tag === "figcaption") return "caption";
            if (el.getAttribute("onclick") || (el as HTMLElement).onclick)
              return "button";
            return "generic";
          }

          function getAccessibleName(el: Element): string {
            const ariaLabel = el.getAttribute("aria-label");
            if (ariaLabel) return ariaLabel;

            const labelledBy = el.getAttribute("aria-labelledby");
            if (labelledBy) {
              const labelEl = document.getElementById(labelledBy);
              if (labelEl) return labelEl.textContent?.slice(0, 60) || "";
            }

            const tag = el.tagName.toLowerCase();
            if (tag === "img") {
              const alt = el.getAttribute("alt");
              if (alt) return alt;
            }

            const title = (el as HTMLElement).title;
            if (title) return title;

            const role = getAccessibleRole(el);
            if (
              role !== "generic" &&
              role !== "list" &&
              role !== "table" &&
              role !== "row" &&
              role !== "region" &&
              role !== "navigation" &&
              role !== "main"
            ) {
              const text = el.textContent?.trim().slice(0, 60) || "";
              return text;
            }
            return "";
          }

          function shouldInclude(el: Element): boolean {
            const role = getAccessibleRole(el);
            if (role === "generic") return false;
            if (role === "presentation" || role === "none") return false;
            if ((el as HTMLElement).hidden) return false;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden")
              return false;
            return true;
          }

          function inlineSnapshot(maxNodes: number) {
            let nextRefId = 1;
            const nodes: DomNode[] = [];
            const lines: string[] = [];

            function traverse(el: Element, depth: number) {
              if (nodes.length >= maxNodes) return;

              const tag = el.tagName.toLowerCase();
              if (
                tag === "script" ||
                tag === "style" ||
                tag === "noscript" ||
                tag === "template"
              )
                return;

              const included = shouldInclude(el);
              let currentDepth = depth;

              if (included) {
                const refId = nextRefId++;
                el.setAttribute("data-ref-id", String(refId));
                const role = getAccessibleRole(el);
                const name = getAccessibleName(el);
                const node: DomNode = { refId, role, tag };
                if (name) node.name = name;
                nodes.push(node);

                const indent = "  ".repeat(depth);
                const parts: string[] = [`${indent}- ${role}`];
                if (name) parts.push(`"${name.replace(/"/g, '\\"')}"`);
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

          return inlineSnapshot(maxNodesNum);
        },
        [maxNodes],
      );
      if (result.ok && result.value && typeof result.value === "object") {
        return {
          ok: true,
          value: (result.value as Record<string, unknown>).text,
        };
      }
      return result;
    }
    case "tab_snapshot_data": {
      const tabId = extractTabId(params);
      const obj = asRecord(params);
      const opts = extractArg(params, 1, obj.options ?? obj);
      const optRec = asRecord(opts);
      const maxNodes =
        typeof optRec.max_nodes === "number" ? optRec.max_nodes : 500;
      return executeInTab(
        tabId,
        (maxNodesArg: unknown) => {
          const maxNodesNum =
            typeof maxNodesArg === "number" ? maxNodesArg : 500;

          function getAccessibleRole(el: Element): string {
            const tag = el.tagName.toLowerCase();
            const ariaRole = el.getAttribute("role");
            if (ariaRole) return ariaRole;
            if (
              tag === "button" ||
              (tag === "input" && (el as HTMLInputElement).type === "submit")
            )
              return "button";
            if (tag === "a") return "link";
            if (tag === "input") {
              const type = (el as HTMLInputElement).type;
              if (
                type === "text" ||
                type === "email" ||
                type === "password" ||
                type === "search"
              )
                return "textbox";
              if (type === "checkbox") return "checkbox";
              if (type === "radio") return "radio";
              if (type === "submit" || type === "button") return "button";
            }
            if (tag === "textarea") return "textbox";
            if (tag === "select") return "combobox";
            if (tag === "img") return "img";
            if (
              tag === "h1" ||
              tag === "h2" ||
              tag === "h3" ||
              tag === "h4" ||
              tag === "h5" ||
              tag === "h6"
            )
              return "heading";
            if (tag === "li") return "listitem";
            if (tag === "ul" || tag === "ol") return "list";
            if (tag === "table") return "table";
            if (tag === "tr") return "row";
            if (tag === "td" || tag === "th") return "cell";
            if (tag === "nav") return "navigation";
            if (tag === "main") return "main";
            if (tag === "article") return "article";
            if (tag === "section") return "region";
            if (tag === "aside") return "complementary";
            if (tag === "form") return "form";
            if (tag === "dialog" || tag === "modal") return "dialog";
            if (tag === "figure") return "figure";
            if (tag === "figcaption") return "caption";
            if (el.getAttribute("onclick") || (el as HTMLElement).onclick)
              return "button";
            return "generic";
          }

          function getAccessibleName(el: Element): string {
            const ariaLabel = el.getAttribute("aria-label");
            if (ariaLabel) return ariaLabel;

            const labelledBy = el.getAttribute("aria-labelledby");
            if (labelledBy) {
              const labelEl = document.getElementById(labelledBy);
              if (labelEl) return labelEl.textContent?.slice(0, 60) || "";
            }

            const tag = el.tagName.toLowerCase();
            if (tag === "img") {
              const alt = el.getAttribute("alt");
              if (alt) return alt;
            }

            const title = (el as HTMLElement).title;
            if (title) return title;

            const role = getAccessibleRole(el);
            if (
              role !== "generic" &&
              role !== "list" &&
              role !== "table" &&
              role !== "row" &&
              role !== "region" &&
              role !== "navigation" &&
              role !== "main"
            ) {
              const text = el.textContent?.trim().slice(0, 60) || "";
              return text;
            }
            return "";
          }

          function shouldInclude(el: Element): boolean {
            const role = getAccessibleRole(el);
            if (role === "generic") return false;
            if (role === "presentation" || role === "none") return false;
            if ((el as HTMLElement).hidden) return false;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden")
              return false;
            return true;
          }

          function inlineSnapshot(maxNodes: number) {
            let nextRefId = 1;
            const nodes: DomNode[] = [];
            const lines: string[] = [];

            function traverse(el: Element, depth: number) {
              if (nodes.length >= maxNodes) return;

              const tag = el.tagName.toLowerCase();
              if (
                tag === "script" ||
                tag === "style" ||
                tag === "noscript" ||
                tag === "template"
              )
                return;

              const included = shouldInclude(el);
              let currentDepth = depth;

              if (included) {
                const refId = nextRefId++;
                el.setAttribute("data-ref-id", String(refId));
                const role = getAccessibleRole(el);
                const name = getAccessibleName(el);
                const node: DomNode = { refId, role, tag };
                if (name) node.name = name;
                nodes.push(node);

                const indent = "  ".repeat(depth);
                const parts: string[] = [`${indent}- ${role}`];
                if (name) parts.push(`"${name.replace(/"/g, '\\"')}"`);
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
              elements: nodes,
              url: window.location.href,
              title: document.title,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
              },
            };
          }

          return inlineSnapshot(maxNodesNum);
        },
        [maxNodes],
      );
    }
    case "cookies_get":
      return handleChromeApi({ action: "chrome_cookies_get", params });
    case "cookies_set":
      return handleChromeApi({ action: "chrome_cookies_set", params });
    case "cookies_delete":
      return handleChromeApi({ action: "chrome_cookies_remove", params });
    case "cookies_list":
      return handleChromeApi({ action: "chrome_cookies_getAll", params });
    case "history_search":
      return handleChromeApi({ action: "chrome_history_search", params });
    case "history_delete": {
      const obj = asRecord(params);
      const url = obj.url ?? params;
      return handleChromeApi({
        action: "chrome_history_deleteUrl",
        params: { url },
      });
    }
    case "bookmarks_search": {
      const obj = asRecord(params);
      const query =
        obj.query ?? (typeof params === "string" ? params : "") ?? "";
      return handleChromeApi({
        action: "chrome_bookmarks_search",
        params: query,
      });
    }
    case "bookmarks_create":
      return handleChromeApi({ action: "chrome_bookmarks_create", params });
    case "bookmarks_delete": {
      const obj = asRecord(params);
      const id = obj.id ?? params;
      return handleChromeApi({ action: "chrome_bookmarks_remove", params: id });
    }
    case "notifications_create": {
      const obj = asRecord(params);
      const id = obj.id ?? (typeof params === "string" ? params : "") ?? "";
      const options = obj.options ?? obj ?? {};
      return handleChromeApi({
        action: "chrome_notifications_create",
        params: { id, options },
      });
    }
    case "notifications_clear": {
      const obj = asRecord(params);
      const id = obj.id ?? (typeof params === "string" ? params : "") ?? "";
      return handleChromeApi({
        action: "chrome_notifications_clear",
        params: id,
      });
    }
    default:
      if (command.action.startsWith("chrome_")) {
        return handleChromeApi(command);
      }
      if (command.action.startsWith("host_")) {
        return handleHostCallAction(command.action.slice(5), params);
      }
      return {
        ok: false,
        error: {
          message: `Unknown main-thread action: ${command.action}`,
          code: "EUNKNOWN",
          category: "unknown",
        },
      };
  }
}

// ─── Fetch handler ───────────────────────────────────────────────

async function handleFetch(
  params: FetchParams,
): Promise<AsyncResponse<FetchValue>> {
  throwIfAborted();
  const { url, method, headers, body, timeout } = params;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      Number(timeout) ?? 30_000,
    );
    const fetchOpts: RequestInit = {
      method: method || "GET",
      headers:
        typeof headers === "object" && headers !== null
          ? (headers as Record<string, string>)
          : {},
      signal: controller.signal,
    };
    if (body !== null && body !== undefined) {
      fetchOpts.body = typeof body === "string" ? body : String(body);
    }
    const response = await fetch(url, fetchOpts);
    clearTimeout(timeoutId);
    const responseBody = await response.text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    return {
      ok: true,
      value: {
        status: response.status,
        ok: response.ok,
        headers: responseHeaders,
        body: responseBody,
      },
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error: {
          message: `Request timed out after ${timeout || 30_000}ms`,
          code: "ETIMEDOUT",
          category: "timeout",
        },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        message: message || String(err),
        code: "EUNKNOWN",
        category: "network",
      },
    };
  }
}

// ─── Tab script execution ──────────────────────────────────────

async function executeInTab(
  tabId: number | null,
  func: (...args: unknown[]) => unknown,
  args: unknown[],
): Promise<AsyncResponse> {
  throwIfAborted();
  const chrome = window.chrome;
  if (!chrome?.runtime?.id) {
    return {
      ok: false,
      error: {
        message: "Not in extension context",
        code: "E_NO_EXTENSION",
        category: "permission",
      },
    };
  }
  try {
    const targetTab = typeof tabId === "number" ? tabId : activeTabId;
    if (targetTab === null) {
      return {
        ok: false,
        error: {
          message: "No active tab available",
          code: "E_NO_TAB",
          category: "resource",
        },
      };
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab },
      func,
      args,
      world: "MAIN",
    });
    if (results?.[0]) {
      return { ok: true, value: results[0].result };
    }
    return { ok: true, value: null };
  } catch (err: unknown) {
    return normalizeChromeError(err);
  }
}

async function waitForTabLoad(
  tabId: number | null,
  timeoutMs: number = 30_000,
): Promise<AsyncResponse<boolean>> {
  throwIfAborted();
  const chrome = window.chrome;
  if (!chrome?.runtime?.id) {
    return {
      ok: false,
      error: {
        message: "Not in extension context",
        code: "E_NO_EXTENSION",
        category: "permission",
      },
    };
  }
  const targetTab = typeof tabId === "number" ? tabId : null;
  if (targetTab === null) {
    return {
      ok: false,
      error: {
        message: "tab_wait_for_load requires a valid tabId",
        code: "E_MISSING_PARAM",
      },
    };
  }
  try {
    const tab = await chrome.tabs.get(targetTab);
    if (tab.status === "complete") {
      return { ok: true, value: true };
    }
    await new Promise<void>((resolve, reject) => {
      const listener = (
        updatedTabId: number,
        changeInfo: { status?: string },
      ) => {
        if (updatedTabId === targetTab && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Timeout waiting for tab load"));
      }, timeoutMs);
    });
    return { ok: true, value: true };
  } catch (err: unknown) {
    return normalizeChromeError(err);
  }
}

// ─── Active tab cache & persistent content-script communication ──

let activeTabId: number | null = null;

const onActivatedListener = ({ tabId }: { tabId: number }) => {
  activeTabId = tabId;
};

const onUpdatedListener = (tabId: number, changeInfo: { status?: string }) => {
  const chrome = window.chrome;
  if (!chrome?.runtime?.id) return;
  if (changeInfo.status === "complete") {
    chrome.tabs.sendMessage(tabId, { action: "ping" }).catch(() => {
      // Content script not present; injection happens automatically
      // via manifest content_scripts matches for new navigations.
      // For SPA navigations within same document, no injection needed
      // because content script persists.
    });
  }
};

export function getActiveTabId(): number | null {
  return activeTabId;
}

export function initExtensionListeners(): void {
  const chrome = window.chrome;
  if (!chrome?.runtime?.id) return;

  chrome.tabs.onActivated.addListener(onActivatedListener);
  chrome.tabs.onUpdated.addListener(onUpdatedListener);

  // Initialize activeTabId from current state
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs: chrome.tabs.Tab[]) => {
      const t = Array.isArray(tabs) ? tabs : [];
      const first = t[0] as chrome.tabs.Tab | undefined;
      if (first && typeof first.id === "number") {
        activeTabId = first.id;
      }
    })
    .catch(() => {
      // ignore query errors
    });
}

export function removeExtensionListeners(): void {
  const chrome = window.chrome;
  if (!chrome?.runtime?.id) return;
  chrome.tabs.onActivated.removeListener(onActivatedListener);
  chrome.tabs.onUpdated.removeListener(onUpdatedListener);
}

async function sendMessageToTab(
  tabId: number | null,
  message: TabMessage,
): Promise<AsyncResponse> {
  throwIfAborted();
  const chrome = window.chrome;
  if (!chrome?.runtime?.id) {
    return {
      ok: false,
      error: {
        message: "Not in extension context",
        code: "E_NO_EXTENSION",
        category: "permission",
      },
    };
  }
  const targetTab = typeof tabId === "number" ? tabId : activeTabId;
  if (targetTab === null) {
    return {
      ok: false,
      error: {
        message: "No active tab available",
        code: "E_NO_TAB",
        category: "resource",
      },
    };
  }
  logger.debug("[sendMessageToTab] targetTab:", targetTab, "message:", message);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await chrome.tabs.sendMessage(targetTab, message);
      logger.debug("[sendMessageToTab] raw result:", result);
      // Content-script handlers may return { ok: false, error: msg } on failure.
      // Flatten that so Lua consumers always see a single error shape.
      if (
        result &&
        typeof result === "object" &&
        (result as Record<string, unknown>).ok === false
      ) {
        const raw = (result as Record<string, unknown>).error;
        const msg = typeof raw === "string" ? raw : String(raw);
        logger.debug("[sendMessageToTab] content-script error:", msg);
        return {
          ok: false,
          error: {
            message: msg || "Content script error",
            code: "E_CONTENT_SCRIPT",
          },
        };
      }
      logger.debug("[sendMessageToTab] success, result:", result);
      return { ok: true, value: result };
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : String(err)) || "";
      if (msg.includes("Receiving end does not exist") && attempt < 4) {
        if (attempt === 0) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: targetTab },
              files: ["content-script.js"],
              world: "ISOLATED",
            });
            await new Promise((resolve) => setTimeout(resolve, 300));
          } catch (injectErr: unknown) {
            return normalizeChromeError(injectErr);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      return normalizeChromeError(err);
    }
  }
  return {
    ok: false,
    error: {
      message: "Failed to send message to tab after retries",
      code: "E_TAB_MESSAGE",
      category: "resource",
    },
  };
}

// ─── Sidepanel actions (side panel / main document) ─────────────
//
// IMPORTANT: sidepanel.* actions operate on the extension popup/sidepanel
// DOM, NOT the active browser tab. To interact with the active tab, use
// page.* APIs which relay commands to the content script via sendMessageToTab.

function getElementByRefId(refId: string): Element | null {
  return document.querySelector(`[data-ref-id='${CSS.escape(refId)}']`);
}

function extractRefId(params: unknown): string | undefined {
  if (typeof params === "string") return params;
  const obj = asRecord(params);
  return typeof obj.refId === "string" ? obj.refId : undefined;
}

async function handleSidepanelAction(
  action: string,
  params: unknown,
): Promise<AsyncResponse<null>> {
  const _obj = asRecord(params);
  const refId = extractRefId(params);
  const element = refId ? getElementByRefId(refId) : null;

  switch (action) {
    case "sidepanel_click": {
      if (!element)
        return {
          ok: false,
          error: { message: `Element ${refId} not found`, code: "ENOTFOUND" },
        };
      (element as HTMLElement).click();
      return { ok: true, value: null };
    }
    case "sidepanel_dblclick": {
      if (!element)
        return {
          ok: false,
          error: { message: `Element ${refId} not found`, code: "ENOTFOUND" },
        };
      const ev = new MouseEvent("dblclick", { bubbles: true });
      element.dispatchEvent(ev);
      return { ok: true, value: null };
    }
    case "sidepanel_fill": {
      if (!element)
        return {
          ok: false,
          error: { message: `Element ${refId} not found`, code: "ENOTFOUND" },
        };
      const { value } = expectParams<PageFillParams>(params);
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        element.value = value;
      } else {
        return {
          ok: false,
          error: { message: "Element is not an input", code: "EINPUT" },
        };
      }
      const ev = new InputEvent("input", { bubbles: true });
      element.dispatchEvent(ev);
      return { ok: true, value: null };
    }
    case "sidepanel_type": {
      if (!element)
        return {
          ok: false,
          error: { message: `Element ${refId} not found`, code: "ENOTFOUND" },
        };
      const { text } = expectParams<PageTypeParams>(params);
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        element.value = text;
      }
      const ev = new InputEvent("input", { bubbles: true });
      element.dispatchEvent(ev);
      return { ok: true, value: null };
    }
    case "sidepanel_append": {
      if (!element)
        return {
          ok: false,
          error: { message: `Element ${refId} not found`, code: "ENOTFOUND" },
        };
      const { text } = expectParams<PageTypeParams>(params);
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        element.value += text;
      } else {
        return {
          ok: false,
          error: { message: "Element is not an input", code: "EINPUT" },
        };
      }
      const ev = new InputEvent("input", { bubbles: true });
      element.dispatchEvent(ev);
      return { ok: true, value: null };
    }
    case "sidepanel_press": {
      const { key } = expectParams<PagePressParams>(params);
      const ev = new KeyboardEvent("keydown", { key, bubbles: true });
      document.dispatchEvent(ev);
      const evUp = new KeyboardEvent("keyup", { key, bubbles: true });
      document.dispatchEvent(evUp);
      return { ok: true, value: null };
    }
    case "sidepanel_select": {
      if (!element)
        return {
          ok: false,
          error: { message: `Element ${refId} not found`, code: "ENOTFOUND" },
        };
      const { value } = expectParams<PageSelectParams>(params);
      if (element instanceof HTMLSelectElement) {
        element.value = value;
      } else {
        return {
          ok: false,
          error: { message: "Element is not a select", code: "ESELECT" },
        };
      }
      return { ok: true, value: null };
    }
    case "sidepanel_check": {
      if (!element)
        return {
          ok: false,
          error: { message: `Element ${refId} not found`, code: "ENOTFOUND" },
        };
      const { checked } = expectParams<PageCheckParams>(params);
      if (element instanceof HTMLInputElement && element.type === "checkbox") {
        element.checked = checked;
      } else {
        return {
          ok: false,
          error: { message: "Element is not a checkbox", code: "ECHECKBOX" },
        };
      }
      return { ok: true, value: null };
    }
    case "sidepanel_hover": {
      if (!element)
        return {
          ok: false,
          error: { message: `Element ${refId} not found`, code: "ENOTFOUND" },
        };
      const ev = new MouseEvent("mouseenter", { bubbles: true });
      element.dispatchEvent(ev);
      return { ok: true, value: null };
    }
    case "sidepanel_unhover": {
      if (!element)
        return {
          ok: false,
          error: { message: `Element ${refId} not found`, code: "ENOTFOUND" },
        };
      const ev = new MouseEvent("mouseleave", { bubbles: true });
      element.dispatchEvent(ev);
      return { ok: true, value: null };
    }
    case "sidepanel_scroll": {
      const { direction, amount } = expectParams<PageScrollParams>(params);
      window.scrollBy({
        top: direction === "down" ? amount : -amount,
        behavior: "smooth",
      });
      return { ok: true, value: null };
    }
    case "sidepanel_scroll_to": {
      if (!element)
        return {
          ok: false,
          error: { message: `Element ${refId} not found`, code: "ENOTFOUND" },
        };
      element.scrollIntoView({ behavior: "smooth" });
      return { ok: true, value: null };
    }
    default:
      return {
        ok: false,
        error: {
          message: `Unknown sidepanel action: ${action}`,
          code: "EUNKNOWN",
        },
      };
  }
}

// ─── DOM snapshot ──────────────────────────────────────────────

async function handleDomSnapshot(
  params: DomSnapshotParams,
): Promise<AsyncResponse<DomSnapshotValue>> {
  try {
    await ensureDomSnapshot();
    const { max_nodes, interactive_only } = params;
    const options = {
      maxNodes: Number(max_nodes),
      interactiveOnly: interactive_only,
    };
    const snap = collectDocument(options);
    const text = formatSnapshot(snap, "compact-text");
    return {
      ok: true,
      value: { data: snap, text },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: { message: message || String(err), code: "E_SNAPSHOT" },
    };
  }
}

async function handleDomFormat(
  params: DomFormatParams,
): Promise<AsyncResponse<string>> {
  try {
    await ensureDomSnapshot();
    const { snapshot, format } = params;
    const text = formatSnapshot(snapshot, format);
    return { ok: true, value: text };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: { message: message || String(err), code: "E_FORMAT" },
    };
  }
}

function _getElementRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const ariaRole = el.getAttribute("role");
  if (ariaRole) return ariaRole;
  if (
    tag === "button" ||
    (tag === "input" && (el as HTMLInputElement).type === "submit")
  )
    return "button";
  if (tag === "a") return "link";
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    if (
      type === "text" ||
      type === "email" ||
      type === "password" ||
      type === "search"
    )
      return "textbox";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button") return "button";
  }
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "img") return "img";
  if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4")
    return "heading";
  return "generic";
}

// ─── Host call handler ───────────────────────────────────────────

async function handleHostCallAction(
  action: string,
  params: unknown,
): Promise<AsyncResponse> {
  const handler = hostHandlers[action] ?? window.__hostHandlers?.[action];
  if (!handler) {
    return {
      ok: false,
      error: {
        message: `No handler registered for "${action}"`,
        code: "ENOHANDLER",
        category: "host",
      },
    };
  }
  try {
    const value = await handler(params);
    return { ok: true, value };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        message: message || String(err),
        code: "EHOSTCALL",
        category: "host",
      },
    };
  }
}

// ─── Chrome error normalizer ───────────────────────────────────

function normalizeChromeError(err: unknown): { ok: false; error: AsyncError } {
  const msg = (err instanceof Error ? err.message : String(err)) || "";
  if (msg.includes("permission") || msg.includes("Permission")) {
    return {
      ok: false,
      error: {
        message: msg,
        code: "E_PERMISSION_DENIED",
        category: "permission",
      },
    };
  }
  if (
    msg.includes("not found") ||
    msg.includes("No tab") ||
    msg.includes("No window")
  ) {
    return {
      ok: false,
      error: { message: msg, code: "E_NOT_FOUND", category: "resource" },
    };
  }
  return {
    ok: false,
    error: { message: msg, code: "E_EXTENSION", category: "extension" },
  };
}

// ─── Chrome API dispatcher ─────────────────────────────────────

async function handleChromeApi(command: Command): Promise<AsyncResponse> {
  const chrome = window.chrome;
  if (!chrome?.runtime?.id) {
    return {
      ok: false,
      error: {
        message: `${command.action} is only available in a browser extension context`,
        code: "E_NO_EXTENSION",
        category: "permission",
      },
    };
  }

  const p = command.params;
  const first = Array.isArray(p)
    ? p[0]
    : typeof p === "object" && p !== null
      ? p
      : p;
  const second = Array.isArray(p) ? p[1] : undefined;
  const firstRec = asRecord(first);

  try {
    let result: unknown;
    switch (command.action) {
      case "chrome_runtime_sendMessage": {
        result = await chrome.runtime.sendMessage(firstRec || {});
        break;
      }
      case "chrome_tabs_query": {
        result = await chrome.tabs.query(firstRec || {});
        break;
      }
      case "chrome_tabs_create": {
        result = await chrome.tabs.create(firstRec || {});
        break;
      }
      case "chrome_tabs_update": {
        const tabId = firstRec.tabId || first;
        const updateProps = firstRec.update || second || {};
        result = await chrome.tabs.update(
          typeof tabId === "number" ? tabId : (null as unknown as number),
          // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
          updateProps as any,
        );
        break;
      }
      case "chrome_tabs_remove": {
        const tabId = firstRec.tabId || firstRec.id || first;
        await chrome.tabs.remove(tabId as number);
        result = null;
        break;
      }
      case "chrome_tabs_get": {
        const tabId = firstRec.tabId || firstRec.id || first;
        result = await chrome.tabs.get(tabId as number);
        break;
      }
      case "chrome_tabs_reload": {
        const tabId = firstRec.tabId || first;
        const reloadProps = firstRec.reload || second || {};
        await chrome.tabs.reload(
          typeof tabId === "number" ? tabId : (undefined as unknown as number),
          // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
          reloadProps as any,
        );
        result = null;
        break;
      }
      case "chrome_tabs_sendMessage": {
        const tabId = firstRec.tabId || first;
        const message = firstRec.message || second || {};
        result = await chrome.tabs.sendMessage(tabId as number, message);
        break;
      }
      case "chrome_alarms_create": {
        const name =
          firstRec.name || (typeof first === "string" ? first : "") || "";
        const alarmInfo = firstRec.alarmInfo || second || firstRec || {};
        await chrome.alarms.create(name as string, alarmInfo);
        result = null;
        break;
      }
      case "chrome_alarms_clear": {
        const alarmName =
          firstRec.name || (typeof first === "string" ? first : "") || "";
        result = await chrome.alarms.clear(alarmName as string);
        break;
      }
      case "chrome_action_setBadgeText": {
        // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
        await chrome.action.setBadgeText((firstRec || {}) as any);
        result = null;
        break;
      }
      case "chrome_action_setBadgeBackgroundColor": {
        // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
        await chrome.action.setBadgeBackgroundColor((firstRec || {}) as any);
        result = null;
        break;
      }
      case "chrome_action_setTitle": {
        // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
        await chrome.action.setTitle((firstRec || {}) as any);
        result = null;
        break;
      }
      case "chrome_action_setIcon": {
        // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
        result = await chrome.action.setIcon((firstRec || {}) as any);
        break;
      }
      case "chrome_contextMenus_create": {
        result = await chrome.contextMenus.create(firstRec || {});
        break;
      }
      case "chrome_contextMenus_remove": {
        const menuId = firstRec.menuItemId || firstRec.id || first;
        await chrome.contextMenus.remove(menuId);
        result = null;
        break;
      }
      case "chrome_windows_getAll": {
        result = await chrome.windows.getAll(firstRec || {});
        break;
      }
      case "chrome_windows_create": {
        result = await chrome.windows.create(firstRec || {});
        break;
      }
      case "chrome_windows_update": {
        const windowId = firstRec.windowId || first;
        const updateInfo = firstRec.update || second || {};
        result = await chrome.windows.update(windowId, updateInfo);
        break;
      }
      case "chrome_windows_remove": {
        const windowId = firstRec.windowId || first;
        await chrome.windows.remove(windowId);
        result = null;
        break;
      }
      case "chrome_sidePanel_setOptions": {
        await chrome.sidePanel.setOptions(firstRec || {});
        result = null;
        break;
      }
      case "chrome_cookies_get": {
        // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
        result = await chrome.cookies.get((firstRec || {}) as any);
        break;
      }
      case "chrome_cookies_set": {
        // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
        result = await chrome.cookies.set((firstRec || {}) as any);
        break;
      }
      case "chrome_cookies_remove": {
        // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
        result = await chrome.cookies.remove((firstRec || {}) as any);
        break;
      }
      case "chrome_cookies_getAll": {
        // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
        result = await chrome.cookies.getAll((firstRec || {}) as any);
        break;
      }
      case "chrome_bookmarks_search": {
        const query =
          firstRec.query || (typeof first === "string" ? first : "") || "";
        result = await chrome.bookmarks.search(query);
        break;
      }
      case "chrome_bookmarks_create": {
        result = await chrome.bookmarks.create(firstRec || {});
        break;
      }
      case "chrome_bookmarks_remove": {
        const bookmarkId = firstRec.id || first;
        await chrome.bookmarks.remove(bookmarkId);
        result = null;
        break;
      }
      case "chrome_history_search": {
        // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
        result = await chrome.history.search((firstRec || {}) as any);
        break;
      }
      case "chrome_history_deleteUrl": {
        await chrome.history.deleteUrl(firstRec.url || first);
        result = null;
        break;
      }
      case "chrome_notifications_create": {
        const notifId =
          firstRec.id || (typeof first === "string" ? first : "") || "";
        const options = firstRec.options || second || {};
        result = await chrome.notifications.create(notifId as string, options);
        break;
      }
      case "chrome_notifications_clear": {
        const notifId =
          firstRec.id || (typeof first === "string" ? first : "") || "";
        result = await chrome.notifications.clear(notifId as string);
        break;
      }
      case "chrome_scripting_executeScript": {
        // biome-ignore lint/suspicious/noExplicitAny: bridging dynamic params to typed Chrome API
        result = await chrome.scripting.executeScript((firstRec || {}) as any);
        break;
      }
      default:
        return {
          ok: false,
          error: {
            message: `Unimplemented chrome action: ${command.action}`,
            code: "E_UNKNOWN",
            category: "unknown",
          },
        };
    }
    return { ok: true, value: result };
  } catch (err: unknown) {
    return normalizeChromeError(err);
  }
}

initExtensionListeners();
