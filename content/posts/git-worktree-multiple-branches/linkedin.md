# LinkedIn 포스트용

https://b100to.github.io/posts/git-worktree-multiple-branches/

TL;DR: git worktree로 같은 레포에서 여러 브랜치를 동시에 체크아웃할 수 있습니다.

---

Claude Code를 터미널에서 쓰다가 한국어 2바이트 문자 처리 문제로 VSCode 익스텐션으로 넘어왔는데, 그러다 에이전트가 한 브랜치 점령 중일 때 다른 브랜치에서 작업해야 하는 상황이 생겼습니다. `git worktree`로 해결됐어요.

같은 레포를 여러 디렉토리에 동시에 체크아웃할 수 있어서 브랜치 전환 없이 병렬 작업이 가능합니다. Claude Code의 worktree 격리 기능도 이 git primitive를 쓰는 거였더라고요.

혹시 Claude Code 터미널에서 한국어 입력 시 커서 깨지는 문제 해결 방법 아시는 분 계신가요? 아직 미해결 상태입니다 🙏

---

https://b100to.github.io/posts/git-worktree-multiple-branches/

TL;DR: `git worktree` lets you check out multiple branches from the same repo simultaneously in separate directories.

I switched from Claude Code terminal to the VSCode extension because of a Korean 2-byte character rendering issue — cursor misalignment and character overlap when typing Korean. That's when I ran into the "agent is on a branch, I need a different one" problem. `git worktree` solved it.

Check out the same repo in multiple directories simultaneously — no branch switching, no stashing, no disk waste (shared `.git` objects). Claude Code's worktree isolation feature uses this same primitive under the hood.

Does anyone know how to fix the Korean input / 2-byte character rendering issue in Claude Code terminal? Still unsolved on my end 🙏

#Git #DevOps #DeveloperProductivity #TIL
