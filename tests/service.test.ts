import assert from "node:assert/strict";
import { test } from "node:test";
import { IniFile } from "@/lib/ini";
import { parseSystemctlShow, setUptimeSourceForTests } from "@/lib/service";

test("maps systemctl states", () => {
  setUptimeSourceForTests(() => 1000);
  const running = parseSystemctlShow("LoadState=loaded\nActiveState=active\nSubState=running\nActiveEnterTimestampMonotonic=940000000\n");
  assert.equal(running.state, "running");
  // Entered at 940 s of 1000 s uptime → about a minute ago.
  const ago = Date.now() - Date.parse(running.since!);
  assert.ok(ago > 59_000 && ago < 61_000, `started ${ago} ms ago`);

  assert.equal(parseSystemctlShow("LoadState=loaded\nActiveState=failed\nSubState=failed\n").state, "failed");
  assert.equal(parseSystemctlShow("LoadState=loaded\nActiveState=inactive\nSubState=dead\n").since, null);
  assert.deepEqual(parseSystemctlShow("LoadState=not-found\nActiveState=inactive\n"), {
    state: "unknown",
    since: null,
    detail: "systemd unit not installed",
  });
});

test("ini: adds missing keys inside their section and creates missing sections", () => {
  const ini = new IniFile("[SERVER]\nNAME=a\n\n[PRACTICE]\nTIME=10\n");
  ini.set("server", "password", "x");
  ini.set("WEATHER_0", "GRAPHICS", "3_clear");
  assert.equal(ini.toString(), "[SERVER]\nNAME=a\nPASSWORD=x\n\n[PRACTICE]\nTIME=10\n[WEATHER_0]\nGRAPHICS=3_clear\n");
  assert.throws(() => ini.set("SERVER", "NAME", "a\nTRACK=b"));
});
