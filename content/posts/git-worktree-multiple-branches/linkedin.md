# LinkedIn 포스트용

https://b100to.github.io/posts/git-worktree-multiple-branches/

**TL;DR**: git worktree로 같은 레포에서 여러 브랜치를 동시에 체크아웃할 수 있습니다.

---

AI 에이전트가 한 브랜치에서 작업 중인데 다른 브랜치에서도 동시에 작업하고 싶다면? `git worktree`를 쓰면 됩니다.

같은 레포를 여러 디렉토리에 동시에 체크아웃할 수 있어서, 브랜치 전환 없이 병렬 작업이 가능합니다. `.git` 오브젝트는 공유하니 디스크도 아낄 수 있어요.

사실 Claude Code의 worktree 격리 기능도 이 git worktree를 쓰는 거였더라고요. 알고 나면 간단한데 몰라서 못 쓰고 있었던 기능입니다.

---

https://b100to.github.io/posts/git-worktree-multiple-branches/

**TL;DR**: `git worktree` lets you check out multiple branches from the same repo simultaneously in separate directories.

When an AI agent is working on one branch and you need to work on another simultaneously? `git worktree` is the answer.

It lets you check out the same repo in multiple directories at once — no branch switching needed, and no disk waste since they share the `.git` objects.

Turns out Claude Code's worktree isolation feature uses this same git primitive under the hood. Simple concept, surprisingly underused.

#Git #DevOps #DeveloperProductivity #TIL
