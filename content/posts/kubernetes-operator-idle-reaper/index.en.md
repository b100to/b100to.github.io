---
title: "Moving Nightly Scale-Down from Lambda to a Kubernetes Operator"
date: 2026-08-26T10:00:00+09:00
description: "Reclaiming idle dev-environment capacity with an operator instead of CronJob and Lambda -- level-triggered design, why RBAC only surfaces in-cluster, a PDB false positive, and a label kubelet refuses to set."
keywords: ["Kubernetes operator", "kubebuilder", "CRD", "controller-runtime", "EKS cost optimization", "Karpenter", "nightly scale-down", "FinOps", "level-triggered"]
categories: ["Kubernetes"]
tags: ["Kubernetes", "Operator", "kubebuilder", "Go", "Cost Optimization", "Karpenter"]
showHero: true
heroStyle: "background"
---

> TL;DR -- Scaling pods to zero saves nothing while the node keeps running. I moved dev-environment nightly scale-down from Lambda to an operator, and made it report *why* a node could not be reclaimed. The interesting parts were not the controller logic but everything my local setup was hiding.

Scaling pods to zero does not reduce the bill. The node has to go away, and a node only goes away when nothing is left on it that would have to be evicted first.

This post is about that, but it started somewhere simpler.

**I wanted to build an operator.** I am comfortable running controllers and had never written one, and I wanted to touch the platform-engineering side directly rather than only consume it.

There happened to be something worth fixing.

---

## 1. Not because Lambda is bad, but because we do not use it

Dev-environment nightly and weekend scale-down had been running on EventBridge plus Lambda for a while, and running fine. The problem was not that it failed.

**We do not otherwise use Lambda.** Nearly everything sits on Kubernetes and Terraform, and this one feature added a second place to maintain.

That makes ordinary questions awkward:

- where do I go to change the schedule
- how does that change get deployed
- if someone inherits this, where do they start

What bothered me was not the code but **who maintains it and how**. Everything inside the Kubernetes ecosystem is deployed, inspected and permissioned the same way. This one thing sat outside all of it.

There were technical limits too.

**It cannot see inside the cluster.** Lambda sets replicas to zero at a fixed time. It does not know whether somebody scaled a workload up during an incident, or whether an HPA already owns those replicas.

**The configuration is invisible to developers.** The schedule lives in Lambda code or environment variables, so a developer cannot check when their namespace goes down.

**And it fires once.** If it fails at 20:00, that night simply does not happen.

An operator looked like it could collapse all of that into one place -- and building one would show me what the model actually buys, rather than what it is said to buy.

## 2. What changes inside a controller

All three problems come from the same shape: acting on the cluster from outside, on an event. Moving to something that **continuously reconciles state from inside** dissolves them.

```yaml
apiVersion: finops.b100to.dev/v1alpha1
kind: IdleWindow
metadata:
  name: dev-nights
  namespace: team-a
spec:
  sleepAt: "0 20 * * 1-5"
  wakeAt: "0 9 * * 1-5"
```

Three lines. Defaults fill in the rest.

### Level-triggered

`Reconcile` does not distinguish why it was called. Event, timer, retry -- it does not need to know. Every pass reads **the current clock and the current cluster state fresh** and closes the gap.

That is what makes a missed event, a restarted controller and a duplicated call all produce the same outcome.

One problem was more interesting than expected. A cron expression only answers **"when does this next fire"**. What I needed was **"are we between two firings"**, and there is no function for that.

Instead of searching backwards for the previous occurrence, compare the two upcoming boundaries.

```go
nextSleep := sleepSched.Next(now)
nextWake  := wakeSched.Next(now)

asleep := nextWake.Before(nextSleep)
```

If the next **wake** arrives first, a wake is pending, so we are currently asleep. If the next **sleep** arrives first, we are awake.

| Now | Next sleep | Next wake | Verdict |
|---|---|---|---|
| 08:59 | today 20:00 | **today 09:00** | asleep |
| 09:00 | **today 20:00** | tomorrow 09:00 | awake |
| 19:59 | **today 20:00** | tomorrow 09:00 | awake |
| 20:00 | tomorrow 20:00 | **tomorrow 09:00** | asleep |

