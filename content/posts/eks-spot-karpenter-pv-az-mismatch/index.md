---
title: "EKS Spot + Karpenter 환경에서 PV/PVC AZ 불일치로 Pod Pending 발생 - 트러블슈팅"
date: 2026-01-29T16:55:00+09:00
description: "Spot 인스턴스가 특정 AZ에서 가용 불가할 때 발생하는 PV/PVC AZ 불일치 문제와 해결 방법을 정리했다."
keywords: ["EKS", "Karpenter", "Spot Instance", "PV", "PVC", "AZ", "Kubernetes", "트러블슈팅"]
categories: ["Troubleshooting"]
tags: ["Kubernetes", "EKS", "Karpenter", "Spot", "PV", "PVC"]
showHero: true
heroStyle: "background"
---

## 문제 상황

개발 환경에서 갑자기 여러 파드가 Pending 상태에 빠졌다. Karpenter로 Spot 인스턴스를 사용 중이었고, 기존엔 문제없이 잘 동작했는데 어느 날부터 파드들이 스케줄링되지 않았다.

```bash
kubectl get pods -A | grep Pending
# 9개 파드가 Pending...
```

## 원인 파악 과정

### Karpenter 이벤트 확인

처음엔 Karpenter 로그와 이벤트를 봤는데, 이런 메시지만 나왔다:

```
Warning  FailedScheduling  karpenter  Failed to schedule pod, all available instance types exceed limits for nodepool
```

NodePool의 CPU limit에 걸렸나 싶어서 확인해봤는데, 그건 의도적으로 설정한 거였다. 근데 왜 노드가 이상한 AZ에만 몰려있지?

### 노드 상태 확인

```bash
kubectl get nodes -L topology.kubernetes.io/zone
```

노드 3대가 전부 `ap-northeast-2c`에 있었다. 서브넷은 2a, 2c 둘 다 등록되어 있는데 왜 2c에만 생성된 걸까?

### PV/PVC 확인 - 여기서 원인 발견

```bash
kubectl get pv -o custom-columns='NAME:.metadata.name,AZ:.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values[0]'
```

```
NAME                    AZ
postgres-pv             ap-northeast-2a   # 문제!
data-kafka-controller-0 ap-northeast-2a   # 문제!
...
```

기존에 생성된 PV(EBS 볼륨)들이 `ap-northeast-2a`에 바인딩되어 있었다. EBS는 AZ에 물리적으로 묶여 있어서, 2a에 있는 EBS를 2c 노드에서는 마운트할 수 없다.

**결국 원인은:**
1. Spot 인스턴스가 `ap-northeast-2a`에서 가용 불가 (AWS 용량 이슈로 추정)
2. Karpenter가 가용한 2c에만 노드 생성
3. 기존 StatefulSet의 PV가 2a에 바인딩
4. 2c 노드에서 2a EBS 마운트 불가 → Pending

## 삽질 포인트

### 1. PV/PVC AZ binding을 잘 몰랐음

평소에 PV/PVC를 많이 안 다루다 보니, EBS가 AZ에 묶여있다는 걸 이론으로만 알고 있었다. 실제로 이게 파드 스케줄링에 영향을 준다는 걸 체감한 건 처음이었다.

### 2. Karpenter 이벤트가 너무 일반적

"all available instance types exceed limits" 메시지만 보고는 AZ 이슈인지 알기 어려웠다. `kubectl describe pod`의 Events를 보니까 더 자세한 정보가 나왔다:

```
3 node(s) didn't match Pod's node affinity/selector
```

### 3. On-demand는 되는데 Spot만 안 됨

이상하게 On-demand로 바꾸면 2a에도 노드가 잘 뜨는데, Spot은 2c에만 뜬다. AWS의 Spot 용량이 AZ별로 다른 것 같다.

### 4. topologySpreadConstraints 문제

일부 파드는 zone 분산 조건(`whenUnsatisfiable: DoNotSchedule`)이 걸려 있어서, 노드가 전부 2c에 있으니 분산 조건을 만족 못해서 추가로 Pending이 발생했다.

## 해결 방법

개발 환경이라 단일 AZ(2c)로 통일하기로 했다.

### 1. Karpenter NodePool에 zone 제한

```yaml
# nodepool.yaml
spec:
  template:
    spec:
      requirements:
        - key: topology.kubernetes.io/zone
          operator: In
          values: ["ap-northeast-2c"]
```

### 2. StorageClass에 allowedTopologies 추가

```yaml
# StorageClass gp3
allowedTopologies:
  - matchLabelExpressions:
      - key: topology.ebs.csi.aws.com/zone
        values:
          - ap-northeast-2c
```

이렇게 하면 새로 생성되는 PV는 무조건 2c에 생성된다.

### 3. 기존 EBS 마이그레이션

2a에 있던 EBS는 스냅샷을 떠서 2c에 새 볼륨을 생성했다. 데이터가 중요한 건 스냅샷으로 복원하고, 필요 없는 건 그냥 동적 프로비저닝으로 재생성했다.

### 4. topologySpreadConstraints 비활성화

단일 AZ라서 zone 분산이 의미가 없으므로 비활성화했다.

## 핵심 정리

| 항목 | 내용 |
|------|------|
| EBS | AZ에 물리적으로 묶임. 다른 AZ 노드에서 마운트 불가 |
| Spot 인스턴스 | AZ별 가용성이 다름. 특정 AZ에서 아예 안 될 수 있음 |
| 단일 AZ 운영 시 | NodePool, StorageClass, topologySpread 모두 맞춰야 함 |
| 디버깅 팁 | Karpenter 로그보다 `kubectl describe pod` Events가 더 정확 |

## 느낀 점

- 인프라를 잘 모르고 쓰면 이런 함정에 빠질 수 있다
- Spot 인스턴스의 AZ별 가용성은 예측하기 어려우니, 중요한 워크로드는 fallback 전략이 필요하지 않을까 싶다
- 개발 환경이라 단일 AZ로 단순화했지만, 운영 환경이면 Multi-AZ + On-demand fallback을 고려해야 할 것 같다
