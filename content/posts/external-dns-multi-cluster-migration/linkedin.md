# LinkedIn 포스트용

https://b100to.github.io/posts/external-dns-multi-cluster-migration/

---

Kubernetes 클러스터를 v1에서 v2로 전환하면서 DNS 마이그레이션을 정리했습니다. Route53 가중치 라우팅이 요청 단위가 아니라 DNS 조회 단위 분배라 생각보다 정밀하지 않더라고요. 결국 External-DNS의 TXT 소유권 메커니즘과 --migrate-from-txt-owner 플래그를 활용한 방법이 가장 깔끔했습니다.

---

Wrote about DNS migration strategies when moving between Kubernetes clusters. Route53 weighted routing isn't as precise as expected since it distributes at DNS resolution level, not per-request. Ended up leveraging External-DNS's TXT ownership mechanism and the --migrate-from-txt-owner flag for zero-downtime migration.

#DevOps #Kubernetes #ExternalDNS #Route53 #AWS #DNS