Crossing a boundary pushes that side's "next" a day out, and the order flips.

**No state is carried between reconciles.** The clock alone decides. A controller that missed the 09:00 wake and started at 10:00 recovers on its first pass.

---

## 3. Where to keep the original replica count

Waking up needs a value to restore. The obvious home is `IdleWindow.status` -- and that is exactly where it must not live.

**Delete the IdleWindow, or lose the operator, and the workload is stranded at zero** with no record of where it came from.

So it goes onto the target Deployment as annotations.

```
finops.b100to.dev/saved-replicas: "3"     # what it was
finops.b100to.dev/applied-replicas: "0"   # what the controller last wrote
```

If the operator never comes back, a person can read the value and restore it by hand.

`applied` exists to **tell human intervention apart**. A replica count that differs from what the controller wrote was changed by someone else, and the window stands down until the next boundary.

Automation switching off a pod someone started at 3am to handle an incident is not a correction. It is an outage.

---

## 4. Reporting reclaimed requests is not reporting savings

This is the part I spent the most thought on.

Scaling pods to zero does not reduce cost. The node has to go, and Karpenter or Cluster Autoscaler is what removes it. But **nothing tells you why it did not**.

```
$ kubectl get idlewindow -n team-a
NAME         PHASE    SCALED   SKIPPED   CPU    DRAINABLE   NODES
dev-nights   Asleep   4        1         900m   0           2

Unblocked=False
  not fully reclaimable: autoscaled (HPA), cache (PDB)
```

Four workloads went to zero, and `DRAINABLE` is still zero. Looking at the nodes shows why.

```
lab-worker    [infra]  idle-reaper  wake-bot  kindnet  kube-proxy
lab-worker2   [app]    autoscaled   kindnet   kube-proxy
lab-worker3   [app]    autoscaled   kindnet   kube-proxy
```

The one workload skipped for having an HPA runs two replicas, **one on each app node**. Emptying everything else still leaves nothing removable.

A bare number cannot distinguish **"nothing is wrong"** from **"something is broken"**.

Node accounting follows the same rule autoscalers use: **DaemonSet pods are excluded**. They are not moved elsewhere; they disappear with the node. That is what Karpenter's consolidation and CA's scale-down both do.

---

## 5. For people who have to work at 3am

Lifting the window has to be possible. But letting people edit the `IdleWindow` means users editing the policy, and forgetting to revert leaves that namespace awake forever.

It became a separate object.

```yaml
kind: WakeRequest
spec:
  duration: 3h
  reason: "verifying a payment hotfix"
```

- **The expiry is derived from the object's creation time, not the spec.** A request that could set its own end time could also extend itself, and self-cancelling is the whole point.
- **The cap lives on the policy.** Anything longer than `IdleWindow.maxWakeDuration` (default `8h`) is refused.

RBAC then expresses ownership exactly: developers get `create` on `wakerequests` and nothing on `idlewindows`. They cannot even read the policy.

### From Slack

```
/wake 5m testing
```

![The bot replying in Slack with the expiry time, request name and reason](slack-wake.png)

The expiry in that reply is not the bot's arithmetic. It creates the object, **waits for the controller's verdict**, and repeats what the cluster said.

An earlier version reported success on create. Asked for `24h`, the bot answered "awake for 24 hours" -- while the cluster had refused it for exceeding the 8h cap and the namespace stayed asleep. **The policy held; the human was told the opposite.**

Creating an object and having it accepted are different events. The API server checks the shape; whether the duration is allowed is the controller's call, made a moment later.

The bot decides nothing. The worst a compromised bot can do is ask a namespace to stay awake, for no longer than the policy allows.

```bash
$ kubectl auth can-i update idlewindows -n lab-dev \
    --as=system:serviceaccount:idle-reaper-system:wake-bot
no
```

---

## 6. What actually took the time

### "Deployments are created but no pods appear"

On a local kind cluster, not even a ReplicaSet showed up. `kube-controller-manager` turned out to be on its 17th restart.

```
E controllermanager.go:368] "leaderelection lost"
```

The ReplicaSet controller lives inside it, so nothing was being created. The cause was another layer down.

```
"apply request took too long","took":"285ms","expected-duration":"100ms"
```

