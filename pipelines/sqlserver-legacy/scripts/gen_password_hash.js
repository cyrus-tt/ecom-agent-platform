const crypto = require("crypto");

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/gen_password_hash.js <password>");
  process.exit(1);
}

const hash = crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
console.log(hash);
