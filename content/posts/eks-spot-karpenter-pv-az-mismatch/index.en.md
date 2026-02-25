---
title: "EKS Spot + Karpenter: Troubleshooting PV/PVC AZ Mismatch and Pod Pending"
date: 2026-01-29T16:55:00+09:00
description: "When Spot instances become unavailable in a specific AZ, it can cause PV/PVC AZ mismatch issues that leave pods stuck in Pending. Here's how I debugged and resolved it."
keywords: ["EKS", "Karpenter", "Spot Instance", "PV", "PVC", "AZ", "Kubernetes", "troubleshooting"]
categories: ["Troubleshooting"]
tags: ["Kubernetes", "EKS", "Karpenter", "Spot", "PV", "PVC"]
showHero: true
heroStyle: "background"
---

> TL;DR -- Spot instances may only be available in certain AZs, but your EBS-backed PVs are physically tied to a specific AZ. When Karpenter provisions nodes in the wrong AZ, pods that need those PVs get stuck in Pending. Fix by aligning NodePool zones, StorageClass topologies, and migrating existing volumes.

## The Problem

Out of nowhere, several pods in my dev environment went Pending. I was using Karpenter with Spot instances, and everything had been running fine -- until one day, pods just stopped scheduling.

```bash
kubectl get pods -A | grep Pending
# 9 pods Pending...
```

## Debugging the Cause

### Checking Karpenter Events

My first instinct was to check Karpenter logs and events. All I saw was:

```
Warning  FailedScheduling  karpenter  Failed to schedule pod, all available instance types exceed limits for nodepool
```

I thought maybe the NodePool's CPU limit was hit. That limit was intentional. But wait -- why were all the nodes crammed into one AZ?

### Node Status

```bash
kubectl get nodes -L topology.kubernetes.io/zone
```

All 3 nodes were in `ap-northeast-2c`. Subnets for both 2a and 2c were registered, so why were nodes only spinning up in 2c?

### PV/PVC Check -- Found It

```bash
kubectl get pv -o custom-columns='NAME:.metadata.name,AZ:.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values[0]'
```

```
NAME                    AZ
postgres-pv             ap-northeast-2a   # Problem!
data-kafka-controller-0 ap-northeast-2a   # Problem!
...
```

The existing PVs (EBS volumes) were bound to `ap-northeast-2a`. Since EBS is physically tied to an AZ, a volume in 2a simply cannot be mounted by a node in 2c.

**Root cause:**
1. Spot instances became unavailable in `ap-northeast-2a` (likely an AWS capacity issue)
2. Karpenter could only provision nodes in 2c where Spot capacity existed
3. Existing StatefulSet PVs were bound to 2a
4. Nodes in 2c couldn't mount 2a EBS volumes -> Pending

## Lessons Learned the Hard Way

### 1. I Didn't Truly Understand PV/PVC AZ Binding

I knew in theory that EBS is AZ-scoped, but I'd never experienced it affecting pod scheduling firsthand. This was a good wake-up call.

### 2. Karpenter's Error Messages Are Too Generic

The "all available instance types exceed limits" message doesn't hint at an AZ issue at all. Running `kubectl describe pod` gave much more useful info:

```
3 node(s) didn't match Pod's node affinity/selector
```

### 3. On-Demand Works Fine, Only Spot Fails

Weirdly, switching to On-Demand spun up nodes in 2a just fine. Only Spot was restricted to 2c. AWS Spot capacity varies by AZ, and sometimes a specific AZ just doesn't have any.

### 4. topologySpreadConstraints Made It Worse

Some pods had zone spread constraints (`whenUnsatisfiable: DoNotSchedule`). With all nodes in 2c, the spread constraint couldn't be satisfied, causing even more pods to go Pending.

## The Fix

Since this was a dev environment, I decided to consolidate to a single AZ (2c).

### 1. Restrict Karpenter NodePool to a Single Zone

```yaml
# nodepool.yaml
spec:
  template:
    spec:
      requirements:
        - key: topology.kubernetes.io/zone
          operator: In
          values: ["ap-northeast-2c"]
```

### 2. Add allowedTopologies to StorageClass

```yaml
# StorageClass gp3
allowedTopologies:
  - matchLabelExpressions:
      - key: topology.ebs.csi.aws.com/zone
        values:
          - ap-northeast-2c
```

This ensures all new PVs are created in 2c.

### 3. Migrate Existing EBS Volumes

For the EBS volumes stuck in 2a, I took snapshots and created new volumes in 2c. Critical data was restored from snapshots; non-essential volumes were simply re-provisioned dynamically.

### 4. Disable topologySpreadConstraints

With a single AZ, zone spreading is meaningless, so I turned it off.

## Key Takeaways

| Item | Detail |
|------|--------|
| EBS | Physically bound to an AZ. Cannot be mounted by nodes in a different AZ |
| Spot instances | Availability varies by AZ. A given AZ might have zero Spot capacity |
| Single-AZ operation | NodePool, StorageClass, and topologySpread must all be aligned |
| Debugging tip | `kubectl describe pod` events are more informative than Karpenter logs |

## Reflections

- If you don't understand the underlying infrastructure, you can fall into traps like this
- Spot instance availability per AZ is unpredictable, so critical workloads need a fallback strategy
- I went with single-AZ because this was a dev environment, but for production, Multi-AZ with On-Demand fallback would be the way to go
