import { WebSession } from '../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();

    const tests = [
        'typeof tab',
        'typeof runtime',
        'typeof path',
        'typeof path.join',
        'typeof path.basename',
        'typeof path.dirname',
        'typeof path.extname',
        'typeof path.normalize',
        'typeof path.isAbsolute',
        'typeof page.fetch',
        'typeof page.go',
        'typeof page.open',
        'typeof page.enter',
        'typeof page.wait_for_load',
        'path.join("a", "b")',
        'path.basename("/a/b.txt")',
        'path.dirname("/a/b.txt")',
        'path.extname("/a/b.txt")',
        'path.normalize("/a/../b")',
        'path.isAbsolute("/a")',
        'path.sep',
    ];

    for (const code of tests) {
        const result = await session.runCellAsync(code, '');
        console.log(`${code}:`, result.result || JSON.stringify(result.error));
    }
}

main();
