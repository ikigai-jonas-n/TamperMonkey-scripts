<details>
<summary>🤝 For contributors</summary>

**Once after cloning:**
```bash
cp hooks-pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

**Release:** edit the `.user.js` file, then run `git acp "describe your change"`. It bumps `@version`, fixes the update URLs, regenerates this README, commits and pushes. Users get the update on their next update check.

**New script:** add `<name>.user.js` (with a `// ==UserScript==` header) and optionally `<name>-README.md` to the repo root, then `git acp`. Keep every file at the root: the repo mirrors to a gist, and gists reject folders.

</details>
