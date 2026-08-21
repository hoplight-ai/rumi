# Security

This repo belongs to the `hoplight-ai` GitHub org. It is not a public bug-bounty target — there is
no reward program and no dedicated security inbox separate from the owner.

## Reporting a vulnerability

Email **whit@hoplight.ai** directly with what you found and how to reproduce it. Do not open a
public GitHub issue for a security finding — file it privately first so there's time to fix it
before it's visible.

## Where secrets live

Never in this repository, in an issue, or in a commit message. Every credential this org uses —
Supabase keys, Vercel tokens, API keys — is documented by name and location in
`~/code/_agent-rules/secrets.md`. Read that file rather than assuming a key's shape or scope; it
also names which keys are safe for a local session to hold and which belong only in Vercel/GitHub
environment variables.

If you believe a secret has leaked (committed, pasted somewhere, or exposed in a log), say so
immediately rather than rotating it quietly — rotation without a record of what leaked and how
means the next person can't tell whether the exposure is actually closed.
