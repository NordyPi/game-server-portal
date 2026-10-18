// `npm run dev` runs this first: copies the test fixtures into ./dev-data so the dev server has a
// fake AssettoServer folder to read and write (the fixtures themselves stay untouched).
import { cpSync, existsSync } from "node:fs";

const target = "dev-data/assetto-corsa";
if (!existsSync(target)) {
  cpSync("tests/fixtures/assetto-corsa", target, { recursive: true });
  console.log(`Created ${target} from the test fixtures.`);
}
