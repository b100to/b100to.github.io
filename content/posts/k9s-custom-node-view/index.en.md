---
title: "Identify Karpenter Node Roles at a Glance in k9s"
date: 2026-02-25T16:00:00+09:00
description: "How to use k9s views.yaml custom columns to instantly identify Karpenter NodePool roles (app, worker, gpu) in your EKS cluster."
keywords: ["k9s views.yaml", "k9s custom columns", "Karpenter NodePool", "k9s node view custom", "kubectl get nodes label", "k9s configuration"]
categories: ["Kubernetes"]
tags: ["k9s", "Karpenter", "Kubernetes", "EKS"]
showHero: true
heroStyle: "background"
---

> **TL;DR** — Add a label like `node-role: app` to your Karpenter NodePool, then add `TYPE:.metadata.labels.node-role` as a custom column in k9s `views.yaml`. Node purpose becomes instantly visible.

---

Running `kubectl get nodes` on EKS gives you something like this:

```
NAME                                                STATUS   AGE
ip-10-0-xx-xxx.ap-northeast-2.compute.internal      Ready    9d
ip-10-0-xx-xxx.ap-northeast-2.compute.internal      Ready    2d
ip-10-0-xx-xxx.ap-northeast-2.compute.internal      Ready    3d
fargate-ip-10-0-xx-xx.ap-northeast-2.compute.internal  Ready  1d
```

Which node is `app`? Which one is `worker`? There's no way to tell. The node name is just the EC2 Private DNS — completely meaningless.

---

## You Can't Change EKS Node Names

Let's get this out of the way: **EKS node names cannot be changed.** The kubelet automatically picks up the Private DNS from EC2 instance metadata and uses it as the node name. This applies to both Karpenter and Managed Node Groups.

The alternative? **Labels.**

---

## Using Karpenter NodePool Labels

When you set `spec.template.metadata.labels` on a Karpenter NodePool, **all nodes provisioned by that pool automatically inherit those labels.**

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: app
spec:
  template:
    metadata:
      labels:
        node-role: app  # This label propagates to nodes
    spec:
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: app
      # ...
```

Set `node-role: app`, `node-role: worker`, `node-role: gpu` on each NodePool accordingly.

With kubectl, use the `-L` flag to display labels as columns:

```bash
kubectl get nodes -L node-role
```

```
NAME                                           STATUS   node-role
ip-10-0-xx-xxx.ap-northeast-2...               Ready    app
ip-10-0-xx-xxx.ap-northeast-2...               Ready    worker
fargate-ip-10-0-xx-xx.ap-northeast-2...        Ready
```

Fargate nodes don't have this label since they're not managed by Karpenter — which naturally distinguishes them.

---

## Custom Columns in k9s

That works for kubectl, but what about k9s? Since v0.40.0, k9s supports **extracting labels into custom columns** via `views.yaml`.

### views.yaml Configuration

```yaml
# macOS: ~/Library/Application Support/k9s/views.yaml
# Linux: ~/.config/k9s/views.yaml
views:
  v1/nodes:
    columns:
      - TYPE:.metadata.labels.node-role
      - STATUS
      - PODS
      - CPU
      - MEM
      - '%CPU'
      - '%MEM'
      - AGE
      - NAME|W
      - VERSION|W
```

The key syntax is:

```
COLUMN_NAME:.metadata.labels.label-key
```

This extracts the value from `.metadata.labels.node-role` and displays it as a column named `TYPE`.

### Column Order Rationale

Here's the order that worked well for me:

| Order | Column | Reason |
|-------|--------|--------|
| 1 | TYPE | Node purpose should be the first thing you see |
| 2 | STATUS | Quickly verify node health |
| 3 | PODS | Pod count per node |
| 4-7 | CPU/MEM/%CPU/%MEM | Resource metrics — most frequently checked |
| 8 | AGE | Node lifetime (spot newly launched or aging nodes) |
| 9 | NAME\|W | Wide mode only (rarely needed day-to-day) |
| 10 | VERSION\|W | Wide mode only |

**Why remove ROLE** — In EKS with Karpenter/Fargate, it's always `<none>`. Useless.

**Why move NAME and VERSION to wide mode** — NAME is just a long IP-based string that eats up screen space. With the TYPE label, you don't need NAME to identify nodes. VERSION is rarely checked. Both are accessible via `ctrl+e` (wide toggle) when needed.

### Column Attributes Reference

You can append attributes after `|` in k9s views.yaml:

| Attr | Meaning |
|------|---------|
| `W` | Show only in wide mode |
| `H` | Hidden |
| `R` | Right-aligned |
| `S` | Always show (force-show a default wide column) |

---

## Result

Navigate to `:node` in k9s and you'll see:

```
TYPE      STATUS  PODS  CPU   MEM    %CPU  %MEM   AGE
app       Ready   12    850m  4.2Gi  10%   26%    9d
app       Ready   8     620m  3.1Gi  7%    19%    2d
worker    Ready   3     200m  512Mi  2%    3%     1h
<none>    Ready   2     50m   128Mi  0%    0%     5d    # Fargate
```

Node purpose is immediately visible. Effectively the same as renaming your nodes.

### Limitation: Drill-down View Header Can't Be Changed

When you select a node and drill into it, the header shows `pods(ip-10-0-xx-xxx.ap-northeast-2.compute.internal)`. This uses the Kubernetes resource name directly and is hardcoded in k9s — `views.yaml` only controls list view columns, not drill-down view headers.
