---
title: "The _defaults.yaml Pattern for Helm Values -- A Useful Trick When Working with AI Assistants"
date: 2026-01-28T12:30:00+09:00
description: "When collaborating with AI coding assistants, keeping Helm chart default values as a reference file prevents misconfigured settings. Introducing the _defaults.yaml pattern."
keywords: ["Helm", "Kubernetes", "GitOps", "AI", "DevOps", "values.yaml", "AI coding assistant"]
categories: ["DevOps"]
tags: ["Helm", "Kubernetes", "AI", "Best Practices"]
showHero: true
heroStyle: "background"
---

> TL;DR -- Store `helm show values` output as a `_defaults.yaml` reference file alongside your environment-specific values. This gives AI assistants (and your teammates) the exact chart schema to work with, preventing incorrect keys and making chart upgrades easier to diff.

## The Problem

When working on Kubernetes infrastructure with AI coding assistants, situations like this come up:

```yaml
# kafka-ui values.yaml
startupProbe:
  httpGet:
    path: /actuator/health
    port: http
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 12
```

Looks correct, right? But **it doesn't actually work**.

Turns out, this particular Helm chart doesn't support `startupProbe` directly -- it uses `probes.liveness.initialDelaySeconds` instead.

```yaml
# The correct way
probes:
  liveness:
    initialDelaySeconds: 120
  readiness:
    initialDelaySeconds: 120
```

## Why Does This Happen?

AI assistants don't know about Helm chart schemas beyond their training data cutoff.

- Every chart has a different values structure
- Options change between versions
- Without the chart available locally, even `helm show values` can't help

So the AI suggests "generic" Kubernetes configuration that looks right but gets silently ignored by the specific chart.

## The Solution: The `_defaults.yaml` Pattern

I started storing chart defaults in the values directory as a reference, and it worked out quite well.

```
06_values/infra/kafka-ui/
+-- _defaults.yaml   # helm show values output (reference only)
+-- dev.yaml
+-- prd.yaml
```

### Example `_defaults.yaml`

```yaml
# Chart: kafka-ui/kafka-ui v1.5.3
# Generated: 2026-01-28
# Command: helm show values kafka-ui/kafka-ui
# ============================================

replicaCount: 1

image:
  repository: provectuslabs/kafka-ui
  pullPolicy: IfNotPresent
  tag: ""

probes:
  useHttpsScheme: false
  liveness:
    initialDelaySeconds: 10  # default
    periodSeconds: 30
    timeoutSeconds: 10
  readiness:
    initialDelaySeconds: 10  # default
    periodSeconds: 30
    timeoutSeconds: 10

resources: {}
# ... remaining default values
```

## What Made This Work Well

### 1. AI Uses the Correct Options

When I tell the AI "refer to `_defaults.yaml` for kafka-ui settings":
- It only uses supported options
- It compares against defaults to identify changes clearly
- No more incorrect keys like `startupProbe`

### 2. Useful for Team Onboarding

When a new team member asks "what options does this chart support?", the answer is right there in the repo.

### 3. Easy Diff on Upgrades

When upgrading a chart version, update `_defaults.yaml` too:
```bash
git diff _defaults.yaml
```
You can see at a glance which options were added, changed, or removed.

## Practical Example

```yaml
# dev.yaml
# Default reference: _defaults.yaml (kafka-ui v1.5.3)

resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "200m"

# App takes ~90s to start, so increase probe delay
# (default: 10s -> changed to 120s)
probes:
  liveness:
    initialDelaySeconds: 120
  readiness:
    initialDelaySeconds: 120
```

Adding comments that explain why you diverged from defaults makes it much easier to understand the reasoning later.

## Maintenance Tips

### Auto-Update Script

```bash
#!/bin/bash
# update-defaults.sh

CHART=$1  # e.g., kafka-ui/kafka-ui
OUTPUT=$2 # e.g., 06_values/infra/kafka-ui/_defaults.yaml

echo "# Chart: $CHART" > "$OUTPUT"
echo "# Generated: $(date +%Y-%m-%d)" >> "$OUTPUT"
echo "# Command: helm show values $CHART" >> "$OUTPUT"
echo "# ============================================" >> "$OUTPUT"
echo "" >> "$OUTPUT"
helm show values "$CHART" >> "$OUTPUT"
```

### Add to Makefile

```makefile
update-defaults:
	./scripts/update-defaults.sh kafka-ui/kafka-ui 06_values/infra/kafka-ui/_defaults.yaml
	./scripts/update-defaults.sh grafana/loki 06_values/infra/monitoring/loki/_defaults.yaml
```

## Trade-Offs to Consider

This pattern isn't free of trade-offs.

### Repository Size Growth

Helm chart defaults can be hundreds to thousands of lines. Managing many charts means `_defaults.yaml` files pile up and add weight to the repo.

```
# Example: default values size for major charts
kafka-ui:              ~200 lines
loki:                  ~1,500 lines
kube-prometheus-stack: ~4,000 lines
```

You might choose to store defaults selectively for the most-used charts, or extract only the commonly referenced sections.

### Version Sync Required

Every time you upgrade a chart version, `_defaults.yaml` needs updating too. Otherwise, the AI references outdated options.

If you manage versions through ArgoCD, you can cross-reference the Application manifest:

```yaml
# argocd/applications/kafka-ui.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
spec:
  source:
    chart: kafka-ui
    repoURL: https://provectus.github.io/kafka-ui-charts
    targetRevision: 1.5.3  # reference this version
```

Documenting this rule in your project instructions (e.g., a CLAUDE.md or similar file) helps:

```markdown
## Helm Chart Rules

- Before modifying values, reference the `_defaults.yaml` file
- Check the chart version in the ArgoCD Application manifest (`targetRevision`)
- When upgrading chart versions, regenerate `_defaults.yaml` with `helm show values`
- Add comments explaining why any setting differs from the default
```

When the AI knows these rules, it checks the ArgoCD Application for the version and updates the defaults file accordingly.

## Wrapping Up

In my experience, getting the most out of AI means **providing clear context upfront**. Rather than hoping the AI figures things out on its own, it's better to prepare the information it needs within your codebase.

The `_defaults.yaml` pattern:
- Small effort (one-time save)
- Big payoff (prevents misconfiguration, eases onboarding)

This idea isn't limited to Helm charts either -- you could apply the same pattern to Terraform modules, API specs, and other configuration-heavy tools.
