/// <reference types="chrome" />
import { regChrome, zChromeNull } from "./register-helpers.js";

regChrome("chrome_browsingData_remove", ["browsingData"], "Remove browsing data");
regChrome("chrome_browsingData_removeCache", ["browsingData"], "Remove cache");
regChrome("chrome_browsingData_removeCookies", ["browsingData"], "Remove cookies");
regChrome("chrome_browsingData_removeDownloads", ["browsingData"], "Remove downloads");
regChrome("chrome_browsingData_removeFormData", ["browsingData"], "Remove form data");
regChrome("chrome_browsingData_removeHistory", ["browsingData"], "Remove history");
regChrome("chrome_browsingData_removePasswords", ["browsingData"], "Remove passwords", zChromeNull);
