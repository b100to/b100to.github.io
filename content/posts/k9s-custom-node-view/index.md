---
title: "k9s에서 Karpenter 노드 용도를 한눈에 구분하기"
date: 2026-02-25T16:00:00+09:00
description: "k9s views.yaml 커스텀 컬럼 설정으로 Karpenter NodePool별 노드 용도(base, batch, airflow 등)를 한눈에 파악하는 방법을 공유합니다."
keywords: ["k9s views.yaml", "k9s custom columns", "Karpenter NodePool", "k9s 노드 뷰 커스텀", "kubectl get nodes label", "k9s 설정"]
categories: ["Kubernetes"]
tags: ["k9s", "Karpenter", "Kubernetes", "EKS"]
showHero: true
heroStyle: "background"
---

EKS에서 `kubectl get nodes`를 치면 이런 화면을 보게 됩니다.

```
NAME                                                STATUS   AGE
ip-10-0-xx-xxx.ap-northeast-2.compute.internal      Ready    9d
ip-10-0-xx-xxx.ap-northeast-2.compute.internal      Ready    2d
ip-10-0-xx-xxx.ap-northeast-2.compute.internal      Ready    3d
fargate-ip-10-0-xx-xx.ap-northeast-2.compute.internal  Ready  1d
```

어떤 노드가 base이고, 어떤 게 batch인지 전혀 알 수가 없습니다. IP 기반 Private DNS가 노드 이름이라 의미 있는 정보가 없기 때문입니다.

---

## EKS 노드 이름은 바꿀 수 없다

결론부터 말하면, **EKS에서 Kubernetes 노드 이름은 변경할 수 없습니다.** kubelet이 EC2 메타데이터에서 Private DNS를 자동으로 가져와 노드 이름으로 사용하기 때문입니다. Karpenter든 Managed Node Group이든 마찬가지입니다.

그렇다면 대안은 **라벨**입니다.

---

## Karpenter NodePool 라벨 활용

Karpenter NodePool에서 `spec.template.metadata.labels`를 설정하면, 해당 NodePool이 프로비저닝하는 **모든 노드에 라벨이 자동으로 붙습니다.**

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: base
spec:
  template:
    metadata:
      labels:
        node-group-type: base  # 이 라벨이 노드에 전파됨
    spec:
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: base
      # ...
```

NodePool별로 `node-group-type: base`, `node-group-type: batch`, `node-group-type: airflow` 이런 식으로 설정해두면 됩니다.

kubectl에서는 `-L` 플래그로 확인할 수 있습니다:

```bash
kubectl get nodes -L node-group-type
```

```
NAME                                           STATUS   node-group-type
ip-10-0-xx-xxx.ap-northeast-2...               Ready    base
ip-10-0-xx-xxx.ap-northeast-2...               Ready    batch
fargate-ip-10-0-xx-xx.ap-northeast-2...        Ready
```

Fargate 노드는 Karpenter가 관리하지 않으므로 라벨이 비어있어 자연스럽게 구분됩니다.

---

## k9s에서 커스텀 컬럼 설정

kubectl은 그렇다 치고, k9s에서는 어떻게 할까? k9s v0.40.0부터 `views.yaml`에서 **라벨을 커스텀 컬럼으로 추출**할 수 있습니다.

### views.yaml 설정

```yaml
# macOS: ~/Library/Application Support/k9s/views.yaml
# Linux: ~/.config/k9s/views.yaml
views:
  v1/nodes:
    columns:
      - TYPE:.metadata.labels.node-group-type
      - STATUS
      - PODS
      - CPU
      - MEM
      - '%CPU'
      - '%MEM'
      - AGE
      - NAME|W
      - VERSION|W
```

핵심은 이 문법입니다:

```
컬럼명:.metadata.labels.라벨키
```

`.metadata.labels.node-group-type` 경로로 라벨 값을 추출해서 `TYPE`이라는 컬럼으로 보여줍니다.

### 컬럼 순서에 대한 생각

개인적으로 이 순서가 편했습니다:

| 순서 | 컬럼 | 이유 |
|------|------|------|
| 1 | TYPE | 노드 용도가 가장 먼저 보여야 함 |
| 2 | STATUS | 정상인지 바로 확인 |
| 3 | PODS | 노드별 파드 수 |
| 4-7 | CPU/MEM/%CPU/%MEM | 리소스 현황이 가장 자주 보는 정보 |
| 8 | AGE | 노드 수명 (방금 뜬 노드, 오래된 노드 파악) |
| 9 | NAME\|W | wide 모드에서만 표시 (평소엔 불필요) |
| 10 | VERSION\|W | wide 모드에서만 표시 |

**ROLE을 제거한 이유** - EKS Karpenter/Fargate 환경에서 항상 `<none>`이라 의미 없습니다.

**NAME, VERSION을 wide로 뺀 이유** - NAME은 IP 기반이라 길기만 하고, TYPE 라벨이 있으면 노드 식별에 굳이 필요하지 않습니다. VERSION도 자주 볼 일이 없어서 wide로 빼두고, 필요할 때 `ctrl+e`(wide 토글)로 확인하면 됩니다.

### 컬럼 속성 참고

k9s views.yaml에서 컬럼 뒤에 `|` 로 속성을 붙일 수 있습니다:

| 속성 | 의미 |
|------|------|
| `W` | wide 모드에서만 표시 |
| `H` | 숨김 |
| `R` | 오른쪽 정렬 |
| `S` | 항상 표시 (wide 기본 컬럼을 강제 표시) |

---

## 결과

k9s에서 `:node`로 들어가면 이렇게 보입니다:

```
TYPE      STATUS  PODS  CPU   MEM    %CPU  %MEM   AGE
base      Ready   12    850m  4.2Gi  10%   26%    9d
base      Ready   8     620m  3.1Gi  7%    19%    2d
batch     Ready   3     200m  512Mi  2%    3%     1h
<none>    Ready   2     50m   128Mi  0%    0%     5d    # Fargate
```

노드의 용도가 한눈에 들어옵니다. 실질적으로 노드 이름을 바꾼 것과 같은 효과입니다.
