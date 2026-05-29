import { WebSession } from '../crates/web-js/js/web_js.js';

async function main() {
    const session = new WebSession();
    session.set_fuel_limit(50000);

    const code = `i = 0;
while (i < 3) {
  print(i);
  i++;
}`;
    console.log('Testing while loop with fuel limit 50,000...');
    const result = await session.runCellAsync(code, '');
    console.log(`Result: ${JSON.stringify(result)}`);
}

main();
