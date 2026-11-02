# Thesis images

The Business section has an Images & key updates area for each analyst's thesis.
Use Add images (multiple files), drop files into the upload area, or paste image
clipboard contents with Ctrl+V / Command+V while viewing your own thesis. Add a
title, category, caption and optional HTTPS source link, then choose Save images.
Click a saved image to expand it; Escape closes the viewer. Only the thesis owner
with write access can edit or remove an image. Other analysts can view images with
the associated thesis. Unsaved drafts warn before navigating away.

PNG, JPEG and WebP inputs up to 20 MB are resized in the browser to at most 2400
pixels on their longest side. Stored image data is capped at 1,400,000 characters
(about 1 MB binary), with at most 100 images per thesis. Metadata lists exclude
image data; authenticated image responses load lazily and are never publicly cached.
Images live in Postgres rather than the ephemeral deployment filesystem. Migration
0036 creates the additive table and runs in the guarded production build migration
step; no new credentials or external storage account are required.

Local verification from web/:

```powershell
npm.cmd run check
npx.cmd --no-install vitest run src/lib/thesisImages.test.ts
npx.cmd --no-install playwright test --config=playwright.documents.config.ts thesis-images.spec.ts
```

Browser tests use the isolated thesis_documents_test database on port 45432 and
start a dedicated app at port 5187. They exercise the real upload API/database and
browser image resizing, using generated images and synthetic clipboard/drop
payloads. They do not call an AI provider. The file chooser test opens the actual
browser chooser. No production data or credentials are used.
