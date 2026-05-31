import { WebSession } from '../../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();
    session.set_fuel_limit(100);
    console.log('Testing with fuel limit 100...');
    const start = Date.now();
    const result = await session.runCellAsync('while (true) {}', '');
    const elapsed = Date.now() - start;
    console.log(`Result: ${JSON.stringify(result)}`);
    console.log(`Elapsed: ${elapsed}ms`);
}

main();
