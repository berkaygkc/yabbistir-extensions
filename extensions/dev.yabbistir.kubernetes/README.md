# Kubernetes

The pods of your current Kubernetes context as a column in yabbistir's panel, through [kubectl](https://kubernetes.io/docs/reference/kubectl/). Each row is a pod: its name, and a quieter line with its namespace, status, ready containers and the context. ↵ pastes the pod name, ⇧↵ pastes `kubectl -n <namespace> logs -f <pod>`, and ⌘C copies the pod name.

## Example

Type `api` in the *Pods* column to find `api-7d9f-xk2lp` (`web · Running 2/2 · kind-demo`). ↵ pastes `api-7d9f-xk2lp`; ⇧↵ pastes `kubectl -n web logs -f api-7d9f-xk2lp`, ready for you to press Return in Terminal.

## Setup

```sh
brew install kubectl
```

The extension uses whatever context kubectl has selected (`kubectl config use-context <name>`), and your own kubeconfig. It never signs in for you: when the column says the cluster can't be reached or kubectl isn't signed in, fix that in Terminal first. If it says your account can't list pods (Forbidden), you are signed in but not allowed to; try the Namespace setting or ask the cluster's owner.

## Settings

- **Namespace**: empty lists every namespace (`--all-namespaces`); a name lists only that namespace.
- **⇧↵ pastes**: `kubectl logs -f` (default) or `kubectl exec -it … -- sh`.

## Permissions and tools

- `exec`, to run **kubectl** and nothing else, with fixed arguments: `kubectl config current-context` and `kubectl get pods --output json --chunk-size=0 --request-timeout=6s` with `--all-namespaces` or `--namespace <name>`. The namespace from Settings is checked to be a valid name first. Pasting a command only pastes text; the extension never runs `logs` or `exec` itself.
- No `network` permission: kubectl talks to the cluster, not the extension.

## Limits

- The column shows at most 300 pods, sorted by namespace then name. Narrow it with the Namespace setting, or search.
- Only the current context is read, and the pasted command does not name it. Switch context before running the command.
- Status is a short version of kubectl's STATUS column (for example `CrashLoopBackOff`, `Terminating`, `Completed`, `Init:Error`); it can differ from kubectl in rare cases.
- The context name is shown in every row's subtitle as kubectl reports it. Cloud contexts (EKS, GKE) often contain an account or project id, so mind a screen share.
- Pods are read again each time the panel opens (a request gives up after 6 seconds); nothing is kept. The listing has 10 seconds in all, shared by reading the context, the request and parsing; on a very large or slow cluster it can run out and show an error instead.
- Messages never include kubectl's output, since it can name users and servers.

Sources: kubectl reference for [`get`](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/) and [`config current-context`](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_config/kubectl_config_current-context/). Error wording (`current-context is not set`, `Unable to connect to the server`, `You must be logged in to the server (Unauthorized)`, `Forbidden`) is from kubectl's behavior as widely documented, not from running it.
