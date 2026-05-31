import { WebSession } from '../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();
    console.log('Session created');

    try {
        const result = await session.runCellAsync('42', '');
        console.log('Result:', JSON.stringify(result));
    } catch (e) {
        console.error('Error:', e);
    }

    try {
        const result2 = await session.runCellAsync('Object()', '');
        console.log('Result2:', JSON.stringify(result2));
    } catch (e) {
        console.error('Error2:', e);
    }

    try {
        const result3 = await session.runCellAsync('new Date()', '');
        console.log('Result3:', JSON.stringify(result3));
    } catch (e) {
        console.error('Error3:', e);
    }

    try {
        const result4 = await session.runCellAsync('function F() {}; new F()', '');
        console.log('Result4:', JSON.stringify(result4));
    } catch (e) {
        console.error('Error4:', e);
    }
}

main();
