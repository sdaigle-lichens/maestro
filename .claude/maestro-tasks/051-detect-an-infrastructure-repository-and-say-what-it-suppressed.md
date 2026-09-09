# Detect an infrastructure repository, and say what it suppressed

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Teach repo detection to recognise an infrastructure-as-code repository and seed the new agent for it.

Detection today classifies a repository into backend, frontend and mobile by matching npm dependency names and language-manifest filenames across a deliberately bounded set of directories — the root plus declared workspace members plus a few conventional globs. Two properties are load-bearing and must survive: it stands alone (no model, no network, no shelling out, work proportional to the number of packages rather than the number of files), and it returns its reasons, so the canvas can explain the choice rather than ask the user to trust it.

**Add the category.** Infrastructure signals: a directory named for infrastructure (`terraform`, `infrastructure`, `iac`, `infra`), root-level Terraform files, and the manifests that unambiguously identify the other tools in this space — Pulumi, CDK, Serverless, Helm charts, Ansible. Directory-name signals cost nothing here: the existing filename matching already runs against raw directory-entry names without distinguishing files from directories.

**Reach the files that are one level down.** An infrastructure repository usually keeps its definitions in a subdirectory rather than at the root, and that subdirectory is not a workspace member, so today it is never opened. Widen the conventional directory globs enough to reach it, staying inside the existing cap on how many directories are inspected.

**Precedence: infrastructure wins outright.** When infrastructure signals are present, they suppress every application category. An IaC repository's Python or JavaScript is nearly always its own tooling rather than the product, and a chain that leads with an application agent is wrong about what the repository is for. This is the one place in detection where a category is exclusive rather than additive, so it needs to be obvious in the code and stated in the evidence: the returned reasons should name the infrastructure markers that matched *and* say that other signals were set aside, because a user looking at a Python repository that detected as infrastructure needs to see that the Python was noticed and overruled, not missed. The canvas already offers chips to correct the chain, so an overrule the user disagrees with is one click from fixed.

At the end of this slice the target repository detects as infrastructure with legible evidence, but still seeds the existing application workflow set with the new agent slotted in as its implementation step. That is a coherent intermediate state, not a broken one.

## Acceptance criteria

- [ ] A repository whose only signal is an infrastructure directory or manifest detects as the infra chain, not as the fallback
- [ ] A repository carrying both an application language manifest and infrastructure signals detects as infra alone, with every application category suppressed
- [ ] The returned evidence names the infrastructure markers that matched and makes the suppression visible, rather than silently omitting the application signals
- [ ] Terraform definitions held one level down in a conventional infrastructure subdirectory are reached, without exceeding the existing cap on inspected directories
- [ ] Detection still performs no model call, no network call and no subprocess, and still reads a bounded directory set
- [ ] Every existing detection assertion for backend, frontend, mobile, fullstack and the fallback passes unchanged
- [ ] Opening the target infrastructure repository in the desktop app shows the detected chain with evidence naming its infrastructure directory

## Blocked by

- `050-add-infra-as-an-eighth-bundled-agent.md`
