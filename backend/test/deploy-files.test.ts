import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// These files run on the droplet beside the scale stations and nothing on
// GitHub can run them there, so what has already gone wrong is held in place here.
describe("the deploy files fit the shared droplet", () => {
  // The droplet has nginx 1.24 (Ubuntu 24.04), and `http2 on;` needs 1.25.1.
  for (const example of ["deploy/nginx-zoilabe.conf.example", "deploy/test-copy/nginx-zoilabe-test.conf.example"]) {
    it(`${example} turns HTTP/2 on the way nginx 1.24 understands`, () => {
      const site = read(example);
      assert.doesNotMatch(site, /^\s*http2\s/m);
      assert.match(site, /^\s*listen 443 ssl http2;$/m);
      assert.match(site, /^\s*listen \[::\]:443 ssl http2;$/m);
    });
  }

  it("the setup page never leaves a site nginx refused in sites-enabled", () => {
    // A refused file stays harmless only until the droplet restarts: nginx
    // then does not start at all, and every app's site is down with it.
    const page = read("docs/test-copy.md");
    const checks = page.split("\n").filter((line) => line.includes("nginx -t &&"));
    assert.ok(checks.length >= 2);
    for (const line of checks) {
      assert.match(line, /\|\| sudo rm \/etc\/nginx\/sites-enabled\/zoilabe-test$/);
    }
  });

  const installer = read("deploy/test-copy/install-build.sh");

  it("install-build.sh waits for any other deploy on the droplet", () => {
    assert.match(installer, /^exec 9>\/run\/lock\/droplet-deploy\.lock$/m);
    const waits = installer.indexOf("flock -w 600 9");
    assert.ok(waits !== -1 && waits < installer.indexOf("==> Unpacking the build"));
  });

  it("install-build.sh keeps the app's folder open to Nginx", () => {
    // `rsync -a` hands the source folder's permissions on to $APP, and mktemp makes it 700.
    const opened = installer.indexOf('chmod 755 "$BUILD"');
    const copied = installer.indexOf("rsync -a --delete");
    assert.ok(opened !== -1 && copied !== -1 && opened < copied);
  });

  it("the test copy's programs are the first to end if memory runs out", () => {
    for (const unit of ["zoilabe-test-api.service", "zoilabe-test-update.service"]) {
      assert.match(read(`deploy/test-copy/${unit}`), /^OOMScoreAdjust=500$/m);
    }
  });
});
