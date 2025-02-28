---
title: "ArgoCD에서 Nginx Helm 차트 멀티소스 배포하기"
date: 2025-02-26 19:27:00 +0900
description: "ArgoCD에서 Nginx Helm 차트 멀티소스 배포하기"
categories: [ArgoCD]
tags: [ArgoCD, Helm, GitOps, Kubernetes, 멀티소스배포]
image: /assets/img/2025-02-26.svg
---
# ArgoCD에서 Nginx Helm 차트 멀티소스 배포하기

> **카테고리**: DevOps, Kubernetes, GitOps  
> **태그**: #ArgoCD #Helm #Kubernetes #GitOps #Nginx #멀티소스배포

요즘 ArgoCD로 Helm 차트 배포하면서 겪은 문제와 해결책을 공유하려고 합니다. 특히 values 파일을 별도 레포에서 관리하는 방법에 대한 내용인데, 처음에는 이게 가능한지 몰랐다가 알게 된 과정을 기록해 봅니다.

## 어떻게 시작됐나

팀에서 ArgoCD로 여러 마이크로서비스를 관리하는데, Helm 차트는 Artifact Hub에서 가져오고 values는 우리 자체 Git 레포에서 관리하고 싶었습니다. 처음에는 이게 가능한지 몰랐는데, ArgoCD 문서를 파헤치다 보니 멀티소스 기능이 있더라고요. 테스트해보니 정말 잘 작동해서 이 방법을 공유합니다.

## 이렇게 하면 좋은 점

1. **관심사 분리**: 차트와 설정값을 각각 다른 레포에서 관리할 수 있어요. 차트는 Bitnami 같은 공식 레포에서 가져오고, values만 우리 코드 관리하듯 Git으로 관리하니까 깔끔합니다.
2. **버전 관리가 편함**: PR 리뷰도 쉽고, 롤백도 간단해집니다. values만 바꾸는 경우 차트 버전은 그대로 두고 설정만 변경할 수 있어요.
3. **재사용성**: 똑같은 Nginx 차트를 dev, staging, prod에 각각 다른 values로 배포할 때 코드 중복 없이 깔끔하게 가능합니다.

## 구현 방법

실제 사용한 ArgoCD Application 매니페스트는 아래와 같습니다. 핵심은 `spec.sources` 필드에서 여러 소스를 정의하는 부분입니다.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nginx
  namespace: argocd
spec:
  project: default
  sources:
    # 첫 번째 소스: Bitnami Helm 차트
    - repoURL: https://charts.bitnami.com/bitnami
      chart: nginx
      targetRevision: 15.0.2
      helm:
        releaseName: nginx
        valueFiles:
          - $values/helm/nginx/values.yaml
    # 두 번째 소스: 우리 회사 Git 레포의 values 파일
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

## 코드 설명

가장 중요한 부분을 풀어보자면:

1. **첫 번째 소스** (`sources[0]`):
   - `repoURL`: Bitnami Helm 차트 레포지토리 URL
   - `chart`: nginx Helm 차트 이름 (여기서는 nginx를 사용)
   - `targetRevision`: 차트 버전 (15.0.2)
   - `valueFiles`: 여기서 `$values`가 핵심! 두 번째 소스를 이 별칭으로 참조합니다

2. **두 번째 소스** (`sources[1]`):
   - 우리 자체 Git 레포를 지정하고
   - `ref: values`로 이름을 정해주면, 첫 번째 소스에서 `$values`로 참조 가능

이 밖에도 자동 동기화(`automated`), 네임스페이스 자동 생성(`CreateNamespace=true`) 등 편의 기능도 설정했습니다.

## 내부 작동 방식

ArgoCD는 이런 과정으로 처리합니다:

1. 각 소스를 따로 가져옴: Bitnami 차트와 우리 Git 레포
2. `$values` 참조를 실제 경로로 대체
3. Helm 템플릿 렌더링해서 최종 K8s 매니페스트 생성
4. 클러스터에 적용

