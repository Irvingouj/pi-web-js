// Chrome extension background service worker
// Handles messages from the JS notebook popup

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Echo back for basic ping/pong testing
  if (message && message.action === 'ping') {
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
  console.log('[js-notebook] alarm fired:', alarm.name);
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Context menu clicks are handled via direct listening in the popup
  console.log('[js-notebook] context menu clicked:', info.menuItemId);
});

// Install handler — set up default context menus
chrome.runtime.onInstalled.addListener(() => {
  console.log('[js-notebook] extension installed');
});

// Open side panel on extension icon click (replaces popup)
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[js-notebook] side panel behavior failed:', err));
