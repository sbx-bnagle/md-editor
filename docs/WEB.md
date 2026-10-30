# Folio Dome on tablets and phones (web app)

The web app is Folio Dome in a browser, laid out for tablets and phones (and usable in a desktop
browser). The library lives in **your Dropbox or your Google Drive**, so the Mac app and the web
app work on the same files: the Mac reaches them through the Dropbox app or Google Drive for
desktop, and the web app through the service's web API. The web app replaces the iPad app (removed
in 0.10.0).

It is a folder of static files (`apps/web/dist`) that you put on a web server with HTTPS. There is
no Folio Dome server: the page talks to Dropbox or Google directly, with your own sign-in.

## 1. Build

```sh
npm install
npm run build:web          # → apps/web/dist
npm run serve:web          # optional: try it at http://localhost:8080 (sign-in works on localhost)
```

Private themes (`resources/private/Themes`, with licensed fonts and client details) are **left out**
of web builds, because anyone with the app's address can download its files. Add them with
`FOLIO_PRIVATE_THEMES=1 npm run build:web` only for a host that is not public.

## 2. Host it

Any static host with HTTPS works (a server of your own, Netlify, Cloudflare Pages, GitHub Pages…).
Upload the contents of `apps/web/dist`. The address must be HTTPS (or `localhost`), because the
app uses a service worker to show the library's images and fonts, and the sign-in services only
return to secure addresses.

Two addresses matter below: the app's address (for example `https://folio.example.com/`) and its
sign-in return page, the same address with `oauth.html` (`https://folio.example.com/oauth.html`).

## 3. Connect a storage service

You register the app with Dropbox or Google once. Put the key or ID in `config.json` (in the
uploaded folder) so you need not type it on each device:

```json
{ "dropboxAppKey": "…", "googleClientId": "…" }
```

### Dropbox

1. Go to the Dropbox App Console (dropbox.com/developers/apps) and create an app.
2. Access: **App folder** keeps the app to `Dropbox/Apps/<app name>`; put the library there and open
   that folder in the Mac app (Open Another Library…). **Full Dropbox** lets you choose any folder,
   such as the library the Mac app already uses.
3. Permissions: `files.metadata.read`, `files.content.read`, `files.content.write`.
4. Redirect URIs: add the sign-in return page (`https://…/oauth.html`, and
   `http://localhost:8080/oauth.html` to try it locally).
5. Copy the **App key** (the app secret is not used).

Sign-in uses the PKCE flow: the page goes to Dropbox and back, and keeps a refresh token in the
browser, so you stay signed in.

### Google Drive

1. In Google Cloud Console, create a project and enable the **Google Drive API**.
2. OAuth consent screen: add the scopes `…/auth/drive` and `…/auth/drive.appdata`, and add your
   Google account as a test user.
3. Credentials: create an **OAuth client ID** of type *Web application*. Authorized JavaScript
   origins: the app's address (and `http://localhost:8080`). Authorized redirect URIs: the sign-in
   return page (`https://…/oauth.html`, `http://localhost:8080/oauth.html`).
4. Copy the **Client ID**.

Limits that come from Google (not checked against Google's documentation from this project's
build environment, which could not reach it):

- The full `drive` permission is needed so the app sees files the Mac adds through Google Drive for
  desktop. Google calls it a restricted permission: an app that has not been through Google's review
  can only be used by its test users, and their sign-in lasts at most a week.
- The sign-in token lasts an hour. When it runs out, the bottom bar shows **Sign in to Google
  Drive**; changes are kept on the device until you do.

## 4. Use

On first opening, choose Dropbox or Google Drive, sign in, then open the folder that holds the
library (or make a new one; a new library is set up in it, with the examples and themes). Switch
later from the menu (☰) › **Storage…**.

- **Phones and tablets held upright**: the library is a drawer (the library button at the top
  left); the Assistant, Insights and History panels open over the editor. On a phone they are in
  the menu (☰).
- **Tablets held sideways and desktop browsers**: the same layout as the Mac app.
- **Menus**: the Mac app's menu bar is the ☰ button. Touch and hold a library item or tab for its
  menu; on touch screens, **⋯** opens the editor's menu (insert, thesaurus, components) at the
  cursor.
- **Saving**: typing is saved in the browser at once and sent to the service a moment later. The
  bottom bar shows *Saved to Dropbox*, *Saving…*, *Offline: N changes kept on this device*, or
  *Sign in*. Changes made on the Mac are fetched every 30 seconds and when the page comes back into
  view. A file changed in both places is not overwritten: this device's version is saved beside it
  as a conflicted copy, and a notice says so.
- **AI**: keys are kept with your storage account (Dropbox: `/.folio-dome/ai-keys.json` at the top
  of the app's Dropbox space; Google Drive: the app's hidden data folder), so you enter a key once
  for all your devices. The page reads the key to call the AI service, so it is as safe as your
  storage account and this browser. Claude accepts requests from a browser; many OpenAI-compatible
  services do not, and local servers (Ollama, LM Studio) only work from a browser on the same
  computer.
- **PDF**: Export PDF lays the document out and opens the browser's print dialog; choose Save as PDF
  (on iPhone and iPad: Print › Share › Save to Files). These PDFs are the browser's: they are not
  tagged for screen readers (no PDF/UA), and PDFs arranged before or after the document are not
  included. Use the Mac app for accessible PDFs.
- **Exports** (web page, ZIP, theme packages) are downloads. **Add a file…** and similar commands
  ask you to choose files; files dropped on the library are copied in (folders cannot be dropped).
- **Spelling** is the browser's own; Finder tags and Show in Finder are not available (Show in
  Dropbox / Google Drive opens the item on the service's website).

## Not in the web app

Tagged (PDF/UA) PDFs, Finder tags, the system emoji picker, dragging items out to other apps, and
working with a library that is only on the Mac's disk.
