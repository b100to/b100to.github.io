---
title: "AWS Load Balancer Controller의 보안 그룹 자동 관리, 알고 쓰자"
date: 2026-01-22T18:00:00+09:00
description: "AWS Load Balancer Controller가 Node Security Group을 자동 관리하는 방식과 주의점"
categories: ["Kubernetes"]
tags: ["AWS", "EKS", "ALB", "Kubernetes", "DevOps"]
showHero: true
heroStyle: "background"
---

EKS에서 AWS Load Balancer Controller를 사용할 때, `target-type: instance` 설정과 함께 알아두어야 할 중요한 동작이 있습니다. 바로 **보안 그룹 자동 관리** 기능입니다.

## 아키텍처 이해

먼저 `target-type: instance` 사용 시 트래픽 흐름을 이해해야 합니다.

```
Internet → ALB → Node (NodePort) → Pod
```

- ALB가 Node의 NodePort로 트래픽을 전달
- Node Security Group이 ALB Security Group으로부터의 인바운드 트래픽을 허용해야 함

## LB Controller의 보안 그룹 자동 관리

AWS Load Balancer Controller는 `target-type: instance` 사용 시 **Node Security Group의 인바운드 규칙을 자동으로 관리**합니다.

### 동작 방식

1. Ingress 리소스 생성/변경 시 LB Controller가 모델을 빌드
2. 필요한 NodePort 범위를 계산
3. Node SG에 ALB SG로부터의 인바운드 규칙을 자동 추가/삭제

### Controller 로그 예시

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

## 주의해야 할 점

이 자동 관리 기능이 예상치 못한 결과를 초래할 수 있습니다.

### 문제 상황

- LB Controller가 reconcile 과정에서 보안 그룹 규칙을 재계산
- 기존에 있던 규칙을 "불필요"하다고 판단하여 삭제할 수 있음
- 특히 수동으로 추가한 규칙이나 다른 시스템이 관리하는 규칙과 충돌 가능

### CloudTrail에서 확인되는 이벤트

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

## 권장 설정

### 방법 1: 자동 관리 비활성화 (권장)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  annotations:
    alb.ingress.kubernetes.io/target-type: instance
    # LB Controller가 Node SG 규칙을 자동 관리하지 않도록 설정
    alb.ingress.kubernetes.io/manage-backend-security-group-rules: "false"
```

이 설정을 사용하면 Node SG 규칙을 직접 관리해야 합니다.

```bash
# ALB SG → Node SG (NodePort 전체 범위)
aws ec2 authorize-security-group-ingress \
  --group-id <NODE_SG_ID> \
  --protocol tcp --port 30000-32767 \
  --source-group <ALB_SG_ID>
```

### 방법 2: target-type: ip 사용

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  annotations:
    alb.ingress.kubernetes.io/target-type: ip
```

- Pod IP로 직접 연결하므로 NodePort 불필요
- LB Controller가 Node SG를 건드리지 않음
- 새 클러스터에서는 이 방식 권장

## 비교 정리

| 설정 | SG 자동 관리 | NodePort 필요 | 권장 |
|------|-------------|--------------|------|
| `target-type: instance` | O (기본) | O | 기존 클러스터 |
| `target-type: instance` + `manage-backend-security-group-rules: false` | X | O | 안정성 필요 시 |
| `target-type: ip` | X | X | 새 클러스터 |

## 모니터링 권장

- ALB Target Group의 healthy/unhealthy 상태 모니터링
- CloudTrail에서 `RevokeSecurityGroupIngress` 이벤트 알림 설정
- LB Controller 로그 모니터링

## 마무리

AWS Load Balancer Controller의 보안 그룹 자동 관리는 편리한 기능이지만, 그 동작 방식을 정확히 이해하고 사용해야 합니다.

예측 가능한 인프라 운영을 위해:
1. `manage-backend-security-group-rules: false` 어노테이션 사용을 고려하거나
2. 새 클러스터에서는 `target-type: ip` 사용을 권장합니다.

## 참고 자료

- [AWS Load Balancer Controller - Security Group](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/deploy/security_group/)
- [ALB Ingress Annotations](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/ingress/annotations/)
