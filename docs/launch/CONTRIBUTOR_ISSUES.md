# First contributor issues

These issue specifications are designed to turn launch feedback into bounded,
reviewable contributions rather than vague “help wanted” requests.

## 1. Public outcome gallery

Create a compact proof gallery for current, contradictory, retracted and
never-stated memory outcomes.

Acceptance criteria:

- capture all four signed-out public flows from the current deployment;
- store redacted product screenshots under `docs/assets/outcomes/`;
- add `docs/OUTCOME_GALLERY.md` with the exact question, expected outcome,
  evidence state and accessible alt text for each screenshot;
- link the gallery immediately below the README failure-case table;
- do not expose browser chrome, credentials, private workspace data or internal URLs.

## 2. Offline discovery validation

Add a repository-local command that catches broken growth and discovery assets
without making network requests.

Acceptance criteria:

- add `npm run audit:discovery`;
- verify introduced local Markdown links resolve;
- parse the SoftwareApplication JSON-LD from `web/index.html`;
- confirm `robots.txt` declares the canonical sitemap;
- confirm sitemap `<loc>` values are unique HTTPS URLs on the production host;
- validate the launch tracker header and row width;
- include a regression test that fails on a missing local link;
- add no runtime dependency unless the standard library cannot express the check.