etcd fsync latency on the macOS container filesystem. 96 of the last 300 log lines were that warning, and lease renewals were timing out. CPU and memory were idle.

**The symptom and the cause were two layers apart.** Getting from "no pods" to "the disk under etcd is slow" took a while.

Two lines of kind config fixed it: move etcd's `dataDir` to `/tmp/etcd` (tmpfs on kind nodes), and turn off leader election since there is only one control plane. Latency warnings went from 96 to 1, and all nodes reached Ready in one minute instead of seven.

### RBAC only surfaces in the cluster

A controller that ran fine locally with `make run` failed in-cluster:

```
cannot list resource "wakerequests" ... at the cluster scope
```

The RBAC markers were right and `config/rbac/role.yaml` was current. The chart was not: `make manifests` does not regenerate it.

The deeper point: **running locally uses an admin kubeconfig, so insufficient permissions are invisible.** Only the controller's own ServiceAccount reveals them.

### An alarm that fires the moment you succeed

To decide whether a PDB blocks node removal, I checked `status.disruptionsAllowed == 0`. That made the alarm fire the moment a workload reached zero -- that is, **the moment reclaiming succeeded**.

A budget guarding no pods blocks nothing. `currentHealthy > 0` has to be part of the condition.

### A label kubelet refuses to set

Marking node roles in the kind config looked harmless:

```yaml
labels:
  node-role.kubernetes.io/infra: ""
```

The cluster refused to come up, and the error pointed somewhere else entirely.

```
could not find a JWS signature in the cluster-info ConfigMap
```

Labels in kind's config are applied by kubelet at registration, and **the NodeRestriction admission plugin rejects that prefix**. Registration failed, and the failure surfaced during join as something unrelated.

A custom domain (`platform-lab.dev/role`) solved it. Taints go through `JoinConfiguration.nodeRegistration.taints` without complaint.

### The operator cannot live on the capacity it reclaims

Scaling app nodes to zero takes the controller with them, and then nothing is left to wake anything up.

Karpenter keeps itself on a separate node group or Fargate for the same reason. Here one worker is tainted as infra.

```yaml
# clusters/kind/kind-config.yaml
- role: worker
  labels:
    platform-lab.dev/role: infra
  kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        taints:
          - key: dedicated
            value: infra
            effect: NoSchedule
```

### Publishing a chart without its image is publishing half of it

After registering on Artifact Hub, the vulnerability scan failed.

```
error scanning image controller:0.1.0: image not found
```

kubebuilder's placeholder `controller` had been published as the values.yaml default. The failed scan was the symptom; the real problem was that **anyone installing the chart would hit `ImagePullBackOff`**.

My lab overrode the image with a local build, which hid the defect completely.

**An external scanner was the first thing to try installing it the way a stranger would.**

---

## 7. Publishing

Packaged as a Helm chart and pushed to an OCI registry.

```sh
helm install idle-reaper oci://ghcr.io/b100to/charts/idle-reaper \
  --namespace idle-reaper-system --create-namespace
```

Unlike the GitHub Pages approach, there is no `index.yaml` and no gh-pages branch to maintain -- the chart uses the same registry and the same auth path as the image.

![The published idle-reaper chart page on Artifact Hub](artifacthub.png)

---

## Closing

This has not gone to production. The design is validated locally: on a four-node kind cluster I verified scale-down, restore, recovery after a controller restart, respect for manual scaling, and request expiry -- plus that the chart installs from a machine with no credentials.

The same thing happened three times during this work: **a defect my own environment was hiding** showed up somewhere else.

- Local `go run` uses admin rights, hiding missing RBAC
- Local values overrides hid a broken default image in the chart
- The bot answered incorrectly until somebody actually typed the command in Slack

Building it taught me less than trying to use it as a stranger would.

---

**Code**: [github.com/b100to/platform-lab](https://github.com/b100to/platform-lab/tree/main/operators/idle-reaper) -- `DESIGN.md` records the decisions, including the ones that were wrong first time round.

**Chart**: [artifacthub.io/packages/helm/idle-reaper/idle-reaper](https://artifacthub.io/packages/helm/idle-reaper/idle-reaper)
