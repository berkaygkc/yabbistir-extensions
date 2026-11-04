import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeHost } from "@yabbistir/api/fake-host";
import { sources, rowsOf, reasonOf } from "../src/index.ts";

const folder = new URL("..", import.meta.url);

const pod = (namespace, name, extra = {}) => ({
  metadata: { name, namespace },
  spec: { containers: [{ name: "app" }, { name: "side" }] },
  status: { phase: "Running", containerStatuses: [{ ready: true }, { ready: true }] },
  ...extra,
});

const PODS = [
  pod("web", "api-7d9f-xk2lp"),
  pod("db", "postgres-0", { spec: { containers: [{ name: "pg" }] }, status: { phase: "Running", containerStatuses: [{ ready: false }] } }),
  pod("web", "api-7d9f-b1c3d", { status: { phase: "Running", containerStatuses: [{ ready: true }, { ready: false, state: { waiting: { reason: "CrashLoopBackOff" } } }] } }),
  pod("batch", "job-1-abcde", { status: { phase: "Succeeded", containerStatuses: [{ ready: false }, { ready: false }] } }),
  pod("batch", "job-2-fghij", { status: { phase: "Pending", initContainerStatuses: [{ state: { waiting: { reason: "ImagePullBackOff" } } }] } }),
  pod("web", "old-1", { metadata: { name: "old-1", namespace: "web", deletionTimestamp: "2026-01-01T00:00:00Z" } }),
  pod("web", "evicted-1", { status: { phase: "Failed", reason: "Evicted" } }),
];

function fakeKubectl(changes = {}) {
  const state = { context: "kind-demo", contextExit: 0, pods: { items: PODS }, getExit: 0, getStderr: "", raw: undefined, ...changes };
  const kubectl = (args) => {
    if (args[0] === "config") {
      return state.contextExit === 0
        ? { exitCode: 0, stdout: `${state.context}\n`, stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "error: current-context is not set\n" };
    }
    if (args[0] === "get") {
      return { exitCode: state.getExit, stdout: state.getExit === 0 ? (state.raw ?? JSON.stringify(state.pods, null, 2)) : "", stderr: state.getStderr };
    }
    return { exitCode: 1, stdout: "", stderr: "unknown" };
  };
  return Object.assign(kubectl, { state });
}
const hostWith = (kubectl, preferences = {}, language = "en") => createFakeHost({ folder, sources, exec: { kubectl }, preferences, context: { language } });
const getArgs = (host) => host.calls.filter((c) => c.api === "exec" && c.args[1][0] === "get").map((c) => c.args[1]);

