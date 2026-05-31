import { WebSession } from '../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();
    console.log('Session created');

    const tests = [
        'typeof web',
        'typeof web.tab',
        'typeof web.storage',
        'typeof web.cookies',
        'typeof web.history',
        'typeof web.bookmarks',
        'typeof web.notifications',
        'typeof web.clipboard',
        'typeof fs',
        'typeof chrome',
        'typeof chrome.tabs',
        'typeof dom',
        'typeof page',
        'typeof path',
        'typeof sidepanel',
        'typeof host',
        'typeof runtime',
        'typeof tab',
        'typeof tab.current',
        'typeof page.go',
        'typeof page.fetch',
        'typeof runtime.fetch',
        'typeof runtime.storage',
        'typeof web.fetch',
        'typeof web.sleep',
        'typeof web.log',
    ];

    for (const code of tests) {
        try {
            const result = await session.runCellAsync(code, '');
            console.log(`${code}:`, result.result);
        } catch (e) {
            console.error(`${code} error:`, e);
        }
    }
}

main();
