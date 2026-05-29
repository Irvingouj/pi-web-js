import { WebSession } from '../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();
    
    // Run 1 + 1 first
    const r1 = await session.runCellAsync('1 + 1', '');
    console.log('1 + 1:', JSON.stringify(r1));
    
    // Then x = 10
    const r2 = await session.runCellAsync('x = 10', '');
    console.log('x = 10:', JSON.stringify(r2));
    
    // Then print(x)
    const r3 = await session.runCellAsync('print(x)', '');
    console.log('print(x):', JSON.stringify(r3));
}

main();
