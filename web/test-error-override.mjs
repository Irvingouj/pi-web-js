import { WebSession } from '../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();
    console.log('Session created');

    // Test x = 10
    try {
        const result = await session.runCellAsync('x = 10', '');
        console.log('x = 10 result:', JSON.stringify(result));
    } catch (e) {
        console.error('x = 10 error:', e);
    }

    // Test print(x) after x = 10
    try {
        const result = await session.runCellAsync('print(x + 1)', '');
        console.log('print(x + 1) result:', JSON.stringify(result));
    } catch (e) {
        console.error('print(x + 1) error:', e);
    }

    // Test while loop
    try {
        const result = await session.runCellAsync('i = 0; while (i < 3) { print(i); i++; }', '');
        console.log('while loop result:', JSON.stringify(result));
    } catch (e) {
        console.error('while loop error:', e);
    }

    // Test Error constructor
    try {
        const result = await session.runCellAsync('typeof Error', '');
        console.log('typeof Error result:', JSON.stringify(result));
    } catch (e) {
        console.error('typeof Error error:', e);
    }
}

main();
