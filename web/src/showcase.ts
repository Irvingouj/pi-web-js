import type { Notebook } from "./notebook";
import { createCell } from "./notebook";

/**
 * Creates a showcase notebook demonstrating all notebook features.
 * Activated via ?showcase=true query parameter.
 */
export function createShowcaseNotebook(): Notebook {
  return {
    version: 1,
    cells: [
      // ─── Section 1: Welcome ─────────────────────────────────────
      createCell(
        "# ⚡ JS Notebook\n\n" +
          "An interactive JavaScript environment running entirely in the browser via **WebAssembly**.\n\n" +
          "### What you can do\n" +
          "- Write and execute **JavaScript** in code cells\n" +
          "- Add **Markdown** cells for documentation\n" +
          "- Use built-in APIs: `web.fetch`, `web.storage`, `crypto`\n" +
          "- Everything runs client-side — **no server required**\n\n" +
          "Press `Ctrl+Enter` to run a code cell. Double-click this text to edit the markdown.",
        "markdown",
      ),

      // ─── Section 2: Basic JS ────────────────────────────────────
      createCell(
        "## Variables & Control Flow\n\n" +
          "JavaScript basics: variables, loops, conditionals.",
        "markdown",
      ),
      createCell(
        "// Variables (let, const)\n" +
          'const name = "JavaScript";\n' +
          "const version = 2024;\n" +
          'console.log(`Hello from ${name} ${version}!`);\n\n' +
          "// Loop\n" +
          "for (let i = 1; i <= 5; i++) {\n" +
          '  console.log(`  count: ${i}`);\n' +
          "}",
      ),

      // ─── Section 3: Functions ───────────────────────────────────
      createCell(
        "## Functions & Arrow Functions\n\n" +
          "JavaScript has first-class functions with closures and arrow syntax.",
        "markdown",
      ),
      createCell(
        "// Recursive fibonacci\n" +
          "function fib(n) {\n" +
          "  if (n <= 1) return n;\n" +
          "  return fib(n - 1) + fib(n - 2);\n" +
          "}\n\n" +
          "for (let i = 0; i <= 10; i++) {\n" +
          '  console.log(`fib(${i}) = ${fib(i)}`);\n' +
          "}",
      ),

      // ─── Section 4: Objects & Arrays ──────────────────────────────
      createCell(
        "## Objects & Arrays\n\n" +
          "JavaScript's core data structures: objects as dictionaries and arrays as ordered lists.",
        "markdown",
      ),
      createCell(
        "// Object as dictionary\n" +
          "const person = {\n" +
          '  name: "Ada",\n' +
          "  age: 36,\n" +
          '  skills: ["math", "programming", "poetry"]\n' +
          "};\n\n" +
          'console.log(`${person.name} is ${person.age} years old`);\n' +
          'console.log("Skills:");\n' +
          "for (const [i, skill] of person.skills.entries()) {\n" +
          '  console.log(`  ${i + 1}. ${skill}`);\n' +
          "}",
      ),

      // ─── Section 5: JSON ────────────────────────────────────────
      createCell(
        "## JSON Encoding & Decoding\n\n" +
          "Built-in `JSON` object for working with structured data.",
        "markdown",
      ),
      createCell(
        "const data = {\n" +
          '  name: "web-js",\n' +
          '  version: "0.1.0",\n' +
          '  features: ["notebook", "wasm", "async"]\n' +
          "};\n\n" +
          "// Encode to JSON\n" +
          "const encoded = JSON.stringify(data);\n" +
          'console.log("JSON:", encoded);\n\n' +
          "// Decode back\n" +
          "const decoded = JSON.parse(encoded);\n" +
          'console.log("Decoded name:", decoded.name);\n' +
          'console.log("Features:", decoded.features.join(", "));',
      ),

      // ─── Section 6: HTTP Fetch ──────────────────────────────────
      createCell(
        "## 🌐 HTTP Requests\n\n" +
          "Fetch data from any public API using `web.fetch`.\n\n" +
          "> **Note:** This runs in a sandboxed environment. Some APIs may block cross-origin requests.",
        "markdown",
      ),
      createCell(
        "// Fetch a public API\n" +
          "try {\n" +
          "  const result = await web.fetch({\n" +
          '    url: "https://httpbin.org/get",\n' +
          '    method: "GET"\n' +
          "  });\n\n" +
          '  console.log("Status:", result.status);\n' +
          "  const body = JSON.parse(result.body);\n" +
          '  console.log("Origin:", body.origin || "unknown");\n' +
          '  console.log("User-Agent:", body.headers["User-Agent"] || "unknown");\n' +
          "} catch (err) {\n" +
          '  console.log("Fetch blocked (CORS):", err.message);\n' +
          '  console.log("This is expected in sandboxed environments!");\n' +
          "}",
      ),

      // ─── Section 7: Storage ─────────────────────────────────────
      createCell(
        "## 💾 Local Storage\n\n" +
          "Persist data across cells using `web.storage`.\n\n" +
          "Data is stored in the browser's `localStorage`.",
        "markdown",
      ),
      createCell(
        "// Set a value\n" +
          'web.storage.set("demo_key", "Hello from JS!");\n' +
          'web.storage.set("counter", "42");\n\n' +
          "// Get it back\n" +
          'const val = web.storage.get("demo_key");\n' +
          'console.log("Stored value:", val);\n\n' +
          "// List all keys\n" +
          "const keys = web.storage.list();\n" +
          'console.log("Storage keys:", keys.join(", "));',
      ),

      // ─── Section 8: Crypto ──────────────────────────────────────
      createCell(
        "## 🔐 Cryptography\n\n" +
          "Built-in `crypto` module for hashing and encoding.",
        "markdown",
      ),
      createCell(
        "// SHA-256 hash\n" +
          'console.log("SHA-256 of \'hello\':");\n' +
          'console.log("  ", crypto.sha256("hello"));\n\n' +
          "// MD5 hash\n" +
          'console.log("MD5 of \'hello\':");\n' +
          'console.log("  ", crypto.md5("hello"));\n\n' +
          "// HMAC-SHA256\n" +
          'console.log("HMAC-SHA256(key, message):");\n' +
          'console.log("  ", crypto.hmac_sha256("secret", "message"));\n\n' +
          "// Hex encode/decode\n" +
          'const hex = crypto.hex_encode("Hello, JS!");\n' +
          'console.log("Hex encoded:", hex);\n' +
          'console.log("Decoded back:", crypto.hex_decode(hex));',
      ),

      // ─── Section 9: URL utilities ───────────────────────────────
      createCell(
        "## 🔗 URL Utilities\n\n" + "Parse and construct URLs with `web.url`.",
        "markdown",
      ),
      createCell(
        "// Parse a URL\n" +
          'const parsed = web.url.parse("https://example.com:8080/path?q=js&sort=asc#section");\n' +
          'console.log("Protocol:", parsed.scheme);\n' +
          'console.log("Host:", parsed.host);\n' +
          'console.log("Port:", parsed.port);\n' +
          'console.log("Path:", parsed.path);\n' +
          'console.log("Query:", parsed.query);\n' +
          'console.log("Fragment:", parsed.fragment);',
      ),

      // ─── Section 10: Async & Sleep ──────────────────────────────
      createCell(
        "## ⏱ Async Operations\n\n" +
          "Built-in `web.sleep` for async delays. The notebook handles async/await transparently.",
        "markdown",
      ),
      createCell(
        "// Async sleep\n" +
          'console.log("Starting...");\n' +
          "await web.sleep(500);  // 500ms pause\n" +
          'console.log("Halfway there...");\n' +
          "await web.sleep(500);  // another 500ms\n" +
          'console.log("Done! Total: ~1 second");',
      ),

      // ─── Footer ─────────────────────────────────────────────────
      createCell(
        "---\n\n" +
          "### 🚀 What next?\n\n" +
          "- Edit any cell above and re-run it\n" +
          "- Add new cells with **+ Code** or **+ Markdown**\n" +
          "- Click **↻ Restart** to reset the JS state\n" +
          "- Use **↓ Save** to download your notebook as JSON\n\n" +
          "Built with QuickJS (JS engine in Rust → WebAssembly)",
        "markdown",
      ),
    ],
    metadata: {
      runtime: "boa",
      language: "javascript",
    },
  };
}
