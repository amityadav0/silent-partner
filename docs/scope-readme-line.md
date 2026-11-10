# Scope README: the line naming Silent Partner

For the two-project rule: if Scope is submitted as the second entry, its README names Silent Partner. Nothing here has been applied to the Scope repo. The patch was checked against Scope's current README on `master` (2026-11-10), and it applies cleanly.

**The line** (goes right under the tagline):

> Same author, separate project: [Silent Partner](https://github.com/amityadav0/silent-partner), private copy-trading vaults on NEAR Confidential Intents. It reuses a few of Scope's files (the 1Click client and receipt hashing), credited in its README.

**Apply it as a pull request** (about 10 seconds):

```sh
gh repo clone amityadav0/scope /tmp/scope-line && cd /tmp/scope-line && git checkout -b silent-partner-line \
  && curl -sL https://raw.githubusercontent.com/amityadav0/silent-partner/master/docs/scope-readme-line.patch | git apply \
  && git commit -qam "README: name Silent Partner (same author, separate project)" \
  && git push -qu origin HEAD && gh pr create --fill
```

Or commit straight to `master` by leaving out the branch and the `gh pr create` step.

Scope is private, so judges can't open it until it's made public: `gh repo edit amityadav0/scope --visibility public --accept-visibility-change-consequences` (NEEDS-AMIT §9).

**The patch** (`docs/scope-readme-line.patch`):

```diff
--- a/README.md
+++ b/README.md
@@ -2,6 +2,8 @@
 
 **scope.limited** · NEAR Hackathon "Build Beyond Boundaries" 2026 · built on IronClaw, NEAR Chain Signatures and NEAR Intents
 
+Same author, separate project: [Silent Partner](https://github.com/amityadav0/silent-partner), private copy-trading vaults on NEAR Confidential Intents. It reuses a few of Scope's files (the 1Click client and receipt hashing), credited in its README.
+
 Everyone is building agents that can spend. Nobody is building the thing that lets a normal person say yes to that. Scope is the yes.
 
 ## What it does (30 seconds)
```
