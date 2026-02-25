---
title: "Multi-Cluster DNS Migration with External-DNS Ownership and Route53 Weighted Routing"
date: 2026-02-10T15:00:00+09:00
description: "How to perform zero-downtime DNS migration when transitioning Kubernetes clusters, using External-DNS's TXT ownership mechanism and Route53 weighted routing."
keywords: ["External-DNS", "Route53", "Kubernetes", "DNS", "migration", "multi-cluster", "weighted routing"]
categories: ["DevOps"]
tags: ["Kubernetes", "External-DNS", "Route53", "DNS", "AWS"]
showHero: true
heroStyle: "background"
---

> TL;DR -- When migrating DNS records between Kubernetes clusters, External-DNS's TXT ownership mechanism is the key to zero-downtime transitions. Route53 weighted routing sounds precise but operates at the DNS resolver level (not per-request), so a phased domain-by-domain cutover is often safer and more predictable.

## Background

I was tasked with transitioning an EKS cluster from v1 to v2. Dozens of service domains needed to move from v1's ALB to v2's ALB.

DNS was managed by External-DNS, which automatically created and deleted records in Route53. "Can't I just add the domains to v2?" I thought. Turns out, there was a lot more to consider.

## Route53 Weighted Routing -- Less Precise Than You'd Think

My first idea was to use Route53's weighted routing to gradually shift traffic.

```
app.example.com  Weighted  weight=30  -> v1 ALB
app.example.com  Weighted  weight=70  -> v2 ALB
```

In theory, 70% of traffic should go to v2. But when I actually tested it, **I couldn't tell the difference at all**.

### Why It Doesn't Work as Expected

Route53 weighted routing distributes at the **DNS query level, not the request level**.

```
Client -> queries DNS resolver -> Route53 responds based on weight
                                    +-- 70% chance -> v2 ALB IP
                                    +-- 30% chance -> v1 ALB IP

Resolver caches the response -> returns the same IP for the entire TTL
```

Once a client's resolver gets the v1 IP, it sends **100% of traffic to v1** until the TTL expires. The 70/30 split only emerges across the entire pool of resolvers. Individual requests are not distributed 70/30.

In a test environment with only a handful of clients, you might have just 1-2 resolvers, so traffic easily appears to go entirely one way. You'd need thousands of resolvers for the **law of large numbers** to produce a meaningful split.

```bash
# Query Route53 directly, bypassing cache, to verify distribution
for i in $(seq 1 20); do dig +short app.example.com @ns-xxx.awsdns-xx.com; done
```

### When It's Still Useful

You can't precisely control percentages, but "roughly 70% goes to v2" is achievable. For high-traffic production environments, the distribution becomes statistically meaningful.

External-DNS actually supports Route53 weighted routing via **annotations**, so you don't need to create records manually in the Route53 console -- you can manage it through GitOps.

```yaml
# v1 cluster Ingress
annotations:
  external-dns.alpha.kubernetes.io/hostname: app.example.com
  external-dns.alpha.kubernetes.io/set-identifier: "v1-cluster"
  external-dns.alpha.kubernetes.io/aws-weight: "30"

# v2 cluster Ingress
annotations:
  external-dns.alpha.kubernetes.io/hostname: app.example.com
  external-dns.alpha.kubernetes.io/set-identifier: "v2-cluster"
  external-dns.alpha.kubernetes.io/aws-weight: "70"
```

Both External-DNS instances create their own weighted record sets, and Route53 handles the distribution. However, this requires **both External-DNS instances running simultaneously**, with different `set-identifier` values to avoid conflicts. The `txtOwnerId` must also differ between clusters.

If weighted routing is what you need, this annotation approach is the standard way. In my case, I'd already shut down v1's External-DNS, so I went with a phased cutover instead.

## External-DNS's TXT Ownership Mechanism

When External-DNS manages Route53 records, it doesn't just create A records. It also creates **TXT records** to mark ownership: "I created this record."

```
app.example.com        A      -> ALB IP (actual traffic)
app.example.com        TXT    -> "heritage=external-dns,owner=default,..." (ownership marker)
```

The `owner` value comes from the `--txt-owner-id` flag. If you don't set it, the default is `"default"`.

### Same owner-id on Both Clusters

If v1 and v2 External-DNS instances share the same owner-id, **they both think each other's records belong to them**. When both are running simultaneously:

