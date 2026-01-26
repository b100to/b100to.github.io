---
title: "Karpenter + Spot 인스턴스: 노드가 생성되지 않는 문제 해결하기"
date: 2026-01-26T18:00:00+09:00
description: "Karpenter에서 'no instance type has the required offering' 에러가 발생할 때 원인과 해결 방법. Spot 가격이 있어도 용량이 없는 경우 인스턴스 타입 다양화로 해결하는 방법을 설명합니다."
keywords: ["Karpenter Spot 노드 생성 안됨", "no instance type has the required offering", "Karpenter InsufficientInstanceCapacity", "EKS Spot 인스턴스 가용성", "Karpenter NodePool 설정", "Spot 용량 부족 해결"]
categories: ["Kubernetes"]
tags: ["Karpenter", "Spot", "AWS", "EKS", "Kubernetes", "트러블슈팅"]
showHero: true
heroStyle: "background"
---

Spot 인스턴스를 사용할 때 특정 Zone에서 노드가 생성되지 않는 문제를 경험하고, 해결 과정을 공유합니다.

## TL;DR

- Spot 인스턴스는 **가격이 존재해도 실제 용량이 없을 수 있음**
- 특정 인스턴스 타입의 Spot 용량은 **Zone별로 다름**
- **해결책**: 다양한 인스턴스 타입을 NodePool에 추가하여 가용성 확보

---

## 문제 상황

### 증상

Pod들이 Pending 상태로 멈춰있고, Karpenter가 노드를 생성하지 않음.

```bash
$ kubectl get pods -A --field-selector=status.phase=Pending
NAMESPACE    NAME                        READY   STATUS    AGE
app          my-api-xxxxx                0/1     Pending   10m
app          another-api-xxxxx           0/1     Pending   10m
monitoring   prometheus-server-xxxxx     0/2     Pending   10m
```

### Karpenter 로그 확인

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

**핵심 에러**: `no instance type has the required offering`

### 환경

- EKS 1.34
- Karpenter v1
- NodePool: r7i.xlarge, r7i.2xlarge (Spot only)
- TopologySpreadConstraints: Zone 분산 필수 (maxSkew: 1)

---

## 원인 분석

### 1. Spot 가격 vs Spot 용량

```bash
# Spot 가격 확인
$ aws ec2 describe-spot-price-history \
    --instance-types r7i.xlarge r7i.2xlarge \
    --availability-zone ap-northeast-2a \
    --product-descriptions "Linux/UNIX"

{
  "SpotPriceHistory": [
    {
      "AvailabilityZone": "ap-northeast-2a",
      "InstanceType": "r7i.xlarge",
      "SpotPrice": "0.161400"  # 가격은 존재!
    }
  ]
}
```

**함정**: Spot 가격이 존재한다고 해서 **실제로 인스턴스를 받을 수 있는 것은 아님**.

AWS Spot은 여유 EC2 용량을 판매하는 것이므로:
- 해당 Zone에 물리적 용량이 없으면 → 인스턴스 생성 불가
- 특히 **최신 인스턴스 타입(r7i, m7i 등)**은 용량이 제한적

### 2. Zone별 Spot 용량 차이

```
Zone A: r7i.xlarge Spot 용량 없음 ❌
Zone C: r7i.xlarge Spot 용량 있음 ✅
```

Karpenter는 Pod의 TopologySpreadConstraints를 만족시키기 위해 Zone A에 노드를 생성해야 하지만, 해당 Zone에 Spot 용량이 없어서 실패.

### 3. 현재 노드 분포 확인

```bash
$ kubectl get nodes -L topology.kubernetes.io/zone
NAME           ZONE      NODEPOOL
ip-10-0-74-x   zone-c    base
ip-10-0-75-x   zone-c    base
```

**모든 노드가 한 Zone에 집중** → 다른 Zone에 노드가 필요하지만 생성 불가

---

## 해결 방법

### 핵심 전략: 인스턴스 타입 다양화

Spot 용량은 인스턴스 타입마다 다르므로, **여러 타입을 지정하여 가용성 확보**.

### Before (문제 발생)

