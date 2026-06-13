// Wikipedia 7th-word-of-2nd-paragraph acceptance test.
// Drives the extension via the dev-bridge /run endpoint.
// Uses page.find (native querySelectorAll, no eval) to extract paragraphs.
const results = [];
for (let i = 0; i < 10; i++) {
	try {
		// Navigate to a random Wikipedia article.
		await page.goto("https://en.wikipedia.org/wiki/Special:Random");
		// Give the page a moment to settle (Wikipedia random redirects).
		await web.sleep(500);

		const title = await page.title();
		const url = await page.url();

		// Find article-body paragraphs. page.find returns native DOM results,
		// bypassing page CSP. Text is truncated to 100 chars but that's enough
		// for the 7th word.
		const found = await page.find({
			selector: "#mw-content-text .mw-parser-output > p, #mw-content-text p",
		});

		const paragraphs = (found || [])
			.filter(
				(p) =>
					p &&
					typeof p.text === "string" &&
					p.text.length > 20 &&
					// skip disambiguation / empty / coord lines
					!/^\s*\[edit\]/.test(p.text),
			)
			.slice(0, 5);
		const second = paragraphs[1]?.text || "";
		const words = second.split(/\s+/).filter((w) => w.length > 0);
		const seventh = words[6] || "(no 7th word)";

		results.push({
			i,
			topic: title,
			url,
			firstParaPreview: paragraphs[0]?.text?.slice(0, 80) || "",
			secondParaPreview: second.slice(0, 150),
			seventhWord: seventh,
		});
	} catch (err) {
		results.push({
			i,
			error: (err && err.message) || String(err),
		});
	}
}
print(JSON.stringify(results, null, 2));
