---
title: "Karpenter 운영 최적화: 비용과 안정성 사이의 균형"
date: 2026-01-27T10:00:00+09:00
description: "Karpenter 프로덕션 운영에서 마주치는 문제들 - 노드 크기 선택, Consolidation 튜닝, JVM 워크로드 대응 방법을 실전 경험과 함께 공유합니다."
keywords: ["Karpenter 최적화", "Karpenter Consolidation", "Karpenter 노드 크기", "EKS 비용 최적화", "Karpenter budgets", "JVM Kubernetes 리소스", "Karpenter WhenEmptyOrUnderutilized"]
categories: ["Kubernetes"]
tags: ["Karpenter", "AWS", "EKS", "Kubernetes", "비용최적화"]
showHero: true
heroStyle: "background"
---

Karpenter는 강력한 노드 오토스케일러지만, 프로덕션에서 운영하다 보면 예상치 못한 문제들을 마주하게 됩니다. 이 글에서는 Spot 가용성 문제를 제외한 다른 최적화 과제들을 다룹니다.

> Spot 인스턴스 가용성 문제는 [이전 글](/posts/karpenter-spot-availability-issue/)에서 다뤘습니다.

---

## 1. 노드 수 vs 인스턴스 크기: 비용 최적화의 딜레마

### 문제 상황

Datadog, New Relic 같은 모니터링 도구는 **노드(호스트) 단위로 과금**합니다. 에이전트가 DaemonSet으로 배포되기 때문입니다.

```
xlarge × 4대 = 4개 에이전트 비용
2xlarge × 2대 = 2개 에이전트 비용 (동일 총 리소스)
```

같은 리소스라도 **큰 인스턴스를 적게 쓰는 것이 에이전트 비용에서 유리**합니다.

### 해결: 큰 인스턴스 우선 사용

```yaml
requirements:
  - key: node.kubernetes.io/instance-type
    operator: In
    values:
      # 2xlarge 우선 (8 vCPU) - 노드 수 최소화
      - "r7i.2xlarge"   # 8 vCPU, 64 GiB
      - "r6i.2xlarge"
      - "m7i.2xlarge"
      - "m6i.2xlarge"
```

### 트레이드오프

| 작은 인스턴스 (xlarge) | 큰 인스턴스 (2xlarge) |
|----------------------|---------------------|
| Spot 가용성 높음 | Spot 가용성 낮음 |
| 세밀한 스케일링 | 노드당 에이전트 비용 절감 |
| 장애 영향 범위 작음 | 장애 시 영향 범위 큼 |

**결론**: 에이전트 비용이 크다면 2xlarge 이상 권장, 아니라면 xlarge로 세밀하게.

---

## 2. Consolidation으로 인한 서비스 불안정

### 문제 상황

`WhenEmptyOrUnderutilized` 정책을 사용했더니, 노드가 지속적으로 생성/삭제를 반복했습니다.

```
10:00 - Node A 생성
10:05 - Node A 제거 시작 (underutilized 판정)
10:06 - Node B 생성 (Pod 재스케줄링)
10:11 - Node B 제거 시작
... 반복 (Churn)
```

결과:
- Pod 지속적 재시작
- 서비스 불안정
- PodDisruptionBudget 위반

### 해결: Consolidation 설정 조정

```yaml
disruption:
  consolidationPolicy: WhenEmptyOrUnderutilized

  # 충분한 안정화 시간
  consolidateAfter: 10m  # 5m → 10m

  # 동시 제거 노드 수 제한
  budgets:
    - nodes: "1"  # 한 번에 1개만
```

### Consolidation 정책 비교

| 정책 | 동작 | 적합한 경우 |
|-----|-----|-----------|
| `WhenEmpty` | 빈 노드만 제거 | 안정성 최우선 |
| `WhenEmptyOrUnderutilized` | 저활용 노드도 제거 | 비용 최적화 |

### budgets 설정의 중요성

```yaml
budgets:
  - nodes: "1"      # 절대값
  # 또는
  - nodes: "10%"    # 비율
```

**한 번에 하나씩만 제거**하면 대규모 동시 제거로 인한 서비스 영향을 방지할 수 있습니다.

---

## 3. TopologySpreadConstraints와의 충돌

### 문제 상황

Pod에 Zone 분산이 설정되어 있는데, 노드가 단일 Zone에만 있으면 스케줄링 실패.

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
```

```bash
$ kubectl get pods
my-pod-1    Running   # zone-c
my-pod-2    Pending   # zone-a/b에 노드 없음!
```

### 해결 방법

**방법 1: On-Demand 폴백**
```yaml
- key: karpenter.sh/capacity-type
  operator: In
  values: ["spot", "on-demand"]  # spot 우선, 불가 시 on-demand
