# LinkedIn 포스트용

https://b100to.github.io/posts/k9s-custom-node-view/

---

EKS에서 kubectl get nodes 치면 ip-10-0-xx-xx 같은 이름만 나와서 어떤 노드가 뭔지 알 수가 없는데요. k9s views.yaml에 라벨 기반 커스텀 컬럼을 추가하면 base, batch, airflow 같은 용도가 바로 보입니다. 설정 한 줄이면 되는 간단한 팁이에요.

---

When running kubectl get nodes on EKS, you only see IP-based hostnames - making it hard to tell which node serves what purpose. By adding a custom label column in k9s views.yaml, you can instantly see node roles like base, batch, or airflow. A one-line config change that makes a big difference.

#Kubernetes #k9s #Karpenter #EKS #DevOps #CloudNative
