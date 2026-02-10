---
title: "멀티 클러스터 DNS 마이그레이션 - External-DNS 소유권과 Route53 가중치 라우팅"
date: 2026-02-10T15:00:00+09:00
description: "Kubernetes 클러스터를 v1에서 v2로 전환할 때 External-DNS의 TXT 소유권 메커니즘과 Route53 가중치 라우팅을 활용한 무중단 DNS 마이그레이션 전략을 정리했다."
keywords: ["External-DNS", "Route53", "Kubernetes", "DNS", "마이그레이션", "멀티 클러스터", "가중치 라우팅"]
categories: ["DevOps"]
tags: ["Kubernetes", "External-DNS", "Route53", "DNS", "AWS"]
showHero: true
heroStyle: "background"
---

## 배경

EKS 클러스터를 v1에서 v2로 전환하는 작업을 진행하게 됐다. 수십 개의 서비스 도메인을 v1 클러스터의 ALB에서 v2 클러스터의 ALB로 옮겨야 하는 상황.

DNS는 External-DNS가 관리하고 있었고, Route53에 레코드를 자동 생성/삭제하는 구조였다. "그냥 v2에 도메인 추가하면 되는 거 아닌가?" 싶었는데, 생각보다 고려할 게 많았다.

## Route53 가중치 라우팅 - 생각보다 정밀하지 않다

처음엔 Route53의 가중치 기반 라우팅(Weighted Routing)으로 트래픽을 점진적으로 옮기면 되지 않을까 생각했다.

```
app.example.com  Weighted  weight=30  → v1 ALB
app.example.com  Weighted  weight=70  → v2 ALB
```

이론적으로는 70%의 트래픽이 v2로 가야 한다. 하지만 실제로 테스트해보니 **체감이 전혀 안 됐다**.

### 왜 안 되는가

Route53 가중치 라우팅은 **요청 단위가 아니라 DNS 조회 단위**로 분배된다.

```
클라이언트 → DNS 리졸버에 질의 → Route53이 가중치 기반으로 응답
                                    ├── 70% 확률 → v2 ALB IP
                                    └── 30% 확률 → v1 ALB IP

리졸버가 응답을 캐싱 → TTL 동안 동일 IP만 반환
```

한 번 v1 IP를 받은 클라이언트는 TTL이 만료될 때까지 **100% v1으로만** 간다. 전체 사용자 풀에서 대략적인 비율이 나뉘는 것이지, 개별 요청이 70/30으로 분배되는 게 아니다.

테스트 환경에서 소수의 클라이언트로 확인하면 리졸버가 1~2개뿐이라, 한쪽으로만 몰려 보이는 게 당연하다. **큰 수의 법칙**이 적용되려면 수천 개의 리졸버가 필요하다.

```bash
# 캐시를 무시하고 Route53에 직접 질의해서 분배 확인
for i in $(seq 1 20); do dig +short app.example.com @ns-xxx.awsdns-xx.com; done
```

### 그래도 쓸 수 있는 경우

정밀한 퍼센트 제어는 불가능하지만, "대략 70% 정도는 v2로 간다" 수준의 제어는 된다. 트래픽이 충분히 많은 프로덕션 환경이라면 의미 있는 수준으로 분배된다.

그리고 External-DNS가 Route53 가중치 라우팅을 **어노테이션으로 지원**한다. 수동으로 Route53 콘솔에서 만들 필요 없이 GitOps로 관리할 수 있다.

```yaml
# v1 클러스터 Ingress
annotations:
  external-dns.alpha.kubernetes.io/hostname: app.example.com
  external-dns.alpha.kubernetes.io/set-identifier: "v1-cluster"
  external-dns.alpha.kubernetes.io/aws-weight: "30"

# v2 클러스터 Ingress
annotations:
  external-dns.alpha.kubernetes.io/hostname: app.example.com
  external-dns.alpha.kubernetes.io/set-identifier: "v2-cluster"
  external-dns.alpha.kubernetes.io/aws-weight: "70"
```

양쪽 External-DNS가 각각 가중치 레코드 세트를 생성해서, Route53에서 자동으로 분배된다. 다만 이 방식은 **양쪽 클러스터에서 External-DNS가 동시에 동작해야 하고**, `set-identifier`가 달라야 충돌이 나지 않는다. `txtOwnerId`도 각 클러스터별로 다르게 설정해야 한다.

결국 가중치 라우팅이 필요한 상황이라면 이 어노테이션 방식이 정석이다. 다만 내 경우엔 이미 v1 External-DNS를 꺼둔 상태라 단계별 전환 방식을 선택했다.

## External-DNS의 TXT 소유권 메커니즘

External-DNS가 Route53 레코드를 관리할 때, A 레코드만 만드는 게 아니다. **TXT 레코드도 함께 생성**해서 "이 레코드는 내가 만든 것"이라는 소유권을 표시한다.

```
app.example.com        A      → ALB IP (실제 트래픽용)
app.example.com        TXT    → "heritage=external-dns,owner=default,..." (소유권 표시)
```

`owner` 값은 `--txt-owner-id` 플래그로 설정하는데, 별도 설정 안 하면 기본값 `"default"`가 된다.

### 같은 owner-id면 어떻게 되나

v1과 v2 External-DNS의 owner-id가 같으면, **서로의 레코드를 자기 것으로 인식**한다. 양쪽이 동시에 살아있으면 이런 일이 벌어진다:

```
v1 external-dns (sync 주기 ~1분)
  → app.example.com → v1 ALB로 설정

v2 external-dns (sync 주기 ~1분)
  → app.example.com → v2 ALB로 설정

v1 다시 sync
  → "어? 값이 바뀌었네" → v1 ALB로 다시 변경

... 무한 반복 (ALB가 계속 왔다갔다)
```