describe("list", () => {
  test("parses pods: sorted by namespace then name, phase and readiness", async () => {
    const { rows } = await hostWith(fakeKubectl()).list("pods");
    assert.deepEqual(rows.map((r) => r.id), [
      "batch/job-1-abcde", "batch/job-2-fghij", "db/postgres-0",
      "web/api-7d9f-b1c3d", "web/api-7d9f-xk2lp", "web/evicted-1", "web/old-1",
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(by["web/api-7d9f-xk2lp"].title, "api-7d9f-xk2lp");
    assert.equal(by["web/api-7d9f-xk2lp"].subtitle, "web · Running 2/2 · kind-demo");
    assert.equal(by["db/postgres-0"].subtitle, "db · Running 0/1 · kind-demo");
    assert.equal(by["web/api-7d9f-b1c3d"].subtitle, "web · CrashLoopBackOff 1/2 · kind-demo");
    assert.equal(by["batch/job-1-abcde"].subtitle, "batch · Succeeded 0/2 · kind-demo");
    assert.equal(by["batch/job-2-fghij"].subtitle, "batch · ImagePullBackOff 0/2 · kind-demo");
    assert.equal(by["web/old-1"].subtitle, "web · Terminating 2/2 · kind-demo");
    assert.equal(by["web/evicted-1"].subtitle, "web · Evicted 0/2 · kind-demo");
  });

  test("all namespaces by default, a request timeout under 10 seconds", async () => {
    const host = hostWith(fakeKubectl());
    await host.list("pods");
    assert.deepEqual(getArgs(host), [["get", "pods", "--output", "json", "--request-timeout=6s", "--all-namespaces"]]);
  });

  test("the namespace preference narrows the listing", async () => {
    const host = hostWith(fakeKubectl(), { namespace: " web " });
    await host.list("pods");
    assert.deepEqual(getArgs(host)[0].slice(-2), ["--namespace", "web"]);
  });

  test("a bad namespace preference is a calm locked row and runs nothing", async () => {
    const host = hostWith(fakeKubectl(), { namespace: "--all; rm" });
    assert.deepEqual(await host.list("pods"), { locked: true, message: "The namespace in Settings isn’t valid" });
    assert.deepEqual(getArgs(host), []);
  });

  test("the context is read once per listing", async () => {
    const host = hostWith(fakeKubectl());
    await host.list("pods");
    assert.equal(host.calls.filter((c) => c.args[1]?.[0] === "config").length, 1);
  });

  test("an empty cluster has no rows", async () => {
    assert.deepEqual(await hostWith(fakeKubectl({ pods: { items: [] } })).list("pods"), { rows: [] });
    assert.deepEqual(await hostWith(fakeKubectl({ pods: { kind: "List" } })).list("pods").catch((e) => e.message), "kubectl could not list the pods.");
  });

  test("capped at 300 rows, many namespaces, ids unique and stable", async () => {
    const items = [];
    for (let n = 0; n < 40; n++) for (let p = 0; p < 10; p++) items.push(pod(`ns-${String(39 - n).padStart(2, "0")}`, `pod-${p}`));
    items.push(pod("ns-00", "pod-0")); // a duplicate
    const kubectl = fakeKubectl({ pods: { items } });
    const first = (await hostWith(kubectl).list("pods")).rows;
    const second = (await hostWith(kubectl).list("pods")).rows;
    assert.equal(first.length, 300);
    assert.deepEqual(first, second);
    assert.equal(new Set(first.map((r) => r.id)).size, 300);
    assert.equal(first[0].id, "ns-00/pod-0");
    assert.ok(first.every((r) => r.id.length <= 256));
  });

  test("a listing bigger than 64 KB arrives whole through the lines", async () => {
    const items = Array.from({ length: 250 }, (_, i) => pod("big", `pod-${String(i).padStart(3, "0")}`, { metadata: { name: `pod-${String(i).padStart(3, "0")}`, namespace: "big", annotations: { filler: "x".repeat(500) } } }));
    const { rows } = await hostWith(fakeKubectl({ pods: { items } })).list("pods");
    assert.equal(rows.length, 250);
  });

  test("pods with names or namespaces that are not DNS names are left out", async () => {
    const items = [pod("web", "ok-1"), pod("web", "Bad Name"), pod("we/b", "x"), pod("web", "-lead"), { metadata: {} }, null];
    const { rows } = await hostWith(fakeKubectl({ pods: { items } })).list("pods");
    assert.deepEqual(rows.map((r) => r.id), ["web/ok-1"]);
  });
});

describe("failures", () => {
  test("no current context", async () => {
    const host = hostWith(fakeKubectl({ contextExit: 1 }));
    assert.deepEqual(await host.list("pods"), { locked: true, message: "No Kubernetes context is selected" });
    assert.deepEqual(getArgs(host), []);
  });

  test("cluster unreachable", async () => {
    for (const stderr of [
      "Unable to connect to the server: dial tcp 10.0.0.1:6443: i/o timeout\n",
      "The connection to the server localhost:8080 was refused - did you specify the right host or port?\n",
      "Unable to connect to the server: context deadline exceeded (Client.Timeout exceeded while awaiting headers)\n",
    ]) {
      const listing = await hostWith(fakeKubectl({ getExit: 1, getStderr: stderr })).list("pods");
      assert.deepEqual(listing, { locked: true, message: "The cluster can’t be reached" });
    }
  });

  test("unauthorized and forbidden", async () => {
    for (const stderr of [
      "error: You must be logged in to the server (Unauthorized)\n",
      'Error from server (Forbidden): pods is forbidden: User "demo" cannot list resource "pods" in API group "" at the cluster scope\n',
    ]) {
      const listing = await hostWith(fakeKubectl({ getExit: 1, getStderr: stderr })).list("pods");
      assert.deepEqual(listing, { locked: true, message: "kubectl isn’t signed in to the cluster" });
    }
  });

  test("an unknown failure and bad JSON throw a message without kubectl's output", async () => {
    const secretish = "token-" + "z".repeat(20) + " https://api.internal.example";
    await assert.rejects(hostWith(fakeKubectl({ getExit: 1, getStderr: secretish })).list("pods"), (e) => e.message === "kubectl could not list the pods." && !e.message.includes("zzz"));
    await assert.rejects(hostWith(fakeKubectl({ raw: "{ not json" })).list("pods"), { message: "kubectl could not list the pods." });
  });

  test("kubectl missing", async () => {
    const host = createFakeHost({ folder, sources, exec: {} });
    await assert.rejects(host.list("pods"), { code: "toolMissing" });
  });

  test("reasonOf is linear on adversarial input", () => {
    const long = "unable ".repeat(10_000) + "x".repeat(50_000);
    const start = Date.now();
    assert.equal(reasonOf(long), "other");
    assert.ok(Date.now() - start < 200);
  });

  test("rowsOf on a huge payload stays quick", () => {
    const start = Date.now();
    assert.equal(rowsOf("{" + "[".repeat(50_000), "c"), undefined);
    assert.ok(Date.now() - start < 500);
  });
});

describe("run", () => {
  test("↵ pastes the pod name", async () => {
    assert.deepEqual(await hostWith(fakeKubectl()).runSource("pods", "web/api-7d9f-xk2lp", "name"), { text: "api-7d9f-xk2lp" });
  });

  test("⇧↵ pastes the logs command by default", async () => {
    assert.deepEqual(await hostWith(fakeKubectl()).runSource("pods", "web/api-7d9f-xk2lp", "command"), { text: "kubectl -n web logs -f api-7d9f-xk2lp" });
  });

  test("the preference switches ⇧↵ to exec", async () => {
    const host = hostWith(fakeKubectl(), { shiftAction: "exec" });
    assert.deepEqual(await host.runSource("pods", "web/api-7d9f-xk2lp", "command"), { text: "kubectl -n web exec -it api-7d9f-xk2lp -- sh" });
  });

  test("a foreign row id never becomes a command", async () => {
    for (const id of ["web/x; rm -rf ~", "nope", "web/$(id)", "-n/x", "a/b/c", "web/"]) {
      await assert.rejects(hostWith(fakeKubectl()).runSource("pods", id, "command"), { message: "This pod can’t be used." });
    }
  });

  test("runs no tool", async () => {
    const host = hostWith(fakeKubectl());
    await host.runSource("pods", "web/a", "name");
    assert.equal(host.calls.filter((c) => c.api === "exec").length, 0);
  });
});

describe("secrets and language", () => {
  test("nothing from kubectl's output lands in rows beyond names, and logs stay clean", async () => {
    const token = "ey" + "J" + "x".repeat(40);
    const items = [pod("web", "api-1", { metadata: { name: "api-1", namespace: "web", annotations: { token } }, spec: { containers: [{ name: "a", env: [{ name: "KEY", value: token }] }] } })];
    const host = hostWith(fakeKubectl({ pods: { items } }));
    const listing = await host.list("pods");
    assert.ok(!JSON.stringify(listing).includes(token));
    assert.ok(!JSON.stringify(host.logs).includes(token));
  });

  test("Turkish messages", async () => {
    const listing = await hostWith(fakeKubectl({ contextExit: 1 }), {}, "tr").list("pods");
    assert.equal(listing.message, "Bir Kubernetes bağlamı seçili değil");
  });
});
