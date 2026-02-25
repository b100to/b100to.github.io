---
title: "AWS Load Balancer Controller's Automatic Security Group Management -- Know Before You Use It"
date: 2026-01-22T18:00:00+09:00
description: "How the AWS Load Balancer Controller automatically adds and removes inbound rules on Node Security Groups, and how to prevent unexpected issues with the right configuration."
keywords: ["AWS Load Balancer Controller security group", "EKS ALB security group", "manage-backend-security-group-rules", "ALB Ingress security group auto-management", "EKS NodePort security group", "target-type instance vs ip"]
categories: ["Kubernetes"]
tags: ["AWS", "EKS", "ALB", "Kubernetes", "DevOps"]
showHero: true
heroStyle: "background"
---

> TL;DR -- When using `target-type: instance`, the AWS Load Balancer Controller automatically manages Node Security Group inbound rules. This can silently remove rules you or other systems added. Either set `manage-backend-security-group-rules: "false"` or switch to `target-type: ip` to avoid surprises.

When using the AWS Load Balancer Controller on EKS with `target-type: instance`, there's an important behavior you should know about: **automatic security group management**.

## Understanding the Architecture

First, you need to understand the traffic flow when using `target-type: instance`:

```
Internet -> ALB -> Node (NodePort) -> Pod
```

- The ALB forwards traffic to the Node's NodePort
- The Node Security Group must allow inbound traffic from the ALB Security Group

## LB Controller's Automatic Security Group Management

When using `target-type: instance`, the AWS Load Balancer Controller **automatically manages inbound rules on the Node Security Group**.

### How It Works

1. When an Ingress resource is created or modified, the LB Controller builds a model
2. It calculates the required NodePort ranges
3. It automatically adds/removes inbound rules on the Node SG from the ALB SG

### Example Controller Log

```json
{
  "level": "info",
  "logger": "controllers.ingress",
  "msg": "successfully built model",
  "model": {
    "networking": {
      "ingress": [
        {"from": [{"securityGroup": {"groupID": "sg-xxx"}}], "ports": [{"port": 31971}]},
        {"from": [{"securityGroup": {"groupID": "sg-xxx"}}], "ports": [{"port": 32132}]}
      ]
    }
  }
}
```

## What to Watch Out For

This automatic management can lead to unexpected results.

### The Problem

- During reconciliation, the LB Controller recalculates security group rules
- It may determine existing rules are "unnecessary" and delete them
- This is especially problematic for manually added rules or rules managed by other systems

### What You'll See in CloudTrail

```json
{
  "eventName": "RevokeSecurityGroupIngress",
  "userIdentity": {
    "principalId": "AROA***:eks-*-aws-load-balancer-controller-*"
  },
  "requestParameters": {
    "groupId": "sg-xxx (Node SG)",
    "ipPermissions": {
      "items": [{"fromPort": 31971, "toPort": 32132}]
    }
  }
}
```

## Recommended Configuration

### Option 1: Disable Automatic Management (Recommended)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  annotations:
    alb.ingress.kubernetes.io/target-type: instance
    # Prevent LB Controller from auto-managing Node SG rules
    alb.ingress.kubernetes.io/manage-backend-security-group-rules: "false"
```

With this setting, you'll need to manage Node SG rules yourself:

```bash
# ALB SG -> Node SG (full NodePort range)
aws ec2 authorize-security-group-ingress \
  --group-id <NODE_SG_ID> \
  --protocol tcp --port 30000-32767 \
  --source-group <ALB_SG_ID>
```

### Option 2: Use target-type: ip

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  annotations:
    alb.ingress.kubernetes.io/target-type: ip
```

- Connects directly to Pod IPs, so NodePort is unnecessary
- The LB Controller doesn't touch Node SGs at all
- Recommended for new clusters

## Comparison

| Setting | Auto SG Management | NodePort Required | Recommended For |
|---------|-------------------|-------------------|-----------------|
| `target-type: instance` | Yes (default) | Yes | Existing clusters |
| `target-type: instance` + `manage-backend-security-group-rules: false` | No | Yes | When stability matters |
| `target-type: ip` | No | No | New clusters |

## Monitoring Recommendations

- Monitor ALB Target Group healthy/unhealthy status
- Set up alerts for `RevokeSecurityGroupIngress` events in CloudTrail
- Monitor LB Controller logs

## Final Thoughts

The AWS Load Balancer Controller's automatic security group management is a convenient feature, but you need to understand exactly how it works before relying on it.

For predictable infrastructure operations:
1. Consider using the `manage-backend-security-group-rules: false` annotation, or
2. Switch to `target-type: ip` for new clusters.

## References

- [AWS Load Balancer Controller - Security Group](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/deploy/security_group/)
- [ALB Ingress Annotations](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/ingress/annotations/)
