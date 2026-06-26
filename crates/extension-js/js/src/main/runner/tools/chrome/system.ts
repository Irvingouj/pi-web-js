import * as schemas from "../../../../shared/cross/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_system_cpu_getInfo",
	"chrome",
	"Get CPU info",
	["system", "cpu"],
	schemas.ChromeSystemCpuInfoSchema,
	"ECHROME",
	"extension",
	[],
	"chrome.system.cpu.getInfo()",
);
registerChromePassthrough(
	"chrome_system_memory_getInfo",
	"chrome",
	"Get memory info",
	["system", "memory"],
	schemas.ChromeSystemMemoryInfoSchema,
	"ECHROME",
	"extension",
	[],
	"chrome.system.memory.getInfo()",
);
registerChromePassthrough(
	"chrome_system_storage_getInfo",
	"chrome",
	"Get storage info",
	["system", "storage"],
	schemas.ChromeSystemStorageInfoSchema,
	"ECHROME",
	"extension",
	[],
	"chrome.system.storage.getInfo()",
);
