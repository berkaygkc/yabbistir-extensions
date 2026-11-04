import type { SourceListing, SourceRow, Sources } from "@yabbistir/api";

// The current cluster's pods as a column, through kubectl. Nothing is kept between listings: every listing reads the
// cluster again, and kubectl's output never reaches a message (it can name users and servers).

/** Most rows shown; the rest are left out so the column stays quick to search. */
const MAX_ROWS = 300;
/** One request to the cluster gives up after this, well inside the 10 seconds a listing has. */
const REQUEST_TIMEOUT = "6s";
/** A namespace is a DNS label. */
const NAMESPACE = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
/** A pod name is a DNS subdomain: labels joined by dots. Checked by a linear scan, not a nested pattern. */
const POD = /^[a-z0-9][-a-z0-9.]{0,251}[a-z0-9]$|^[a-z0-9]$/;

interface ContainerStatus {
  ready?: boolean;
  state?: { waiting?: { reason?: string }; terminated?: { reason?: string } };
}
interface Pod {
  metadata?: { name?: string; namespace?: string; deletionTimestamp?: string };
  spec?: { containers?: unknown[] };
  status?: { phase?: string; reason?: string; containerStatuses?: ContainerStatus[]; initContainerStatuses?: ContainerStatus[] };
}

/** What a person would read in `kubectl get pods`' STATUS column, in short. */
function statusOf(pod: Pod): string {
  if (pod.metadata?.deletionTimestamp !== undefined) return "Terminating";
  const phase = pod.status?.phase ?? "Unknown";
  if (phase === "Succeeded" || phase === "Failed") return pod.status?.reason || phase;
  for (const list of [pod.status?.initContainerStatuses, pod.status?.containerStatuses]) {
    for (const container of list ?? []) {
      const reason = container.state?.waiting?.reason;
      if (reason !== undefined && reason !== "" && reason !== "PodInitializing") return reason;
    }
  }
  return pod.status?.reason || phase;
}

/** The ready and total container counts, such as "1/2". */
function readiness(pod: Pod): string {
  const total = pod.spec?.containers?.length ?? pod.status?.containerStatuses?.length ?? 0;
  const ready = (pod.status?.containerStatuses ?? []).filter((container) => container.ready === true).length;
  return `${ready}/${total}`;
}

/** Rows from `kubectl get pods -o json`, sorted by namespace then name and cut to MAX_ROWS. */
export function rowsOf(json: string, context: string): SourceRow[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  const items = (parsed as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return undefined;
  const pods: Array<{ namespace: string; name: string; pod: Pod }> = [];
  const seen = new Set<string>();
  for (const pod of items as Pod[]) {
    const name = pod?.metadata?.name;
    const namespace = pod?.metadata?.namespace;
    if (typeof name !== "string" || typeof namespace !== "string") continue;
    if (!NAMESPACE.test(namespace) || !POD.test(name)) continue;
    const key = `${namespace}/${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pods.push({ namespace, name, pod });
  }
  pods.sort((a, b) => (a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return pods.slice(0, MAX_ROWS).map(({ namespace, name, pod }) => ({
    id: `${namespace}/${name}`,
    title: name,
    subtitle: `${namespace} · ${statusOf(pod)} ${readiness(pod)} · ${context}`,
  }));
}

/** Why kubectl failed, from what it printed on standard error; never shown itself. */
export function reasonOf(stderr: string): "noContext" | "unreachable" | "unauthorized" | "other" {
  const text = stderr.toLowerCase();
  if (text.includes("current-context is not set") || text.includes("no context") || text.includes("invalid configuration: no configuration has been provided")) return "noContext";
  if (text.includes("unauthorized") || text.includes("must be logged in") || text.includes("forbidden") || text.includes("provide credentials")) return "unauthorized";
  if (
    text.includes("unable to connect") || text.includes("connection refused") || text.includes("i/o timeout") ||
    text.includes("client.timeout") || text.includes("deadline exceeded") || text.includes("no such host") ||
    text.includes("was refused") || text.includes("tls handshake timeout") || text.includes("network is unreachable")
  ) return "unreachable";
  return "other";
}

const locked = (key: string): SourceListing => ({ locked: true, message: yab.t(key) });

/** Parses `id` into its namespace and pod, or undefined when it is not one of ours. */
function split(rowId: string): { namespace: string; pod: string } | undefined {
  const slash = rowId.indexOf("/");
  if (slash < 0) return undefined;
  const namespace = rowId.slice(0, slash);
  const pod = rowId.slice(slash + 1);
  return NAMESPACE.test(namespace) && POD.test(pod) ? { namespace, pod } : undefined;
}

export const sources: Sources = {
  pods: {
    async list(ctx) {
      const namespace = String(ctx.preferences.namespace ?? "").trim();
      if (namespace !== "" && !NAMESPACE.test(namespace)) return locked("badNamespace");

      // Once per listing; never remembered.
      const current = await yab.exec("kubectl", ["config", "current-context"], { signal: ctx.signal });
      const context = current.stdout.trim();
      if (current.exitCode !== 0 || context === "") return locked("noContext");

      const lines: string[] = [];
      const scope = namespace === "" ? ["--all-namespaces"] : ["--namespace", namespace];
      // Through onLine: an exec result keeps only the last 64 KB, less than a big cluster prints.
      const result = await yab.exec("kubectl", ["get", "pods", "--output", "json", `--request-timeout=${REQUEST_TIMEOUT}`, ...scope], {
        signal: ctx.signal,
        onLine: (line, stream) => {
          if (stream === "stdout") lines.push(line);
        },
      });
      if (result.exitCode !== 0) {
        switch (reasonOf(result.stderr)) {
          case "noContext": return locked("noContext");
          case "unreachable": return locked("unreachable");
          case "unauthorized": return locked("unauthorized");
          default: throw new Error(yab.t("listFailed"));
        }
      }
      const rows = rowsOf(lines.join("\n"), context);
      if (rows === undefined) throw new Error(yab.t("listFailed"));
      return { rows };
    },

    run(rowId, actionId, ctx) {
      // Ids are ours: anything else never reaches a command.
      const parsed = split(rowId);
      if (parsed === undefined) throw new Error(yab.t("badRow"));
      if (actionId === "name") return { text: parsed.pod };
      if (actionId === "command") {
        const verb = ctx.preferences.shiftAction === "exec" ? "exec -it" : "logs -f";
        const tail = verb === "exec -it" ? ` -- sh` : "";
        return { text: `kubectl -n ${parsed.namespace} ${verb} ${parsed.pod}${tail}` };
      }
      throw new Error(yab.t("badRow"));
    },
  },
};
