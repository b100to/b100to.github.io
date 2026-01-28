# LinkedIn 포스트용

https://b100to.github.io/posts/1password-to-aws-vault/

---

1Password credential_process로 AWS 키 관리하다가 aws-vault로 전환했다.

이유는 간단한데, k9s 같은 도구 쓸 때 몇 분마다 권한 팝업이 떠서 작업 흐름이 끊겼다. 1Password CLI는 보안상 이 팝업을 끌 수가 없더라.

aws-vault 서브쉘 방식으로 바꾸니까 팝업 없이 쾌적하게 작업할 수 있었다. 계정 전환이 좀 번거롭긴 한데, 터미널 탭 분리로 해결.

---

Switched from 1Password credential_process to aws-vault for AWS credential management.

The reason was simple - tools like k9s triggered permission popups every few minutes, breaking my workflow. 1Password CLI doesn't allow disabling these popups by design.

With aws-vault's subshell approach, I can work without popups. Account switching is a bit cumbersome, but I solved it by using separate terminal tabs for each environment.

#AWS #DevOps #awsvault #1Password #EKS #k9s #Security
