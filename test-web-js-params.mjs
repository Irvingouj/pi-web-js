import { WebSession } from './crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();
    console.log('Session created');

    // Test without await (just check the returned value)
    try {
        const result = await session.runCellAsync('web.storage.get("mykey")', '');
        console.log('storage.get result:', JSON.stringify(result));
    } catch (e) {
        console.error('storage.get error:', e);
    }

    try {
        const result = await session.runCellAsync('web.cookies.get("mycookie")', '');
        console.log('cookies.get result:', JSON.stringify(result));
    } catch (e) {
        console.error('cookies.get error:', e);
    }

    try {
        const result = await session.runCellAsync('web.history.search("query")', '');
        console.log('history.search result:', JSON.stringify(result));
    } catch (e) {
        console.error('history.search error:', e);
    }

    try {
        const result = await session.runCellAsync('web.bookmarks.search("query")', '');
        console.log('bookmarks.search result:', JSON.stringify(result));
    } catch (e) {
        console.error('bookmarks.search error:', e);
    }
}

main();
