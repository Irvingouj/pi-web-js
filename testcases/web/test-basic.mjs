import { WebSession } from '../../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();
    console.log('Session created');

    const tests = [
        '1 + 1',
        'var x = 10',
        'x = 10',
        'let y = 10',
        'print(1)',
        'function f() { return 1; }',
        'f()',
        'typeof print',
        'typeof web',
        'typeof console',
        'new Promise(() => {})',
    ];

    for (const code of tests) {
        try {
            const result = await session.runCellAsync(code, '');
            console.log(`${code}:`, JSON.stringify(result.error) || result.result);
        } catch (e) {
            console.error(`${code} error:`, e);
        }
    }
}

main();
