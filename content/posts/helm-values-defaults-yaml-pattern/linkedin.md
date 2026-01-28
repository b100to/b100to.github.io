Claude Code로 Helm chart 작업하다가 알게 된 간단한 팁 하나 공유하고자 합니다.

kafka-ui values에 startupProbe를 넣었는데 적용이 안 되길래 확인해보니, 이 chart는 probes.liveness.initialDelaySeconds 형식이더라고요.

chart마다 values 구조가 다른데 Claude가 최신 스펙을 모르니까 이런 일이 생기는 것 같습니다.

그래서 helm show values 결과를 _defaults.yaml로 저장해두고 참고하게 했더니 꽤 편했습니다. 혹시 비슷한 상황이라면 한 번 써보셔도 좋을 것 같아요.


----


A quick tip I picked up while working on Helm charts with Claude Code.

I added startupProbe to kafka-ui values, but it didn't apply. Turns out this chart uses probes.liveness.initialDelaySeconds format instead.

Since AI doesn't know the latest chart specs, I started saving helm show values output as _defaults.yaml for reference. Works pretty well if you're in a similar situation.


#DevOps #Kubernetes #Helm #Claude #GitOps


https://b100to.github.io/posts/helm-values-defaults-yaml-pattern
