# EKS ALB Ingress 504 장애 - AWS LB Controller의 보안 그룹 자동 관리 문제

## 개요

| 항목 | 내용 |
|------|------|
| 발생 시간 | 2026-01-22 16:59 KST |
| 복구 시간 | 2026-01-22 17:35 KST (약 36분) |
| 영향 범위 | PRD 클러스터 전체 서비스 (504 Gateway Timeout) |
| 근본 원인 | AWS Load Balancer Controller가 Node SG의 인바운드 규칙 삭제 |

## 타임라인

| 시간 (KST) | 이벤트 |
|------------|--------|
| 15:48 | LB Controller가 Ingress 모델 빌드/배포 |
| 16:59 | LB Controller가 Node SG에서 NodePort 인바운드 규칙 삭제 |
| 17:07 | 장애 인지 - 전체 서비스 504 Gateway Timeout |
| 17:21 | 원인 분석 - ALB 타겟 그룹 전체 unhealthy 확인 |
| 17:30 | Node SG에 ALB SG 인바운드 규칙 수동 추가 |
| 17:31 | 타겟 그룹 healthy 복구 확인 |
| 17:35 | 서비스 정상화 확인 |

## 장애 현상

### 증상
- 모든 외부 서비스 접근 시 504 Gateway Timeout 반환
- 전체 API 및 웹 서비스 영향

### 진단
```bash
# ALB 타겟 그룹 헬스 확인
aws elbv2 describe-target-health --target-group-arn <TG_ARN>

# 결과: 모든 타겟 unhealthy - "Request timed out"
```

## 근본 원인 분석

### 아키텍처 배경

```
Internet → ALB → Node (NodePort) → Ingress Pod → 각 서비스
```

- ALB Ingress: `target-type: instance` 사용
- ALB가 Node의 NodePort로 트래픽 전달
- Node SG가 ALB SG로부터의 인바운드 트래픽을 허용해야 함

### 문제 발생 메커니즘

1. AWS Load Balancer Controller는 `target-type: instance` 사용 시 Node SG의 인바운드 규칙을 **자동 관리**
2. LB Controller가 reconcile 과정에서 보안 그룹 규칙을 재계산
3. 기존에 있던 NodePort 인바운드 규칙을 "불필요"하다고 판단하여 **삭제**
4. ALB → Node 연결 불가 → 헬스체크 실패 → 전체 타겟 unhealthy

### CloudTrail 증거

```json
{
  "eventTime": "2026-01-22T07:59:14Z",
  "userIdentity": {
    "principalId": "AROA***:eks-*-aws-load-balancer-controller-*"
  },
  "eventName": "RevokeSecurityGroupIngress",
  "requestParameters": {
    "groupId": "sg-xxx (Node SG)",
    "ipPermissions": {
      "items": [{
        "fromPort": 31971,
        "toPort": 32132
      }]
    }
  }
}
```

### LB Controller 로그

```json
{
  "level": "info",
  "ts": "2026-01-22T06:48:32Z",
  "logger": "controllers.ingress",
  "msg": "successfully built model",
  "model": {
    "networking": {
      "ingress": [
        {"from": [{"securityGroup": {"groupID": "sg-xxx (ALB SG)"}}], "ports": [{"port": 31971}]},
        {"from": [{"securityGroup": {"groupID": "sg-xxx (ALB SG)"}}], "ports": [{"port": 32132}]}
      ]
    }
  }
}
```

## 복구 조치

### 1. Node SG에 인바운드 규칙 수동 추가

```bash
# ALB SG → Node SG (NodePort 전체 범위)
aws ec2 authorize-security-group-ingress \
  --group-id <NODE_SG_ID> \
  --protocol tcp --port 30000-32767 \
  --source-group <ALB_SG_ID>
```

### 2. LB Controller 자동 관리 비활성화

```bash
kubectl annotate ingress <INGRESS_NAME> -n <NAMESPACE> \
  "alb.ingress.kubernetes.io/manage-backend-security-group-rules=false" --overwrite
```

### 3. Git 레포에 어노테이션 영구 반영

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  annotations:
    alb.ingress.kubernetes.io/target-type: instance
    # LB Controller가 Node SG 규칙을 자동 관리하지 않도록 설정
    alb.ingress.kubernetes.io/manage-backend-security-group-rules: "false"
```

## 재발 방지 대책

### 즉시 조치 (완료)
- [x] Node SG에 ALB SG 인바운드 규칙 추가 (30000-32767 전체 범위)
- [x] `manage-backend-security-group-rules=false` 어노테이션 추가
- [x] Git 레포에 어노테이션 영구 반영

### 장기 대책
- [ ] `target-type: ip` 전환 검토 (LB Controller가 SG 규칙 자동 관리 안함)
- [ ] 모니터링 알림 추가 (ALB 타겟 그룹 unhealthy 감지)
- [ ] LB Controller 버전 업데이트 시 변경사항 검토

## 교훈

1. **AWS LB Controller의 자동 SG 관리는 예측 불가능할 수 있음**
   - `target-type: instance` 사용 시 LB Controller가 Node SG 규칙을 자동 관리
   - reconcile 과정에서 기존 규칙이 삭제될 수 있음

2. **`manage-backend-security-group-rules=false` 어노테이션 권장**
   - LB Controller가 SG 규칙을 건드리지 않도록 명시적 설정
   - 수동으로 SG 규칙을 관리하는 것이 더 안정적

3. **`target-type: ip` 사용 시 이 문제 없음**
   - Pod IP로 직접 연결하므로 NodePort 불필요
   - 새 클러스터에서는 `target-type: ip` 사용 권장

## 참고 자료

- [AWS Load Balancer Controller - Security Group](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/deploy/security_group/)
- [ALB Ingress Annotations](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/ingress/annotations/)
