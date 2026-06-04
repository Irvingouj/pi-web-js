// Chrome extension background service worker
// Handles messages from the JS notebook popup

const __LOG_LEVEL = 3; // error
function bgLog(level, event, meta) {
	if (level < __LOG_LEVEL) return;
	const metaStr = meta
		? " " +
			Object.entries(meta)
				.map(([k, v]) => `${k}=${v}`)
				.join(" ")
		: "";
	const msg = `[extension-js][background] ${event}${metaStr}`;
	if (level >= 3) console.error(msg);
	else if (level === 2) console.warn(msg);
	else console.log(msg);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	// Echo back for basic ping/pong testing
	if (message && message.action === "ping") {
		sendResponse({ pong: true, timestamp: Date.now() });
		return true;
	}
	// Forward everything else — just acknowledge
	sendResponse({ ok: true });
	return true;
});

// Alarm handler — forwards alarm events to any listening popups
chrome.alarms.onAlarm.addListener((alarm) => {
	// Alarms are handled via direct polling in the popup
	bgLog(1, "alarm_fired", { name: alarm.name });
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener((info, _tab) => {
	// Context menu clicks are handled via direct listening in the popup
	bgLog(1, "context_menu_clicked", { menuItemId: info.menuItemId });
});

// Install handler — set up default context menus
chrome.runtime.onInstalled.addListener(() => {
	bgLog(1, "extension_installed");
});

// Open side panel on extension icon click (replaces popup)
chrome.sidePanel
	.setPanelBehavior({ openPanelOnActionClick: true })
	.catch((err) =>
		bgLog(3, "side_panel_behavior_failed", { error: err.message }),
	);
