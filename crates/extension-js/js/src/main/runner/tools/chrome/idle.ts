/// <reference types="chrome" />
import { regChrome } from "./register-helpers.js";

regChrome("chrome_idle_queryState", ["idle"], "Query idle state");
