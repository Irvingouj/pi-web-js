/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_system_cpu_getInfo",
	"chrome",
	"Get CPU info",
	["system", "cpu"],
	schemas.ChromeSystemCpuGetInfoParamsSchema,
	schemas.ChromeSystemCpuInfoSchema,
	"ECHROME",
	"extension",
	[],
);
registerChromePassthrough(
	"chrome_system_memory_getInfo",
	"chrome",
	"Get memory info",
	["system", "memory"],
	schemas.ChromeSystemMemoryGetInfoParamsSchema,
	schemas.ChromeSystemMemoryInfoSchema,
	"ECHROME",
	"extension",
	[],
);
registerChromePassthrough(
	"chrome_system_storage_getInfo",
	"chrome",
	"Get storage info",
	["system", "storage"],
	schemas.ChromeSystemStorageGetInfoParamsSchema,
	schemas.ChromeSystemStorageInfoSchema,
	"ECHROME",
	"extension",
	[],
);
