"use strict";
// Systematic logger for extension-js
// Supports level tuning via setLogLevel(). Default is "error".
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.setLogLevel = setLogLevel;
exports.getLogLevel = getLogLevel;
const LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4,
};
let currentLevel = "error";
function setLogLevel(level) {
    currentLevel = level;
}
function getLogLevel() {
    return currentLevel;
}
function shouldLog(level) {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}
exports.logger = {
    debug: (...args) => {
        if (shouldLog("debug"))
            console.log(...args);
    },
    info: (...args) => {
        if (shouldLog("info"))
            console.log(...args);
    },
    warn: (...args) => {
        if (shouldLog("warn"))
            console.warn(...args);
    },
    error: (...args) => {
        if (shouldLog("error"))
            console.error(...args);
    },
};
