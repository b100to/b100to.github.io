---
title: "Helm Values에 _defaults.yaml 저장하기 - AI와 협업할 때 유용한 패턴"
date: 2026-01-28T11:45:00+09:00
description: "AI 코딩 어시스턴트와 협업할 때 Helm chart 기본값을 참조용으로 저장해두면 잘못된 설정을 방지할 수 있습니다. _defaults.yaml 패턴을 소개합니다."
keywords: ["Helm", "Kubernetes", "GitOps", "AI", "DevOps", "values.yaml", "Claude"]
categories: ["DevOps"]
tags: ["Helm", "Kubernetes", "AI", "Best Practices"]
showHero: true
heroStyle: "background"
---

## 문제 상황

AI 코딩 어시스턴트(Claude, Copilot 등)와 함께 Kubernetes 인프라 작업을 하다 보면 이런 상황이 생깁니다.

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

분명 맞는 설정 같은데... **적용이 안 됩니다.**

확인해보니 kafka-ui Helm chart는 `startupProbe`를 직접 지원하지 않고, `probes.liveness.initialDelaySeconds` 형식을 사용해야 했습니다.

```yaml
# 올바른 설정
probes:
  liveness:
    initialDelaySeconds: 120
  readiness:
    initialDelaySeconds: 120
```

## 왜 이런 일이 생길까?

AI 어시스턴트는 학습 데이터 기준 이후의 최신 Helm chart 스펙을 모릅니다.

- chart마다 values 구조가 다름
- 버전별로 옵션이 바뀜
- `helm show values`를 실행해도 로컬에 chart가 없으면 못 가져옴

결국 AI가 "일반적인" Kubernetes 설정을 제안하지만, 특정 chart에서는 무시될 수 있습니다.

## 해결: `_defaults.yaml` 패턴

values 디렉토리에 chart의 기본값을 저장해두는 방식입니다.

```
06_values/infra/kafka-ui/
├── _defaults.yaml   # helm show values 결과 (참조용)
├── dev.yaml
└── prd.yaml
```

### `_defaults.yaml` 예시

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
# ... 나머지 기본값들
```

## 장점

### 1. AI가 정확한 옵션 사용 가능

AI에게 "kafka-ui 설정할 때 `_defaults.yaml` 참고해"라고 하면:
- 지원하는 옵션만 사용
- 기본값과 비교해서 변경점 명확히 파악
- `startupProbe` 같은 잘못된 키 사용 방지

### 2. 팀원 온보딩에 유용

새로운 팀원이 "이 chart에 어떤 옵션이 있지?" 할 때 바로 확인 가능.

### 3. 업그레이드 시 diff 비교 쉬움

chart 버전 올릴 때 `_defaults.yaml`도 갱신하면:
```bash
git diff _defaults.yaml
```
어떤 옵션이 추가/변경/삭제됐는지 한눈에 확인.

## 실제 적용 예시

```yaml
# dev.yaml
# 기본값 참조: _defaults.yaml (kafka-ui v1.5.3)

resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "200m"

# 앱 시작에 ~90초 소요되므로 probe 대기시간 확보
# (기본값: 10초 → 120초로 변경)
probes:
  liveness:
    initialDelaySeconds: 120
  readiness:
    initialDelaySeconds: 120
```

주석으로 기본값 대비 변경 사항을 명시하면 더 명확합니다.

## 유지보수 팁

### 자동 갱신 스크립트

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

### Makefile에 추가

```makefile
update-defaults:
	./scripts/update-defaults.sh kafka-ui/kafka-ui 06_values/infra/kafka-ui/_defaults.yaml
	./scripts/update-defaults.sh grafana/loki 06_values/infra/monitoring/loki/_defaults.yaml
```

## 고려사항

이 패턴에도 트레이드오프가 있습니다.

### 레포지토리 용량 증가

Helm chart의 기본값 파일은 수백~수천 줄이 될 수 있습니다. 여러 chart를 관리하면 `_defaults.yaml` 파일들이 쌓여 레포가 무거워질 수 있습니다.

```
# 예시: 주요 chart들의 기본값 크기
kafka-ui:     ~200줄
loki:         ~1,500줄
kube-prometheus-stack: ~4,000줄
```

필요한 chart만 선별적으로 저장하거나, 자주 참조하는 섹션만 추출하는 방식도 고려해볼 수 있습니다.

### 버전 업데이트 시 동기화 필요

chart 버전을 올릴 때마다 `_defaults.yaml`도 함께 갱신해야 합니다. 그렇지 않으면 AI가 이전 버전의 옵션을 참조하게 됩니다.

ArgoCD로 버전 관리를 한다면 Application manifest에서 버전을 참조할 수 있습니다:

```yaml
# argocd/applications/kafka-ui.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
spec:
  source:
    chart: kafka-ui
    repoURL: https://provectus.github.io/kafka-ui-charts
    targetRevision: 1.5.3  # 이 버전 참조
```

이 부분을 `.claude/CLAUDE.md`에 명시해두면 됩니다:

```markdown
## Helm Chart 작업 시 규칙

- values 수정 전 `_defaults.yaml` 파일을 참조할 것
- chart 버전은 ArgoCD Application manifest의 `targetRevision` 확인할 것
- chart 버전 업그레이드 시 `helm show values`로 `_defaults.yaml` 갱신할 것
- 기본값과 다른 설정에는 주석으로 이유 명시할 것
```

AI에게 이 규칙을 알려두면, ArgoCD Application에서 버전을 확인하고 해당 버전에 맞는 기본값 파일을 갱신합니다.

## 결론

AI와 협업할 때는 **AI가 참조할 수 있는 컨텍스트**를 코드베이스에 남겨두는 게 중요합니다.

`_defaults.yaml` 패턴은:
- 작은 노력 (한 번 저장)
- 큰 효과 (잘못된 설정 방지, 온보딩 용이)

Helm chart뿐 아니라 Terraform module, API spec 등에도 비슷하게 적용할 수 있는 패턴입니다.

---

*이 글은 실제로 kafka-ui 설정하다가 AI가 잘못된 옵션을 제안해서 삽질한 경험에서 나왔습니다.* 😅
