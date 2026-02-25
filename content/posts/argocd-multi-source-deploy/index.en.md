---
title: "Deploying Nginx Helm Charts with ArgoCD Multi-Source"
date: 2025-02-26T19:27:00+09:00
description: "How to use ArgoCD's multi-source feature to separate Helm charts and values files. A practical guide to combining Bitnami charts with values from your own Git repo."
keywords: ["ArgoCD multi-source", "ArgoCD multiple sources", "Helm values separation", "ArgoCD Helm deployment", "GitOps Helm", "ArgoCD Application config", "values file separate management"]
categories: ["ArgoCD"]
tags: ["ArgoCD", "Helm", "GitOps", "Kubernetes", "MultiSourceDeploy"]
showHero: true
heroStyle: "background"
---

> TL;DR -- ArgoCD's multi-source feature lets you pull Helm charts from a public registry (like Bitnami) while managing values files in your own Git repo. This keeps chart and config concerns neatly separated, and makes PR reviews and rollbacks much simpler.

I want to share a problem I ran into while deploying Helm charts with ArgoCD, and how I solved it. Specifically, this is about managing values files in a separate repo -- something I didn't even know was possible until I dug into the ArgoCD docs.

## How It Started

Our team manages several microservices with ArgoCD. We wanted to pull Helm charts from Artifact Hub but keep our values in our own Git repo. I wasn't sure if this was even possible at first, but after diving into the ArgoCD documentation, I found the multi-source feature. Tested it out, and it worked great -- so here's how to do it.

## Why This Approach Is Great

1. **Separation of concerns**: Charts and config values live in different repos. Charts come from an official repo like Bitnami, while values are managed in Git just like code. Clean and tidy.
2. **Easy version management**: PR reviews are straightforward, and rollbacks are simple. When you only need to change values, you can leave the chart version as-is and just modify the config.
3. **Reusability**: You can deploy the same Nginx chart to dev, staging, and prod with different values -- no code duplication.

## Implementation

Here's the actual ArgoCD Application manifest I used. The key part is the `spec.sources` field where multiple sources are defined.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nginx
  namespace: argocd
spec:
  project: default
  sources:
    # First source: Bitnami Helm chart
    - repoURL: https://charts.bitnami.com/bitnami
      chart: nginx
      targetRevision: 15.0.2
      helm:
        releaseName: nginx
        valueFiles:
          - $values/helm/nginx/values.yaml
    # Second source: our Git repo with values files
    - repoURL: https://github.com/my-org/config-repo.git
      targetRevision: main
      path: .
      ref: values
  destination:
    server: https://kubernetes.default.svc
    namespace: web
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

## Code Walkthrough

Breaking down the important parts:

1. **First source** (`sources[0]`):
   - `repoURL`: Bitnami Helm chart repository URL
   - `chart`: The Helm chart name (nginx in this case)
   - `targetRevision`: Chart version (15.0.2)
   - `valueFiles`: This is where `$values` comes in -- it references the second source by its alias

2. **Second source** (`sources[1]`):
   - Points to our own Git repo
   - `ref: values` gives it a name, so the first source can reference it as `$values`

I also set up auto-sync (`automated`) and automatic namespace creation (`CreateNamespace=true`) for convenience.

## How It Works Internally

ArgoCD processes this in the following order:

1. Fetches each source separately: the Bitnami chart and our Git repo
2. Resolves the `$values` reference to the actual path
3. Renders the Helm template to produce the final K8s manifests
4. Applies them to the cluster

It took me a while to figure this out, but this multi-source feature has been available since ArgoCD 2.4. Earlier versions required a slightly different approach.

## Real-World Experience

This pattern proved especially useful in these scenarios:

- **Multi-environment management**: Deploying the same nginx chart to dev, staging, and prod with different values for resource limits and ingress settings per environment
- **Centralized management**: Having all service values in one repo made it easy to see the entire infrastructure config at a glance
- **SSL management**: Managing HTTPS certificate configs in a separate repo while restricting access permissions
- **Team collaboration**: The infra team manages Helm charts and base configs, while dev teams only manage app-specific values -- a natural division of responsibilities

Personally, the best part was being able to update chart versions and values independently. When a PR only touches values while leaving the chart version unchanged, reviews become much easier.

## Gotchas

A few things I tripped over along the way:

1. **Duplicate ref names**: If you use the same `ref` name across multiple sources, they'll conflict. Use unique names.
2. **Path accuracy**: Values file paths must be exact. A single typo will cause sync failures.
3. **Access permissions**: Make sure the ArgoCD ServiceAccount has access to all Git repos -- set up SSH keys or tokens beforehand.
4. **Chart version pinning**: Always specify an explicit version. Wildcards like `targetRevision: "*"` can trigger unexpected upgrades.

Another thing to keep in mind is that using multiple sources can slightly increase sync times. But given the management benefits, it's a worthwhile trade-off.

## Wrapping Up

What started as "Can I manage Helm charts and values separately in ArgoCD?" turned into a clean solution using the multi-source feature. I hope this pattern helps others working in K8s and GitOps environments.

Since adopting this approach, our deployment process has become more structured and easier to manage. It's been especially useful for services with frequent config changes. If you're facing similar challenges, give it a try!

Feel free to leave a comment if you have questions or know of a better approach. Next time, I'm planning to write about setting up multi-cluster environments with ArgoCD.

## References

- [ArgoCD Official Docs: Multiple Sources](https://argo-cd.readthedocs.io/en/stable/user-guide/multiple_sources/)
- [Bitnami Nginx Helm Chart](https://github.com/bitnami/charts/tree/main/bitnami/nginx)
- [ArgoCD Official Docs: Helm Values From Git](https://argo-cd.readthedocs.io/en/stable/user-guide/helm/#values-from-git)
- [Kubernetes GitOps: ArgoCD Best Practices](https://codefresh.io/learn/argo-cd/argo-cd-best-practices/)
- [Helm Official Docs: Chart Dependencies](https://helm.sh/docs/topics/charts/#chart-dependencies)
