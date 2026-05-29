import { WebSession } from '../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();
    const result = await session.runCellAsync('x = 10', '');
    console.log('x = 10 result:', JSON.stringify(result));
}

main();
