/// <reference types="chrome" />
import { regChrome, zChromeNull } from "./register-helpers.js";

regChrome("chrome_topSites_get", ["topSites"], "Get top sites");

regChrome("chrome_tts_getVoices", ["tts"], "Get TTS voices");
regChrome("chrome_tts_speak", ["tts"], "Speak text", zChromeNull);
regChrome("chrome_tts_stop", ["tts"], "Stop TTS", zChromeNull);
