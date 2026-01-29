# LinkedIn 포스트용

https://b100to.github.io/posts/eks-spot-karpenter-pv-az-mismatch/

---

개발 환경에서 갑자기 파드들이 Pending 되길래 확인해보니, Spot 인스턴스가 특정 AZ에서 안 뜨면서 노드가 한 AZ에만 몰렸고, 기존 EBS(PV)가 다른 AZ에 묶여있어서 마운트가 안 되는 상황이었다.

EBS는 AZ에 물리적으로 묶여있다는 걸 이론으로만 알았는데, 실제로 이게 파드 스케줄링에 영향을 주는 걸 처음 경험했다. Karpenter 이벤트는 너무 일반적이라 디버깅이 쉽지 않았고, kubectl describe pod의 Events가 더 정확한 정보를 줬다.

---

Had an interesting debugging session where pods were stuck in Pending state. Turned out Spot instances weren't available in one AZ, so Karpenter created all nodes in a different AZ. But existing EBS volumes (PVs) were bound to the original AZ - and EBS can't be mounted cross-AZ.

Lesson learned: when using Spot instances, AZ availability can vary. If you're running single-AZ, make sure NodePool, StorageClass, and topologySpreadConstraints are all aligned.

#Kubernetes #EKS #Karpenter #Spot #DevOps #Troubleshooting #AWS