실제로 이 현상을 겪었다. 양쪽 External-DNS가 동시에 같은 도메인을 관리하면 **서로 덮어쓰기 싸움**을 한다.

### 다른 owner-id면

owner-id가 다르면 서로의 레코드를 건드리지 않는다. 하지만 같은 도메인에 대해 두 개의 A 레코드가 생길 수는 없으니, 한쪽이 소유한 레코드는 다른 쪽에서 업데이트할 수 없다.

## --migrate-from-txt-owner로 무중단 전환

External-DNS에는 **`--migrate-from-txt-owner`** 플래그가 있다. 이게 정확히 클러스터 간 DNS 전환을 위한 기능이다.

```yaml
# v2 external-dns 설정
extraArgs:
  txt-owner-id: "cluster-v2"
  migrate-from-txt-owner: "cluster-v1"  # v1 소유 레코드를 인계받음
```

### 동작 방식

```
1. v2 external-dns가 Route53 스캔
2. TXT owner가 "cluster-v1"인 레코드 발견
3. TXT owner를 "cluster-v2"로 변경
4. A 레코드를 v2 ALB로 업데이트
→ 다운타임 없이 소유권 + 타겟 동시 전환
```

사전 테스트도 가능하다:

```yaml
extraArgs:
  migrate-from-txt-owner: "cluster-v1"
  dry-run: "true"  # 실제 변경 없이 로그만 확인
```

전환 완료 후에는 `migrate-from-txt-owner` 줄만 제거하면 된다.

### owner-id가 둘 다 default일 때

만약 v1과 v2 모두 `txtOwnerId`를 설정하지 않았다면(기본값 `"default"`), `--migrate-from-txt-owner`가 필요 없다. v2 External-DNS가 v1이 남긴 TXT 레코드를 이미 자기 것으로 인식하기 때문이다.

이 경우 v1 External-DNS가 꺼져있는 상태에서 v2에 도메인을 추가하면, v2가 기존 A 레코드를 자연스럽게 v2 ALB로 덮어쓴다. 다운타임 없이.

**주의**: 양쪽이 동시에 살아있으면 위에서 말한 덮어쓰기 싸움이 발생한다. 반드시 한쪽은 꺼져있어야 한다.

## 프로덕션 도메인 단계별 전환 전략

수십 개 도메인을 한 번에 전환하는 건 리스크가 크다. 영향 범위가 작은 것부터 순차적으로 전환하는 게 안전하다.

### 1단계: 내부 인프라 도구

```
argocd, grafana, traefik-dashboard, kafka-ui, airflow ...
```

직원만 사용하는 도메인. 문제가 생겨도 내부 직원에게만 영향이 가고, 즉시 롤백할 수 있다.

### 2단계: 어드민/B2B

```
admin-panel, partner-portal ...
```

내부 운영자나 파트너가 사용하는 도메인. 영향 범위가 제한적이다.

### 3단계: 사용자 프론트엔드

```
homepage, web-app ...
```

실제 고객이 접근하는 웹 서비스. 여기서부터는 신중하게.

### 4단계: Core API

```
api.example.com, api-v4.example.com ...
```

모든 앱/웹에서 호출하는 핵심 API. 트래픽이 가장 많고 장애 시 영향이 가장 크기 때문에 마지막에 전환한다.

트래픽이 특히 많은 API 도메인은 Route53 가중치 라우팅을 수동으로 설정해서 점진적으로 옮기는 것도 방법이다. External-DNS 관리 밖에서 수동으로 가중치 레코드를 만들고, 전환 완료 후 External-DNS로 복귀시키면 된다.

### 각 단계 체크리스트

단계마다 이 과정을 반복한다:

1. External-DNS hostname 어노테이션에 도메인 추가
2. Git push → ArgoCD sync
3. DNS 전파 확인: `dig +short <domain>`
4. 서비스 정상 응답 확인: `curl -I https://<domain>`
5. 모니터링 확인 (에러율, 응답시간)
6. 문제 시 어노테이션에서 도메인 제거 → 롤백

## 다음 전환을 위한 준비

이번 전환이 끝나면, 다음을 위해 `txtOwnerId`를 설정해두는 게 좋다.

```yaml
# v2 external-dns values
txtOwnerId: "cluster-v2"
```

나중에 v3로 전환할 때 v3 쪽에서 이렇게만 하면 된다:

```yaml
# v3 external-dns values
txtOwnerId: "cluster-v3"
extraArgs:
  migrate-from-txt-owner: "cluster-v2"
```

기본값 `"default"`로 두면 이 기능을 활용할 수 없으니, 전환 정리 단계에서 꼭 설정해두자.

## 정리

| 방식 | 정밀도 | 다운타임 | 복잡도 |
|------|--------|----------|--------|
| Route53 가중치 라우팅 (수동) | 낮음 (DNS 캐시 의존) | 없음 | 중 (GitOps 밖 수동 관리) |
| External-DNS 도메인 순차 추가 | 서비스 단위 on/off | 없음 (owner-id 동일 시) | 낮음 |
| `--migrate-from-txt-owner` | 서비스 단위 on/off | 없음 | 낮음 |

결국 가장 실용적이었던 건 **External-DNS의 소유권 메커니즘을 이해하고 활용하는 것**이었다. Route53 가중치 라우팅은 이론상 매력적이지만, DNS 캐싱 특성상 정밀한 트래픽 제어에는 한계가 있다. 도메인을 단계별로 나눠서 전환하는 게 오히려 더 예측 가능하고 안전한 방법이었다.
