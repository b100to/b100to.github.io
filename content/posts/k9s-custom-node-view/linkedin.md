# LinkedIn 포스트용

https://b100to.github.io/posts/k9s-custom-node-view/

---

Kubernetes 터미널 UI인 K9s를 통해서 주로 k8s 모니터링을 합니다.

저만 불편하다고 느낀진 모르겠지만 EKS 기준으로 Node 이름을 보면 IP주소로 되어 있어서 이게 어떤 노드인지 파악이 잘 안 되더라구요. 주로 taint로 분리해놓은 경우가 많아서요.

그래서 찾아보니까 k9s views.yaml에서 라벨을 커스텀 컬럼으로 뽑을 수 있었습니다. Karpenter NodePool에 붙여둔 라벨을 TYPE 컬럼으로 맨 앞에 빼니까 base, batch, airflow 같은 용도가 바로 보여서 훨씬 편해졌어요.

자세한 설정은 블로그에 정리해뒀습니다.

---

I mainly use K9s for Kubernetes monitoring. One thing that always bugged me was EKS node names — they're just IP-based private DNS, so you can't tell which node is for what purpose.

Turns out k9s views.yaml lets you extract labels into custom columns. By pulling the Karpenter NodePool label into a TYPE column up front, I can instantly see base, batch, airflow — much easier to work with.

Wrote up the details on my blog.

#Kubernetes #k9s #Karpenter #EKS #DevOps #CloudNative
