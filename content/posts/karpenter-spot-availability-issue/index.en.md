---
title: "Karpenter + Spot Instances: Fixing the 'No Node Created' Problem"
date: 2026-01-26T18:00:00+09:00
description: "When Karpenter throws 'no instance type has the required offering', it usually means Spot capacity is exhausted even though prices exist. Here's how I fixed it by diversifying instance types."
keywords: ["Karpenter Spot node not created", "no instance type has the required offering", "Karpenter InsufficientInstanceCapacity", "EKS Spot instance availability", "Karpenter NodePool configuration", "Spot capacity shortage fix"]
categories: ["Kubernetes"]
tags: ["Karpenter", "Spot", "AWS", "EKS", "Kubernetes", "Troubleshooting"]
showHero: true
heroStyle: "background"
---

> TL;DR -- Spot prices existing does not mean Spot capacity is actually available. When Karpenter can't create nodes because of "no instance type has the required offering," the fix is to add more instance types (different families and generations) to your NodePool so at least one will have available capacity.

I ran into a situation where Spot instances in certain availability zones wouldn't provision, and wanted to share how I debugged and resolved it.

## TL;DR

- Spot instances can have a **listed price but zero actual capacity**
- Spot capacity for a given instance type **varies by availability zone**
- **Fix**: Add a diverse set of instance types to your NodePool

---

## The Problem

### Symptoms

Pods stuck in Pending, and Karpenter wasn't creating any nodes.

```bash
$ kubectl get pods -A --field-selector=status.phase=Pending
NAMESPACE    NAME                        READY   STATUS    AGE
app          my-api-xxxxx                0/1     Pending   10m
app          another-api-xxxxx           0/1     Pending   10m
monitoring   prometheus-server-xxxxx     0/2     Pending   10m
```

### Karpenter Logs

```bash
$ kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter | grep ERROR
```

```json
{
  "level": "ERROR",
  "message": "could not schedule pod",
  "error": "no instance type has the required offering, requirements=... topology.kubernetes.io/zone In [ap-northeast-2a]"
}
```

**The key error**: `no instance type has the required offering`

### Environment

- EKS 1.34
- Karpenter v1
- NodePool: r7i.xlarge, r7i.2xlarge (Spot only)
- TopologySpreadConstraints: zone spread required (maxSkew: 1)

---

## Root Cause Analysis

### 1. Spot Price vs. Spot Capacity

```bash
# Check Spot prices
$ aws ec2 describe-spot-price-history \
    --instance-types r7i.xlarge r7i.2xlarge \
    --availability-zone ap-northeast-2a \
    --product-descriptions "Linux/UNIX"

{
  "SpotPriceHistory": [
    {
      "AvailabilityZone": "ap-northeast-2a",
      "InstanceType": "r7i.xlarge",
      "SpotPrice": "0.161400"  # price exists!
    }
  ]
}
```

**The trap**: A Spot price existing does **not** guarantee you can actually get an instance.

AWS Spot sells spare EC2 capacity, so:
- If a zone has no physical capacity left, instance creation fails
- **Newer instance types (r7i, m7i, etc.)** tend to have more limited capacity

### 2. Spot Capacity Varies by Zone

```
Zone A: r7i.xlarge Spot capacity -- none
Zone C: r7i.xlarge Spot capacity -- available
```

Karpenter needed to create a node in Zone A to satisfy TopologySpreadConstraints, but there was no Spot capacity in that zone.

### 3. Current Node Distribution

```bash
$ kubectl get nodes -L topology.kubernetes.io/zone
NAME              ZONE      NODEPOOL
ip-xx-xxx-xx-x   zone-c    base
ip-xx-xxx-xx-x   zone-c    base
```

**All nodes concentrated in one zone** -- nodes were needed in other zones but couldn't be created.

---

## The Fix

### Core Strategy: Diversify Instance Types

Spot capacity differs per instance type, so **specifying multiple types improves your odds**.

### Before (broken)

```yaml
# NodePool
requirements:
  - key: node.kubernetes.io/instance-type
    operator: In
    values:
      - "r7i.xlarge"    # newest gen, limited capacity
      - "r7i.2xlarge"   # newest gen, limited capacity
  - key: karpenter.sh/capacity-type
    operator: In
    values: ["spot"]
```

### After (fixed)

```yaml
# NodePool
requirements:
  - key: node.kubernetes.io/instance-type
    operator: In
    values:
      # r7i - memory optimized (latest gen)
      - "r7i.xlarge"
      - "r7i.2xlarge"
      # r6i - memory optimized (better availability)
      - "r6i.xlarge"
      - "r6i.2xlarge"
      # m7i - general purpose (latest gen)
      - "m7i.xlarge"
      - "m7i.2xlarge"
      # m6i - general purpose (best availability)
      - "m6i.xlarge"
      - "m6i.2xlarge"
  - key: karpenter.sh/capacity-type
    operator: In
    values: ["spot"]
```

### Why This Works

| Instance Family | Generation | Spot Availability | Notes |
|----------------|------------|-------------------|-------|
| r7i | 7th gen | Low | Newest, high demand |
| r6i | 6th gen | High | Stable, ample capacity |
| m7i | 7th gen | Medium | General purpose, decent availability |
| m6i | 6th gen | Very high | Most stable |

**8 instance types** means at least one is likely to have Spot capacity.

---

## Additional Considerations

### 1. On-Demand Fallback (optional)

For extreme cases where Spot is completely unavailable:

```yaml
- key: karpenter.sh/capacity-type
  operator: In
  values:
    - "spot"
    - "on-demand"  # fallback
```

**Caution**: On-Demand costs 3-4x more.

### 2. Diversify Instance Sizes

```yaml
values:
  - "r6i.large"     # 2 vCPU
  - "r6i.xlarge"    # 4 vCPU
  - "r6i.2xlarge"   # 8 vCPU
```

Smaller instances tend to have more abundant Spot capacity.

### 3. Prepare for Spot Interruptions

Spot instances can be reclaimed at any time, so:
- Set up Pod Disruption Budgets (PDBs)
- Spread Pods across multiple zones
- Implement graceful shutdown

---

## Monitoring and Debugging

### Check Karpenter Logs

```bash
# Scheduling failures
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter | grep -i "could not schedule"

# Node creation attempts
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter | grep -i "created nodeclaim"

# InsufficientCapacity errors
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter | grep -i "InsufficientInstanceCapacity"
```

### Check NodePool Status

```bash
kubectl get nodepool -o wide
kubectl describe nodepool <name>
```

### Check EC2NodeClass Status

```bash
# Verify subnet discovery
kubectl get ec2nodeclass <name> -o jsonpath='{.status.subnets}'
```

---

## Conclusion

### Key Lessons

1. **Spot price does not equal Spot capacity**: A listed price doesn't guarantee you'll get an instance.
2. **Newer instance types have limited capacity**: r6i/m6i are more reliable than r7i/m7i for Spot.
3. **Diversity equals stability**: Specifying many instance types is how you secure Spot availability.
4. **Capacity differs by zone**: Problems can appear in only certain availability zones.

### Recommended Configuration

For production environments:
- Specify **at least 6-8 instance types**
- Use **2 or more instance families** (e.g., r + m)
- Include **2 generations** (6th gen + 7th gen)

With this approach, you can prevent most Spot availability issues.

---

## References

- [Karpenter Best Practices](https://karpenter.sh/docs/concepts/nodepools/)
- [AWS Spot Instance Advisor](https://aws.amazon.com/ec2/spot/instance-advisor/)
- [EC2 Instance Types](https://aws.amazon.com/ec2/instance-types/)
