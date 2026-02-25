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

## 5. Recommended Production Configuration

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

There is no perfect configuration on day one. The real key is **continuous tuning informed by monitoring**.

---

## References

- [Karpenter Official Docs](https://karpenter.sh/)
- [Karpenter Best Practices - AWS](https://aws.github.io/aws-eks-best-practices/karpenter/)
- [Solving Spot Instance Availability Issues](/posts/karpenter-spot-availability-issue/)
