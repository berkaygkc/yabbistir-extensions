import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";
import { sources, portsOf, rowsOf } from "../src/index.ts";

const folder = new URL("..", import.meta.url);

/** One synthetic `docker ps --format '{{json .}}'` line, with the fields docker prints. */
function line(over = {}) {
  return JSON.stringify({
    Command: "\"docker-entrypoint.s…\"", CreatedAt: "2026-01-01 09:00:00 +0300 +03", ID: "0a1b2c3d4e5f", Image: "postgres:16",
    Labels: "", LocalVolumes: "1", Mounts: "abc", Names: "ornek-db", Networks: "bridge",
    Ports: "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp", RunningFor: "2 hours ago", Size: "0B", State: "running", Status: "Up 2 hours", ...over,
  });
}

const RUNNING = [
  line(),
  line({ ID: "1", Names: "ornek-web", Image: "nginx:1.27", Status: "Up 5 minutes (healthy)", Ports: "0.0.0.0:8080->80/tcp, :::8080->80/tcp" }),
  line({ ID: "2", Names: "ornek-worker", Image: "ornek/worker:latest", Status: "Up About an hour", Ports: "" }),
].join("\n") + "\n";
const STOPPED = line({ ID: "3", Names: "eski-is", Image: "alpine", State: "exited", Status: "Exited (0) 3 days ago", Ports: "" }) + "\n";

/** A fake docker: `--all` adds the stopped container; `state` changes what it does. */
function fakeDocker(changes = {}) {
  const state = { exitCode: 0, stdout: undefined, stderr: "", calls: [], ...changes };
  const docker = (args) => {
    state.calls.push(args);
    if (state.exitCode !== 0) return { exitCode: state.exitCode, stdout: "", stderr: state.stderr };
    return { exitCode: 0, stdout: state.stdout ?? RUNNING + (args.includes("--all") ? STOPPED : ""), stderr: "" };
  };
  return Object.assign(docker, { state });
}

function hostWith(docker, preferences = {}, language = "en") {
  return createFakeHost({ folder, sources, exec: { docker }, preferences, context: { language } });
}

describe("listing", () => {
  test("running containers: name, then image · status · ports", async () => {
    const docker = fakeDocker();
    const listing = await hostWith(docker).list("containers");
    assert.deepEqual(listing.rows, [
      { id: "ornek-db", title: "ornek-db", subtitle: "postgres:16 · Up 2 hours · 5432→5432/tcp" },
      { id: "ornek-web", title: "ornek-web", subtitle: "nginx:1.27 · Up 5 minutes (healthy) · 8080→80/tcp" },
      { id: "ornek-worker", title: "ornek-worker", subtitle: "ornek/worker:latest · Up About an hour" },
    ]);
    assert.ok(!docker.state.calls[0].includes("--all"));
  });

  test("the toggle adds stopped containers with --all", async () => {
    const docker = fakeDocker();
    const listing = await hostWith(docker, { all: true }).list("containers");
    assert.equal(listing.rows.length, 4);
    assert.deepEqual(listing.rows.at(-1), { id: "eski-is", title: "eski-is", subtitle: "alpine · Exited (0) 3 days ago" });
    assert.ok(docker.state.calls[0].includes("--all"));
  });

  test("empty state is an empty list", async () => {
    const listing = await hostWith(fakeDocker({ stdout: "" })).list("containers");
    assert.deepEqual(listing, { rows: [] });
  });

  test("ids are stable between listings and unique", async () => {
    const duplicate = fakeDocker({ stdout: RUNNING + line() + "\n" });
    const first = (await hostWith(duplicate).list("containers")).rows.map((row) => row.id);
    const second = (await hostWith(duplicate).list("containers")).rows.map((row) => row.id);
    assert.deepEqual(first, second);
    assert.equal(new Set(first).size, first.length);
  });

  test("skips lines that are not containers, and unusable names", () => {
    const rows = rowsOf(["WARNING: something", "", "{not json", "[1]", "null", line({ Names: "" }), line({ Names: "bad name; rm" }), line({ Names: 5 }), line({ Names: "iyi" })]);
    assert.deepEqual(rows.map((row) => row.id), ["iyi"]);
  });

  test("a link alias is not the container's name", () => {
    assert.equal(rowsOf([line({ Names: "webapp/db,ornek-db" })])[0].id, "ornek-db");
    assert.equal(rowsOf([line({ Names: "ornek-db,webapp/db" })])[0].id, "ornek-db");
  });

  test("a long status and image fit the app's limits", async () => {
    const long = fakeDocker({ stdout: line({ Status: "Up " + "very long ".repeat(80), Image: "registry.ornek.dev/" + "a".repeat(300) }) + "\n" });
    const { rows } = await hostWith(long).list("containers");
    assert.equal(rows.length, 1);
    assert.ok([...rows[0].subtitle].length <= 256);
  });

  test("missing fields give a title alone", () => {
    assert.deepEqual(rowsOf([JSON.stringify({ Names: "yalin" })]), [{ id: "yalin", title: "yalin", subtitle: undefined }]);
  });
});

