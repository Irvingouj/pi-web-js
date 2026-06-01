const d = new Date(0);
const iso = d.toISOString();

console.log("toISOString():", JSON.stringify(iso));
console.log("length:", iso.length, "(expected 24)");
console.log("charCodes:", iso.split('').map(c => c.charCodeAt(0)).join(','));

const obj = { last_played: iso };
const json = JSON.stringify(obj);
console.log("JSON:", json);
console.log("has null bytes:", json.includes('\0'));

try {
  JSON.parse(json);
  console.log("parse: ok");
} catch (e) {
  console.log("parse failed:", e.message);
}
