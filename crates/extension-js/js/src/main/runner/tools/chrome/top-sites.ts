/// <reference types="chrome" />
import { regChrome, zChromeAny, zChromeNull } from "./register-helpers.js";

regChrome("chrome_topSites_get", ["topSites"], "Get top sites", zChromeAny, "chrome.topSites.get()");

regChrome("chrome_tts_getVoices", ["tts"], "Get TTS voices", zChromeAny, "chrome.tts.getVoices()");
regChrome("chrome_tts_speak", ["tts"], "Speak text", zChromeNull, "chrome.tts.speak(\"Hello world\")");
regChrome("chrome_tts_stop", ["tts"], "Stop TTS", zChromeNull, "chrome.tts.stop()");
