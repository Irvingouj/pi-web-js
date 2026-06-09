#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TESTCASES_ROOT = path.join(REPO_ROOT, "testcases");
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? "9292");

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
};

function resolveFilePath(urlPathname) {
	if (!urlPathname.startsWith("/testcases/")) {
		return null;
	}
	const relative = urlPathname.slice("/testcases/".length);
	let filePath = path.join(TESTCASES_ROOT, relative);
	if (filePath.endsWith("/")) {
		filePath = path.join(filePath, "index.html");
	} else if (!path.extname(filePath) && existsSync(filePath)) {
		const indexPath = path.join(filePath, "index.html");
		if (existsSync(indexPath)) {
			filePath = indexPath;
		}
	} else if (!path.extname(filePath)) {
		const indexPath = path.join(filePath, "index.html");
		if (existsSync(indexPath)) {
			filePath = indexPath;
		}
	}
	const normalized = path.normalize(filePath);
	if (!normalized.startsWith(TESTCASES_ROOT)) {
		return null;
	}
	return normalized;
}

const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
		const filePath = resolveFilePath(url.pathname);
		if (!filePath || !existsSync(filePath)) {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			res.end("not found");
			return;
		}
		const body = await readFile(filePath);
		const ext = path.extname(filePath).toLowerCase();
		res.writeHead(200, {
			"content-type": MIME_TYPES[ext] ?? "application/octet-stream",
		});
		res.end(body);
	} catch (err) {
		res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
		res.end(err instanceof Error ? err.message : String(err));
	}
});

server.listen(PORT, HOST, () => {
	const base = `http://${HOST}:${PORT}`;
	console.log(`Serving testcases from ${TESTCASES_ROOT}`);
	console.log(`${base}/testcases/simple-form-1/`);
});
