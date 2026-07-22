# Security Policy

## Supported versions

Security fixes land on the latest released version of `purr-code` on npm. Pre-1.0 releases may receive fixes only on the newest tag.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately via [GitHub Security Advisories](https://github.com/MathoAvito/purr-code/security/advisories/new) for this repository.

We aim to **acknowledge** reports within **7 days**.

## Disclosure

- Do **not** publish a proof-of-concept or exploit details publicly until a fix has shipped (or we have agreed a coordinated disclosure timeline).
- We will credit reporters who want attribution in the advisory notes, unless you prefer to remain anonymous.

## Scope notes

PurrCode runs locally as Claude Code hooks + a per-user daemon. High-priority classes include: hook-path visibility failures (transcript noise / fail-open breaks), control-pipe abuse, path traversal from untrusted hook stdin, and supply-chain issues in release artifacts. Runtime code must never make network requests.
