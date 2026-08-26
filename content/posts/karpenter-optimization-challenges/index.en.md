---
title: "Karpenter in Production: Balancing Cost and Stability"
date: 2026-01-27T10:00:00+09:00
description: "Real-world challenges of running Karpenter in production -- node sizing decisions, Consolidation tuning, and handling JVM workload spikes, shared from hands-on experience."
keywords: ["Karpenter optimization", "Karpenter Consolidation", "Karpenter node sizing", "EKS cost optimization", "Karpenter budgets", "JVM Kubernetes resources", "Karpenter WhenEmptyOrUnderutilized"]
categories: ["Kubernetes"]
tags: ["Karpenter", "AWS", "EKS", "Kubernetes", "Cost Optimization"]
showHero: true
heroStyle: "background"
---

> TL;DR -- Karpenter is powerful, but production use surfaces real problems: monitoring-agent costs push you toward larger instances, aggressive Consolidation causes node churn, and JVM startup spikes create a nasty feedback loop. This post covers the trade-offs I hit and the settings that worked.

Karpenter is a powerful node autoscaler, but running it in production inevitably surfaces problems you didn't expect. This post covers optimization challenges I encountered beyond Spot availability issues.

> Spot instance availability problems are covered in [a separate post](/posts/karpenter-spot-availability-issue/).

---

## 1. Node Count vs. Instance Size: The Cost Optimization Dilemma

### The Problem

Monitoring tools like Datadog and New Relic charge **per node (host)** because their agents are deployed as DaemonSets.

```
xlarge x 4 nodes = 4 agent licenses
2xlarge x 2 nodes = 2 agent licenses (same total resources)
```

For the same total resources, **fewer large instances means lower agent costs**.

### Solution: Prefer Larger Instances

```yaml
requirements:
  - key: node.kubernetes.io/instance-type
    operator: In
    values:
      # Prefer 2xlarge (8 vCPU) - minimize node count
      - "r7i.2xlarge"   # 8 vCPU, 64 GiB
      - "r6i.2xlarge"
      - "m7i.2xlarge"
      - "m6i.2xlarge"
```

### Trade-offs

| Smaller Instances (xlarge) | Larger Instances (2xlarge) |
|----------------------------|---------------------------|
| Higher Spot availability | Lower Spot availability |
| Finer-grained scaling | Lower per-node agent costs |
| Smaller blast radius | Larger blast radius on failure |

**Bottom line**: If agent costs are significant, go with 2xlarge or bigger. Otherwise, xlarge gives you more granularity.

---

## 2. Consolidation Causing Service Instability

### The Problem

After enabling the `WhenEmptyOrUnderutilized` policy, nodes kept getting created and destroyed in a loop.

```
10:00 - Node A created
10:05 - Node A removal starts (deemed underutilized)
10:06 - Node B created (Pods rescheduled)
10:11 - Node B removal starts
... repeat (Churn)
```

The result:
- Constant Pod restarts
- Service instability
- PodDisruptionBudget violations

### Solution: Tune the Consolidation Settings

```yaml
disruption:
  consolidationPolicy: WhenEmptyOrUnderutilized

  # Allow enough stabilization time
  consolidateAfter: 10m  # was 5m, now 10m

  # Limit concurrent node removals
  budgets:
    - nodes: "1"  # only 1 at a time
```

### Consolidation Policy Comparison

| Policy | Behavior | Good For |
|--------|----------|----------|
| `WhenEmpty` | Only removes empty nodes | Stability first |
| `WhenEmptyOrUnderutilized` | Also removes underutilized nodes | Cost optimization |

### Why budgets Matter

```yaml
budgets:
  - nodes: "1"      # absolute
  # or
  - nodes: "10%"    # percentage
```

**Removing one at a time** prevents mass eviction from disrupting your services.

---

## 3. Conflicts with TopologySpreadConstraints

### The Problem

Pods have zone-spread constraints, but if nodes only exist in a single zone, scheduling fails.

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
```

```bash
$ kubectl get pods
my-pod-1    Running   # zone-c
my-pod-2    Pending   # no nodes in zone-a/b!
```

### Solutions

**Option 1: On-Demand Fallback**
```yaml
- key: karpenter.sh/capacity-type
  operator: In
  values: ["spot", "on-demand"]  # spot preferred, on-demand as fallback