```
v1 external-dns (sync interval ~1min)
  -> app.example.com -> set to v1 ALB

v2 external-dns (sync interval ~1min)
  -> app.example.com -> set to v2 ALB

v1 syncs again
  -> "Hey, the value changed" -> reset to v1 ALB

... infinite loop (ALB keeps flipping back and forth)
```

I actually experienced this. When both External-DNS instances manage the same domain, they get into an **overwrite war**.

### Different owner-ids

With different owner-ids, they won't touch each other's records. But since you can't have two A records for the same domain, one side's owned record can't be updated by the other.

## Zero-Downtime Cutover with --migrate-from-txt-owner

External-DNS has a **`--migrate-from-txt-owner`** flag designed exactly for inter-cluster DNS transitions.

```yaml
# v2 external-dns config
extraArgs:
  txt-owner-id: "cluster-v2"
  migrate-from-txt-owner: "cluster-v1"  # take over v1's records
```

### How It Works

```
1. v2 external-dns scans Route53
2. Finds records with TXT owner "cluster-v1"
3. Changes TXT owner to "cluster-v2"
4. Updates A record to v2 ALB
-> Ownership + target switched simultaneously with no downtime
```

You can test this safely first:

```yaml
extraArgs:
  migrate-from-txt-owner: "cluster-v1"
  dry-run: "true"  # logs only, no actual changes
```

After the migration is complete, just remove the `migrate-from-txt-owner` line.

### When Both Use the Default owner-id

If neither v1 nor v2 set `txtOwnerId` (both default to `"default"`), `--migrate-from-txt-owner` isn't needed. v2's External-DNS already recognizes v1's TXT records as its own.

In this case, if v1's External-DNS is stopped and you add the domain to v2, v2 will naturally overwrite the existing A record with v2's ALB. Zero downtime.

**Caution**: If both are running simultaneously, you'll get the overwrite war described above. One side must be stopped.

## Phased Production Domain Cutover Strategy

Switching dozens of domains at once is risky. It's safer to start with low-impact domains and work your way up.

### Phase 1: Internal Infrastructure Tools

```
argocd, grafana, traefik-dashboard, kafka-ui, airflow ...
```

Only internal staff use these. If something goes wrong, only employees are affected, and you can roll back immediately.

### Phase 2: Admin / B2B

```
admin-panel, partner-portal ...
```

Used by internal operators and partners. Limited blast radius.

### Phase 3: User-Facing Frontend

```
homepage, web-app ...
```

Real customers access these. Proceed carefully from here.

### Phase 4: Core API

```
api.example.com, api-v4.example.com ...
```

Called by every app and web client. Highest traffic, highest impact on failure -- migrate these last.

For particularly high-traffic API domains, you might set up Route53 weighted routing manually for a gradual shift. Create manual weighted records outside External-DNS management, then hand control back to External-DNS after the cutover.

### Checklist for Each Phase

Repeat this process for each phase:

1. Add the domain to External-DNS hostname annotation
2. Git push -> ArgoCD sync
3. Verify DNS propagation: `dig +short <domain>`
4. Confirm service responds correctly: `curl -I https://<domain>`
5. Check monitoring (error rates, response times)
6. If issues arise, remove the domain from annotations -> rollback

## Preparing for the Next Migration

Once this transition is complete, set a `txtOwnerId` for future migrations:

```yaml
# v2 external-dns values
txtOwnerId: "cluster-v2"
```

When you eventually migrate to v3, all it takes is:

```yaml
# v3 external-dns values
txtOwnerId: "cluster-v3"
extraArgs:
  migrate-from-txt-owner: "cluster-v2"
```

If you leave the default `"default"`, you lose the ability to use this feature cleanly. Set it during the cleanup phase after migration.

## Summary

| Approach | Precision | Downtime | Complexity |
|----------|-----------|----------|------------|
| Route53 weighted routing (manual) | Low (DNS cache dependent) | None | Medium (manual, outside GitOps) |
| External-DNS sequential domain addition | Per-service on/off | None (when owner-id matches) | Low |
| `--migrate-from-txt-owner` | Per-service on/off | None | Low |

In the end, the most practical approach was **understanding and leveraging External-DNS's ownership mechanism**. Route53 weighted routing is theoretically appealing, but DNS caching behavior limits its precision for traffic control. A phased domain-by-domain cutover turned out to be more predictable and safer.