```yaml
# NodePool
requirements:
  - key: node.kubernetes.io/instance-type
    operator: In
    values:
      - "r7i.xlarge"    # 최신, 용량 제한적
      - "r7i.2xlarge"   # 최신, 용량 제한적
  - key: karpenter.sh/capacity-type
    operator: In
    values: ["spot"]
```

### After (해결)

```yaml
# NodePool
requirements:
  - key: node.kubernetes.io/instance-type
    operator: In
    values:
      # r7i - 메모리 최적화 (최신)
      - "r7i.xlarge"
      - "r7i.2xlarge"
      # r6i - 메모리 최적화 (가용성 높음)
      - "r6i.xlarge"
      - "r6i.2xlarge"
      # m7i - 범용 (최신)
      - "m7i.xlarge"
      - "m7i.2xlarge"
      # m6i - 범용 (가용성 매우 높음)
      - "m6i.xlarge"
      - "m6i.2xlarge"
  - key: karpenter.sh/capacity-type
    operator: In
    values: ["spot"]
```

### 왜 효과적인가?

| 인스턴스 패밀리 | 세대 | Spot 가용성 | 비고 |
|----------------|------|------------|------|
| r7i | 7세대 | 낮음 | 최신, 수요 많음 |
| r6i | 6세대 | 높음 | 안정적, 충분한 용량 |
| m7i | 7세대 | 중간 | 범용, 적절한 가용성 |
| m6i | 6세대 | 매우 높음 | 가장 안정적 |

**8개 인스턴스 타입** → 최소 하나는 Spot 용량 확보 가능

---

## 추가 고려사항

### 1. On-Demand 폴백 (선택)

Spot이 완전히 없는 극단적 상황 대비:

```yaml
- key: karpenter.sh/capacity-type
  operator: In
  values:
    - "spot"
    - "on-demand"  # 폴백
```

**주의**: On-Demand는 비용이 3-4배 높음

### 2. 인스턴스 크기 다양화

```yaml
values:
  - "r6i.large"     # 2 vCPU
  - "r6i.xlarge"    # 4 vCPU
  - "r6i.2xlarge"   # 8 vCPU
```

작은 인스턴스일수록 Spot 용량이 풍부한 경향

### 3. Spot Interruption 대비

Spot은 언제든 회수될 수 있으므로:
- Pod Disruption Budget (PDB) 설정
- 여러 Zone에 분산 배치
- Graceful shutdown 구현

---

## 모니터링 및 디버깅

### Karpenter 로그 확인

```bash
# 스케줄링 실패 확인
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter | grep -i "could not schedule"

# 노드 생성 시도 확인
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter | grep -i "created nodeclaim"

# InsufficientCapacity 에러 확인
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter | grep -i "InsufficientInstanceCapacity"
```

### NodePool 상태 확인

```bash
kubectl get nodepool -o wide
kubectl describe nodepool <name>
```

### EC2NodeClass 상태 확인

```bash
# Subnet 발견 여부
kubectl get ec2nodeclass <name> -o jsonpath='{.status.subnets}'
```

---

## 결론

### 핵심 교훈

1. **Spot 가격 ≠ Spot 용량**: 가격이 있어도 인스턴스를 못 받을 수 있음
2. **최신 인스턴스 타입은 용량 제한적**: r7i, m7i보다 r6i, m6i가 안정적
3. **다양성이 안정성**: 여러 인스턴스 타입을 지정해야 Spot 가용성 확보
4. **Zone별 용량 차이 존재**: 특정 Zone에서만 문제 발생 가능

### 권장 설정

프로덕션 환경에서는:
- **최소 6-8개 인스턴스 타입** 지정
- **2개 이상의 인스턴스 패밀리** 사용 (r + m)
- **2개 세대 포함** (6세대 + 7세대)

이렇게 구성하면 대부분의 Spot 가용성 문제를 예방할 수 있습니다.

---

## 참고 자료

- [Karpenter Best Practices](https://karpenter.sh/docs/concepts/nodepools/)
- [AWS Spot Instance Advisor](https://aws.amazon.com/ec2/spot/instance-advisor/)
- [EC2 Instance Types](https://aws.amazon.com/ec2/instance-types/)
