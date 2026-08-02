# ExtendedArt Web hosting setup

## Recommendation

Use OpenAI Sites for the first hosted experiment if it is available on the Pro
account. The built-in Site URL is the shortest path because OpenAI manages the
hosting.

Use Cloudflare Pages as the independent fallback when we want our own hosting
account, Git deployment control, and preview environments. Keep GitHub Pages
as a simple demo or documentation mirror.

The browser-local ExtendedArt workflow needs only static files. It does not
need a database, file storage, server image processing, or an API key.

## What the options mean

### Cloudflare Pages

Cloudflare Pages is static website hosting connected to GitHub. Every push to
the production branch can deploy automatically, and other branches can receive
preview URLs. It supports public and private GitHub repositories.

Why it fits ExtendedArt:

- The current app is plain HTML, CSS, and JavaScript.
- Visitor images can stay in the browser.
- Preview deployments are useful for checking new profile or PDF contracts.
- It provides independent deployment control if the product becomes commercial.

Current free-plan limits should be checked before launch. Cloudflare documents
500 builds per month, one build at a time, a 25 MiB per-file asset limit, and
20,000 files per site. The ExtendedArt site should remain well below these
limits because customer images and generated ZIPs are not committed as site
assets.

### GitHub Pages

GitHub Pages publishes static files from a GitHub repository. It is the
simplest option for a public demo and is convenient when the code already lives
on GitHub.

Tradeoffs:

- GitHub Free requires a public repository for Pages.
- It does not run Python or other server-side code.
- GitHub documents that Pages is not intended for a commercial online
  business or a site primarily facilitating commercial transactions or SaaS.
- It has fewer natural extension points for a future account system.

Use it for a demo or project documentation page, not as the long-term
commercial host.

### OpenAI Sites

ChatGPT Sites is managed hosting inside ChatGPT. Pro accounts are eligible for
the public beta when the feature has rolled out to the account. A Site can be
shared publicly, and the Sites settings can hold hosted environment variables
and secrets.

Important boundaries:

- Sites usage is included only up to plan-specific beta limits.
- The launch workflow needs no hosted secret, database, or object storage.
- If the hosted Site stores uploaded files in R2, the images are no longer
  purely local. Do not add R2 for the browser-local print workflow.

### Do I need to set up Cloudflare for OpenAI Sites?

No, not for the built-in OpenAI Site URL. You should not need a separate
Cloudflare account, Pages project, Cloudflare deployment, or Cloudflare DNS
configuration just to publish an OpenAI Site.

The official OpenAI documentation describes Sites as managed hosting, but it
does not promise that Sites is the same product as Cloudflare Pages. Treat the
underlying infrastructure as OpenAI-managed. If you later connect a custom
domain, you will need access to that domain's DNS provider, but that still does
not require a Cloudflare account.

OpenAI Sites is therefore the easiest first experiment. Cloudflare Pages is
the independent deployment path if we later want to own the hosting layer.

## Cloudflare Pages fallback setup

Use this after the browser output contract is stable if we want independent
hosting or if OpenAI Sites is unavailable.

### Before starting

1. Finish the local browser build and verify the Phase 3 PDF/ZIP tests.
2. Create a separate GitHub repository for this web project. Do not mix the
   browser project with the desktop installer repository unless there is a
   deliberate monorepo decision.
3. Push the ExtendedArt_Web project to the new repository.
4. Keep the repository free of customer images, output ZIPs, secrets, and
   private card assets.

### Create the Pages project

1. Sign in to Cloudflare.
2. Open Workers & Pages.
3. Choose Create application, then Pages, then Connect to Git.
4. Authorize the GitHub account and choose the new ExtendedArt web repository.
5. Select the main branch as the production branch.
6. Use the repository root as the project root.
7. Use `npm run build` as the build command.
8. Use `dist` as the output directory.
9. Choose Save and Deploy.
10. Open the generated pages.dev URL and test the full visitor flow.

### Configure previews

1. Keep automatic production deployment limited to main.
2. Enable preview deployments for feature branches and pull requests.
3. Test a preview URL before merging a profile or export change.
4. Promote only a tested main commit to production.

### Add a custom domain later

1. Open the Pages project settings.
2. Choose Custom domains.
3. Add the domain or subdomain.
4. Add the DNS record Cloudflare provides at the domain registrar.
5. Wait for certificate and DNS validation.
6. Test both the custom domain and the pages.dev rollback URL.

## GitHub Pages setup

Use this only for a public demo or documentation mirror.

1. Create a public GitHub repository if using GitHub Free.
2. Push the web source and package-lock.json.
3. Open the repository Settings, then Pages under Code and automation.
4. Select GitHub Actions as the source.
5. Use a Pages workflow that runs `npm ci`, `npm run test`, and `npm run build`.
6. Upload only the `dist` directory as the Pages artifact.
7. Wait for the first Actions deployment.
8. Open the generated username.github.io/repository URL.
9. Test drag/drop, workers, PDF/ZIP downloads, and relative asset paths.

## OpenAI Sites experiment

This can be tried without changing the local source architecture.

1. Open Work or Codex in ChatGPT.
2. Ask Sites to build or import the ExtendedArt browser project.
3. Request a private preview first.
4. Review the generated source and test image handling from a visitor
   perspective.
5. Save a version.
6. Deploy only after reviewing the saved version.
7. Change access to public only when the intended visitor flow is verified.
8. Do not add D1 or R2 for local-only alignment and export.

## Recommended rollout order

1. Local browser build.
2. Separate GitHub web repository.
3. OpenAI Sites private preview, if available.
4. Small invite-only pilot.
5. Public static release of browser-local printing.
6. Cloudflare Pages fallback or independent production deployment.
7. Evaluate accounts or fees only after the print workflow is stable and only
   through a separate approved plan.

Official references:

- OpenAI Sites: https://developers.openai.com/codex/sites
- GitHub Pages setup: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- Cloudflare Pages Git integration: https://developers.cloudflare.com/pages/get-started/git-integration/
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