처음에는 이 방법 찾느라 좀 헤맸는데, ArgoCD 2.4 버전부터 이런 멀티소스 기능이 추가됐더라고요. 이전 버전에서는 약간 다른 방식으로 해야 했습니다.

## 실제 사용해보니

이 방식은 이런 상황에서 특히 유용했습니다:

- **여러 환경 관리**: dev, staging, prod 환경에 동일한 nginx 차트를 배포하는데, values만 달리해서 리소스 설정이나 인그레스 설정을 환경별로 조정할 수 있었어요
- **중앙 관리**: 모든 서비스의 values 파일을 한 레포에서 관리하니 전체 인프라 설정을 한눈에 파악하기 좋았습니다
- **SSL 관리**: HTTPS 인증서 설정을 별도 레포에서 관리하면서 접근 권한도 제한할 수 있었어요
- **팀 협업**: 인프라팀은 Helm 차트와 기본 설정을, 개발팀은 앱 특화 values만 관리하는 식으로 역할 분담이 가능해졌습니다

개인적으로 가장 좋았던 점은 차트 버전과 values를 독립적으로 업데이트할 수 있다는 점이었습니다. 차트 버전은 그대로 두고 values만 수정하는 PR을 올리면 리뷰하기도 훨씬 편했어요.

## 주의할 점

몇 가지 삽질했던 부분을 공유하자면:

1. **참조 이름 중복**: `ref` 이름을 여러 소스에서 똑같이 쓰면 충돌납니다. 고유한 이름으로 지정하세요.
2. **경로 정확성**: values 파일 경로가 정확해야 합니다. 오타 하나라도 있으면 동기화가 실패합니다.
3. **접근 권한**: ArgoCD ServiceAccount가 모든 Git 레포에 접근할 수 있도록 SSH 키나 토큰을 미리 설정해두세요.
4. **차트 버전 지정**: 항상 명확한 버전을 지정하세요. `targetRevision: "*"` 같은 와일드카드는 예상치 못한 업그레이드를 발생시킬 수 있습니다.

또 하나 주의할 점은 여러 소스를 사용하면 동기화 시간이 좀 더 오래 걸릴 수 있다는 거예요. 하지만 관리 편의성을 생각하면 감수할 만한 부분이라고 생각합니다.

## 마치며

처음에는 "ArgoCD에서 Helm 차트랑 values를 따로 관리할 수 있을까?" 하는 의문으로 시작했는데, 이렇게 멀티소스 기능으로 깔끔하게 해결할 수 있었습니다. K8s와 GitOps 환경에서 이런 패턴이 많은 분들께 도움이 되길 바랍니다.

이 방식을 적용한 뒤로 배포 과정이 더 체계적이고 관리하기 쉬워졌네요. 특히 설정 변경이 잦은 서비스에서 유용했습니다. 혹시 비슷한 고민을 하고 계신 분들이 있다면 한번 시도해보세요!

질문이나 더 나은 방법이 있으시면 댓글로 알려주세요. 다음에는 ArgoCD에서 멀티클러스터 환경 구성하는 방법에 대해 공유해보려고 합니다.

## 참고 문헌

- [ArgoCD 공식 문서: Multiple Sources](https://argo-cd.readthedocs.io/en/stable/user-guide/multiple_sources/)
- [Bitnami Nginx Helm Chart](https://github.com/bitnami/charts/tree/main/bitnami/nginx)
- [ArgoCD 공식 문서: Helm Values From Git](https://argo-cd.readthedocs.io/en/stable/user-guide/helm/#values-from-git)
- [Kubernetes GitOps: ArgoCD Best Practices](https://codefresh.io/learn/argo-cd/argo-cd-best-practices/)
- [Helm 공식 문서: Chart Dependencies](https://helm.sh/docs/topics/charts/#chart-dependencies)