```

**방법 2: whenUnsatisfiable 완화**
```yaml
whenUnsatisfiable: ScheduleAnyway  # DoNotSchedule 대신
```

**방법 3: 인스턴스 타입 다양화**

인스턴스 타입이 많을수록 Spot 가용 확률 증가 → Zone 분산 가능성 증가

---

## 4. JVM 워크로드의 리소스 스파이크

### 문제 상황

JVM(Spring Boot 등)은 **시작 시 높은 CPU 사용**:

```
정상 상태: 200m CPU
시작 시:   2000m CPU (10배!)
```

악순환 발생:
1. 여러 Pod 동시 재시작
2. Karpenter가 리소스 부족 판단 → 새 노드 생성
3. Pod 안정화 후 노드가 underutilized
4. Consolidation으로 노드 제거
5. 다시 1번으로...

### 해결 방법

**방법 1: requests에 스파이크 고려**
```yaml
resources:
  requests:
    cpu: 500m      # 시작 스파이크 일부 반영
    memory: 1Gi
  limits:
    cpu: 2000m     # 시작 시 필요량
    memory: 2Gi
```

**방법 2: consolidateAfter 여유있게**
```yaml
disruption:
  consolidateAfter: 10m  # JVM warmup 시간 고려
```

**방법 3: VPA 활용**
```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
spec:
  updatePolicy:
    updateMode: "Initial"  # 시작 시에만 적용
```

---

## 5. NodePool 분리로 동시 만료 방지 (Staggered Expiry)

### 문제 상황

`expireAfter`를 설정한 단일 NodePool을 사용하면, 비슷한 시점에 생성된 노드들이 **동시에 만료**됩니다.

```
09:00 - Node A, B, C 동시 생성
18:00 - Node A, B, C 동시 만료 → 연쇄 교체 → 서비스 장애!
```

budgets 설정으로 한 번에 1개씩 교체하더라도, 노드 갱신이 연속으로 이어지면 파드 재배치가 반복되며 서비스에 영향을 줍니다. 실제로 이 문제로 인해 프로덕션 장애를 경험했습니다.

### 해결: NodePool을 base-a / base-b로 분리

NodePool을 두 개로 나누고 만료 시간에 차이를 두어 교대로 갱신되게 합니다.

```yaml
# base-a
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: base-a
spec:
  template:
    spec:
      expireAfter: 720h  # 30일
  disruption:
    budgets:
      - nodes: "1"
---
# base-b: base-a와 24시간 차이
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: base-b
spec:
  template:
    spec:
      expireAfter: 744h  # 31일
  disruption:
    budgets:
      - nodes: "1"
```

- base-a 노드 교체 구간에는 base-b 노드가 안정 상태 유지
- 교대 갱신으로 항상 절반은 서비스 가능 상태 보장

---

## 6. 파드 분산 보장 — minDomains로 단일 노드 집중 방지

### 문제 상황

노드 장애 후 새 노드가 생성되면 **재스케줄링된 파드들이 한 노드에 몰리는 경우**가 있습니다.

```
노드 B 장애 → 파드가 노드 A로 몰림
새 노드 C 생성 → 그런데 파드는 여전히 A에만 집중
→ 노드 A 하나만 죽어도 전체 서비스 장애
```

`TopologySpreadConstraints`만으로는 이 상황을 막기 어렵습니다. 노드가 1개만 있는 상태에서는 maxSkew 조건이 이미 충족되기 때문입니다.

### 해결: minDomains 설정

`minDomains`는 분산이 보장되어야 하는 **최소 도메인(노드) 수**를 명시합니다. 이 수를 충족하지 못하면 파드 스케줄링을 보류시켜 Karpenter가 추가 노드를 프로비저닝하도록 유도합니다.

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: DoNotSchedule
    minDomains: 2  # 반드시 2개 이상의 노드에 분산
    labelSelector:
      matchLabels:
        app: my-app
```

- 활성 노드가 2개 미만이면 파드 스케줄링 보류 → Karpenter가 노드 추가 프로비저닝
- 노드가 2개 이상 확보된 후에야 파드 배치 → 단일 노드 집중 원천 차단

> **주의**: dev 환경처럼 **단일 노드로만 운영하는 경우**에는 설정하지 않습니다. 노드를 영원히 기다리게 됩니다.

---

## 7. 최종 권장 설정

위 문제들을 모두 고려한 프로덕션 설정:

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
        # 인스턴스 타입 (에이전트 비용 고려 시 2xlarge)
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

        # Spot 우선, On-Demand 폴백
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]

  limits:
    cpu: 24  # 2xlarge × 3대 최대

  # 안정적인 Consolidation
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 10m
    budgets:
      - nodes: "1"
```

---

## 결론

Karpenter 프로덕션 운영의 핵심:

| 항목 | 권장 |
|-----|-----|
| 에이전트 비용 | 큰 인스턴스로 노드 수 최소화 |
| Consolidation | `consolidateAfter: 10m` + `budgets: 1` |
| Zone 분산 | On-Demand 폴백 추가 |
| JVM 워크로드 | requests에 스파이크 반영 |
| 동시 만료 방지 | NodePool base-a/base-b 분리 + 만료 시간 차등 |
| 파드 집중 방지 | `minDomains: 2` (prod 전용, dev 제외) |

처음부터 완벽한 설정은 없습니다. **모니터링을 통해 지속적으로 조정**하는 것이 핵심입니다.

---

## 참고 자료

- [Karpenter 공식 문서](https://karpenter.sh/)
- [Karpenter Best Practices - AWS](https://aws.github.io/aws-eks-best-practices/karpenter/)
- [Spot 인스턴스 가용성 문제 해결](/posts/karpenter-spot-availability-issue/)