describe("ports", () => {
  test("host addresses go, IPv4 and IPv6 twins merge", () => {
    assert.equal(portsOf("0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, :::8080->80/tcp"), "8080→80/tcp");
    assert.equal(portsOf("127.0.0.1:3000->3000/tcp"), "3000→3000/tcp");
  });
  test("exposed only, ranges and udp are kept", () => {
    assert.equal(portsOf("5432/tcp"), "5432/tcp");
    assert.equal(portsOf("0.0.0.0:8000-8002->8000-8002/tcp, 53/udp"), "8000-8002→8000-8002/tcp, 53/udp");
  });
  test("a long list ends in +N", () => {
    const many = Array.from({ length: 6 }, (_, i) => `0.0.0.0:${9000 + i}->${i + 1}/tcp`).join(", ");
    const restore = hostWith(fakeDocker()).install();
    try {
      assert.equal(portsOf(many), "9000→1/tcp, 9001→2/tcp, 9002→3/tcp +3");
    } finally {
      restore();
    }
  });
  test("empty and odd input", () => {
    assert.equal(portsOf(""), "");
    assert.equal(portsOf(undefined), "");
    assert.equal(portsOf(", ,"), "");
  });
  test("an adversarial port list is quick", () => {
    const started = Date.now();
    portsOf("a:".repeat(50_000) + "->" + ",".repeat(50_000));
    assert.ok(Date.now() - started < 500);
  });
  test("many containers parse within the time limit", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => line({ Names: `c-${i}` }));
    const started = Date.now();
    assert.equal(rowsOf(lines).length, 5000);
    assert.ok(Date.now() - started < 2000);
  });
});

describe("failures", () => {
  const DOWN = [
    "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
    "error during connect: Get \"http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.47/containers/json\": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.",
    "Cannot connect to the Docker daemon at unix:///Users/ornek/.colima/default/docker.sock. Is the docker daemon running?",
  ];
  for (const stderr of DOWN) {
    test(`daemon down is a locked listing: ${stderr.slice(0, 30)}`, async () => {
      const listing = await hostWith(fakeDocker({ exitCode: 1, stderr })).list("containers");
      assert.deepEqual(listing, { locked: true, message: "Docker isn’t running" });
    });
  }

  test("no access to the socket says so, not that docker is off", async () => {
    const stderr = "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get \"http://%2Fvar%2Frun%2Fdocker.sock/v1.47/containers/json\"";
    assert.deepEqual(await hostWith(fakeDocker({ exitCode: 1, stderr })).list("containers"), { locked: true, message: "Docker refused access" });
    assert.equal((await hostWith(fakeDocker({ exitCode: 1, stderr }), {}, "tr").list("containers")).message, "Docker erişimi reddetti");
  });

  test("the locked message is Turkish when the app is", async () => {
    const listing = await hostWith(fakeDocker({ exitCode: 1, stderr: DOWN[0] }), {}, "tr").list("containers");
    assert.equal(listing.message, "Docker çalışmıyor");
  });

  test("another failure says so without docker's text", async () => {
    const secret = "gh" + "p_" + "a".repeat(36);
    await assert.rejects(hostWith(fakeDocker({ exitCode: 125, stderr: `unknown flag ${secret}` })).list("containers"), (error) => {
      assert.equal(error.message, "Docker could not list the containers.");
      return true;
    });
  });

  test("docker missing is toolMissing", async () => {
    const host = createFakeHost({ folder, sources, exec: {} });
    await assert.rejects(host.list("containers"), { code: "toolMissing" });
  });

  test("a failing docker rejects and nothing is logged", async () => {
    const host = createFakeHost({ folder, sources, exec: { docker: () => new Error("boom") } });
    await assert.rejects(host.list("containers"));
    assert.deepEqual(host.logs, []);
  });

  test("a docker that never answers ends when the list is cancelled", async () => {
    const host = createFakeHost({ folder, sources, exec: { docker: () => new Promise(() => {}) } });
    const running = host.list("containers");
    setTimeout(() => host.cancel(), 10);
    await assert.rejects(running, { code: "cancelled" });
    assert.deepEqual(host.logs, []);
  });

  test("a name over 128 characters is skipped, not a failed listing", () => {
    assert.deepEqual(rowsOf([line({ Names: "a".repeat(129) }), line({ Names: "a".repeat(128) })]).map((row) => row.id.length), [128]);
  });
});

describe("actions", () => {
  test("↵ pastes the name", async () => {
    assert.deepEqual(await hostWith(fakeDocker()).runSource("containers", "ornek-web", "name"), { text: "ornek-web" });
  });
  test("⇧↵ pastes docker exec -it <name> sh", async () => {
    assert.deepEqual(await hostWith(fakeDocker()).runSource("containers", "ornek-web", "exec"), { text: "docker exec -it ornek-web sh" });
  });
  test("running an action calls no tool", async () => {
    const docker = fakeDocker();
    await hostWith(docker).runSource("containers", "ornek-web", "exec");
    assert.equal(docker.state.calls.length, 0);
  });
  test("an id that is not a name never becomes a command", async () => {
    for (const id of ["a; rm -rf /", "$(x)", "-v", "a b", "x\nrm", ""]) {
      await assert.rejects(hostWith(fakeDocker()).runSource("containers", id, "exec"), /can’t be used/);
    }
  });
  test("an unknown action is refused", async () => {
    await assert.rejects(hostWith(fakeDocker()).runSource("containers", "ornek-web", "other"));
  });
  test("both actions are in the manifest in order, and the first copies", () => {
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", folder), "utf8"));
    const [source] = manifest.contributes.sources;
    assert.deepEqual(source.actions.map((action) => action.id), ["name", "exec"]);
    assert.ok(source.actions[0].copyTitle);
    assert.equal(source.actions[1].copyTitle, undefined);
  });
});

describe("nothing leaks", () => {
  test("a listing writes no log or notification and no row carries docker's stderr", async () => {
    const secret = "gh" + "p_" + "a".repeat(36);
    const host = hostWith(fakeDocker({ stderr: secret }));
    const { rows } = await host.list("containers");
    assert.ok(!JSON.stringify(rows).includes(secret));
    assert.deepEqual(host.logs, []);
    assert.deepEqual(host.notifications, []);
  });
});
