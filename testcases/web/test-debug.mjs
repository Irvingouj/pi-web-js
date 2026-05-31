import { WebSession } from '../../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();

    const tests = [
        'typeof x',
        'this.x = 10',
        'typeof x',
        'x',
        'var y = 20',
        'y = 30',
        'y',
        'z = 40',
        'z',
    ];

    for (const code of tests) {
        const result = await session.runCellAsync(code, '');
        console.log(`${code}:`, JSON.stringify(result));
    }
}

main();
