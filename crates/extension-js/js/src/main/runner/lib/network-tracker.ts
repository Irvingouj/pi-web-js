/// <reference types="chrome" />
import { logger } from "../../../shared/logger.js";
import { NETWORK_IDLE_QUIET_MS } from "./constants.js";

const log = logger.child("runner");

const TRACKED_RESOURCE_TYPES: `${chrome.webRequest.ResourceType}`[] = [
	"main_frame",
	"sub_frame",
	"stylesheet",
	"script",
	"xmlhttprequest",
	"font",
	"media",
	"other",
];

/**
 * Tracks in-flight network requests for a specific tab using chrome.webRequest.
 * Observe-only (MV3 compatible) — no request blocking or modification.
 */
export class NetworkTracker {
	private inFlight = new Map<string, number>();
	private onBeforeRequest:
		| ((
				details: chrome.webRequest.OnBeforeRequestDetails,
		  ) => chrome.webRequest.BlockingResponse | undefined)
		| null = null;
	private onCompleted:
		| ((details: chrome.webRequest.OnCompletedDetails) => void)
		| null = null;
	private onErrorOccurred:
		| ((details: chrome.webRequest.OnErrorOccurredDetails) => void)
		| null = null;

	constructor(private readonly tabId: number) {}

	start(): void {
		const api = globalThis.chrome?.webRequest;
		if (!api) {
			log.warn("networkTracker_unavailable", { tabId: this.tabId });
			return;
		}

		const filter: chrome.webRequest.RequestFilter = {
			tabId: this.tabId,
			urls: ["<all_urls>"],
			types: TRACKED_RESOURCE_TYPES,
		};

		this.onBeforeRequest = (details) => {
			if (details.tabId === this.tabId) {
				this.inFlight.set(details.requestId, Date.now());
			}
		};
		this.onCompleted = (details) => {
			if (details.tabId === this.tabId) {
				this.inFlight.delete(details.requestId);
			}
		};
		this.onErrorOccurred = (details) => {
			if (details.tabId === this.tabId) {
				this.inFlight.delete(details.requestId);
			}
		};

		api.onBeforeRequest.addListener(this.onBeforeRequest, filter);
		api.onCompleted.addListener(this.onCompleted, filter);
		api.onErrorOccurred.addListener(this.onErrorOccurred, filter);
		log.debug("networkTracker_started", { tabId: this.tabId });
	}

	get pendingCount(): number {
		return this.inFlight.size;
	}

	async waitForIdle(timeoutMs: number): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (this.inFlight.size === 0) {
				await new Promise((resolve) =>
					setTimeout(resolve, NETWORK_IDLE_QUIET_MS),
				);
				if (this.inFlight.size === 0) {
					log.debug("networkTracker_idle", { tabId: this.tabId });
					return;
				}
				continue;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(
			`Network idle timeout for tab ${this.tabId} (${this.inFlight.size} requests still in flight)`,
		);
	}

	dispose(): void {
		const api = globalThis.chrome?.webRequest;
		if (!api) return;
		if (this.onBeforeRequest)
			api.onBeforeRequest.removeListener(this.onBeforeRequest);
		if (this.onCompleted) api.onCompleted.removeListener(this.onCompleted);
		if (this.onErrorOccurred)
			api.onErrorOccurred.removeListener(this.onErrorOccurred);
		this.onBeforeRequest = null;
		this.onCompleted = null;
		this.onErrorOccurred = null;
		this.inFlight.clear();
		log.debug("networkTracker_disposed", { tabId: this.tabId });
	}
}
