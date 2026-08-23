# Google and durable discovery

Social posts decay quickly. Search discovery compounds only when every public
surface uses the same clear problem language and points back to a canonical
proof page.

## Primary search intent

Use these phrases naturally, never as keyword stuffing:

- temporal memory for AI agents;
- provenance-first agent memory;
- AI memory that tracks corrections;
- MCP memory server;
- agent memory with citations and abstention;
- HydraDB agent memory;
- contradiction-aware retrieval.

## Canonical pages

| Intent | Canonical destination |
| --- | --- |
| Understand the product | `https://lacuna-five.vercel.app/` |
| Test it | `https://lacuna-five.vercel.app/explore` |
| Inspect code | `https://github.com/vaibhav4046/lacuna` |
| Connect an MCP client | `docs/CONNECT_CLIENTS.md` |
| Verify claims | `docs/EVIDENCE_INDEX.md` |
| Understand limitations | `docs/V10_RELEASE_STATUS.md` and `docs/BENCHMARK_LONGMEMEVAL.md` |

## Implemented in the repository

- canonical, Open Graph and Twitter metadata in `web/index.html`;
- SoftwareApplication JSON-LD in `web/index.html`;
- `web/public/robots.txt`;
- `web/public/sitemap.xml`;
- `web/public/llms.txt`;
- proof-first README and consistent wording.

## Owner actions outside code

1. Add the site to Google Search Console after domain verification.
2. Submit `https://lacuna-five.vercel.app/sitemap.xml`.
3. Upload `web/public/social.png` as the GitHub repository social preview.
4. Set the repository description, homepage and topics from
   `docs/launch/GITHUB_SETTINGS.md`.
5. Publish technical articles that link to a specific evidence document, not
   only the homepage.
6. Keep LinkedIn, X, GitHub and the site using the same project name and creator identity.

Do not create dozens of shallow keyword pages. One strong technical explanation
of corrections, contradictions or abstention is more useful than generic AI SEO.