```

**Option 2: Relax whenUnsatisfiable**
```yaml
whenUnsatisfiable: ScheduleAnyway  # instead of DoNotSchedule
```

**Option 3: Diversify Instance Types**

More instance types means higher probability of getting Spot capacity, which in turn improves zone-spread coverage.

---

## 4. JVM Workload Resource Spikes

### The Problem

JVM applications (Spring Boot, etc.) **consume high CPU at startup**:

```
Steady state: 200m CPU
Startup:      2000m CPU (10x!)
```

This creates a vicious cycle:
1. Multiple Pods restart simultaneously
2. Karpenter sees resource pressure and launches new nodes
3. Once Pods stabilize, the new nodes become underutilized
4. Consolidation removes those nodes
5. Back to step 1...

### Solutions

**Option 1: Account for the spike in requests**
```yaml
resources:
  requests:
    cpu: 500m      # partially account for startup spike
    memory: 1Gi
  limits:
    cpu: 2000m     # what startup actually needs
    memory: 2Gi
```

**Option 2: Set a generous consolidateAfter**
```yaml
disruption:
  consolidateAfter: 10m  # give JVM warmup time
```

**Option 3: Use VPA**
```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
spec:
  updatePolicy:
    updateMode: "Initial"  # apply only at startup
```

---

## 5. Preventing Simultaneous Node Expiry with NodePool Splitting (Staggered Expiry)

### The Problem

With a single NodePool and `expireAfter` configured, nodes created around the same time expire **all at once**.

```
09:00 - Nodes A, B, C created simultaneously
18:00 - Nodes A, B, C expire simultaneously → cascading replacement → outage!
```

Even with `budgets: "1"` limiting replacements to one at a time, back-to-back node rollovers keep rescheduling Pods, and the constant disruption adds up. This caused a real production outage before we fixed it.

### Solution: Split into base-a and base-b NodePools

Divide capacity across two NodePools with offset expiry windows so they roll over at different times.

```yaml
# base-a
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: base-a
spec:
  template:
    spec:
      expireAfter: 720h  # 30 days
  disruption:
    budgets:
      - nodes: "1"
---
# base-b: offset by 24 hours from base-a
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: base-b
spec:
  template:
    spec:
      expireAfter: 744h  # 31 days
  disruption:
    budgets:
      - nodes: "1"
```

- While base-a nodes are rolling, base-b nodes stay stable
- Staggered renewals ensure roughly half your capacity is always healthy

---

## 6. Preventing Pod Pile-Up with minDomains

### The Problem

After a node failure and recovery, **rescheduled Pods tend to pile up on a single node**.

```
Node B fails → Pods evacuate to Node A
New Node C is provisioned → but Pods stay piled on A
→ Node A failure now takes down everything
```

`TopologySpreadConstraints` alone doesn't prevent this. With only one available node, `maxSkew: 1` is trivially satisfied — the scheduler sees no reason to spread.

### Solution: Set minDomains

`minDomains` tells the scheduler how many topology domains **must exist** for the spread constraint to be enforced. If fewer domains are available, scheduling is held until Karpenter provisions enough nodes.

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: DoNotSchedule
    minDomains: 2  # require pods to spread across at least 2 nodes
    labelSelector:
      matchLabels:
        app: my-app
```

- If fewer than 2 nodes are available, Pod scheduling is held → Karpenter provisions another node
- Pods are only placed once 2 nodes exist → single-node pile-up is blocked at the source

> **Note**: Skip this for **environments running on a single node** (e.g., dev). With `minDomains: 2` and only one node available, Pods will wait indefinitely.

---

## 7. Recommended Production Configuration

A configuration that addresses all the issues above:

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  template:
    spec:
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
      requirements:
        # Instance types (2xlarge if agent costs matter)
        - key: node.kubernetes.io/instance-type
          operator: In
          values:
            - "r7i.2xlarge"
            - "r6i.2xlarge"
            - "m7i.2xlarge"
            - "m6i.2xlarge"

        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]

        # Spot preferred, On-Demand fallback
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]

  limits:
    cpu: 24  # max 3 x 2xlarge

  # Stable Consolidation
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 10m
    budgets:
      - nodes: "1"
```

---

## Conclusion

Key takeaways for running Karpenter in production:

| Area | Recommendation |
|------|----------------|
| Agent costs | Use larger instances to minimize node count |
| Consolidation | `consolidateAfter: 10m` + `budgets: 1` |
| Zone spread | Add On-Demand fallback |
| JVM workloads | Reflect startup spikes in requests |
| Simultaneous expiry | Split into base-a/base-b NodePools with offset expiry |
| Pod pile-up | `minDomains: 2` (prod only, skip for single-node dev) |

There is no perfect configuration on day one. The real key is **continuous tuning informed by monitoring**.

---

## References

- [Karpenter Official Docs](https://karpenter.sh/)
- [Karpenter Best Practices - AWS](https://aws.github.io/aws-eks-best-practices/karpenter/)
- [Solving Spot Instance Availability Issues](/posts/karpenter-spot-availability-issue/)
