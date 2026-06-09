/// <reference types="chrome" />
import { regChrome, zChromeAny, zChromeNull } from "./register-helpers.js";

regChrome("chrome_browsingData_remove", ["browsingData"], "Remove browsing data", zChromeAny, "chrome.browsingData.remove({ since: 0 })", "null");
regChrome("chrome_browsingData_removeCache", ["browsingData"], "Remove cache", zChromeAny, "chrome.browsingData.removeCache({ since: 0 })", "null");
regChrome("chrome_browsingData_removeCookies", ["browsingData"], "Remove cookies", zChromeAny, "chrome.browsingData.removeCookies({ since: 0 })", "null");
regChrome("chrome_browsingData_removeDownloads", ["browsingData"], "Remove downloads", zChromeAny, "chrome.browsingData.removeDownloads({ since: 0 })", "null");
regChrome("chrome_browsingData_removeFormData", ["browsingData"], "Remove form data", zChromeAny, "chrome.browsingData.removeFormData({ since: 0 })", "null");
regChrome("chrome_browsingData_removeHistory", ["browsingData"], "Remove history", zChromeAny, "chrome.browsingData.removeHistory({ since: 0 })", "null");
regChrome("chrome_browsingData_removePasswords", ["browsingData"], "Remove passwords", zChromeNull, "chrome.browsingData.removePasswords({ since: 0 })", "null");
