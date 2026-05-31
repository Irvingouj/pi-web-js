import { WebSession } from '../../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();

    // Test with default fuel limit
    console.log('Testing with default fuel limit...');
    const start = Date.now();
    const result = await session.runCellAsync('while (true) {}', '');
    const elapsed = Date.now() - start;
    console.log(`Result: ${JSON.stringify(result)}`);
    console.log(`Elapsed: ${elapsed}ms`);
}

main();
