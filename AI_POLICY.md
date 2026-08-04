# AI usage policy

Applies to pull requests against Oscarr and to plugins submitted to the
[registry](https://github.com/arediss/Oscarr-Plugin-Registry).

## The short version

**Using AI to write code for Oscarr is fine.** Most of Oscarr is maintained by one person in
their spare time; anything that helps you ship a good change is welcome.

What is not fine is opening a PR you cannot explain, have not run, and will not maintain. That
is true whether the code came from an AI, a tutorial, or a Stack Overflow answer. AI just makes
it much easier to produce a lot of it very quickly.

## Three requirements

Every PR, AI-assisted or not, has to clear the same bar.

**1. You understand it.** You can explain what each part does and why it is there. If a reviewer
asks "why this and not that?", *"I'm not sure, the AI wrote it"* is not an answer — it is a
request to close the PR. You do not need to justify every character, but you do need to own the
design.

**2. You ran it.** Not "it typechecks" — you started Oscarr, exercised the path you changed, and
watched it work. For a plugin, you installed it on a real instance with the services it talks to
actually configured. Code that has only ever been read is untested code.

**3. You will maintain it.** A merged feature is not finished, it is adopted. If it breaks in six
months you are the person who knows how it works. Do not contribute something you are not willing
to come back to.

## Use a capable model

If you use AI, use a current frontier model, and give it access to the code it is modifying.

This is a practical requirement, not snobbery. Oscarr has conventions no model knows from its
training data: the `PluginContext` capability double-gate, the `ALL_PROVIDERS` registry, the
core/plugin split, `translateBackendError` tokens, the `ndp-*` design tokens. A weak model — or a
capable one guessing without the repo in front of it — will produce something that looks exactly
right and calls an API that does not exist. That code compiles surprisingly often and fails in
production.

Two failure modes worth naming, because we see both:

- **Invented APIs.** `ctx.getRadarrConfig()`, `ctx.notificationRegistry`, a `media.card.overlay`
  hook — plausible, documented somewhere, not real here. Check the call against
  [`plugins.md`](./plugins.md) and the actual source before trusting it.
- **Confident wrong facts.** An LLM will happily tell you which query parameter Radarr uses to
  add an import-list exclusion. Radarr and Sonarr spell it differently, and both silently ignore
  a parameter they do not recognise. Verify against the running service, not from memory.

## Disclosure

If AI wrote a substantial part of the change, say so in the PR description. One line is enough:

> Most of this was written with Claude; I reworked the pagination and tested against my own
> Plex + Radarr setup.

No forms, no tiers, no percentages. Autocomplete does not count. This is not a confession — it
tells the reviewer where to look harder, which is useful information, not a mark against you.

Not disclosing is only a problem when it turns out to matter: a PR that is clearly machine-written,
was presented as hand-written, and falls apart under questions. That wastes everyone's time and
is grounds for closing the PR and declining future ones.

## What review can and cannot do

Review here is one maintainer reading a diff. It catches design problems, convention drift, and
obvious bugs. It does **not** verify that your code works — nobody is going to reproduce your
setup, configure your services, and exercise your feature for you.

So the burden of proof sits with you. Tell us what you tested and how. A PR that says *"tested
with 2 Radarr instances, one behind a reverse proxy, deleted 3 movies and checked the files were
gone"* gets merged faster than one twice as clean with no evidence behind it, because the second
one is asking the maintainer to take it on faith.

Nobody is running detectors on your diff. There is no AI-detection step and there will not be
one — they do not work, and the goal was never to catch anyone. The goal is that the code in
Oscarr has someone behind it who understands it.

## Anything that deletes, moves or overwrites user data

Higher bar, no exceptions: you tested the destructive path yourself, against real services, and
you can describe what happens when it half-fails. Media files, backups, user accounts and
database migrations all count. An AI will write you a confident `deleteFiles=true` without
mentioning that the id it is passing only means something on the instance that issued it.

## Assets and translations

**Icons and images:** disclose AI-generated assets. A rough hand-made icon is preferred over a
generated one — it reads as someone's work, which is the point.

**Translations:** French and English are both first-class in Oscarr. Machine translation is fine
as a starting point, but it flattens tone and misses UI context. Have a speaker check it before
it ships, and never machine-translate the error tokens themselves — only their `errors.*` values.

## If you are not sure

Open an issue and ask before writing the code. That has always been the advice in
[CONTRIBUTING.md](./CONTRIBUTING.md), and it matters more, not less, when generating a first
draft takes thirty seconds.
