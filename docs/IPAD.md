# Folio Dome on iPad

The iPad app runs the same interface and the same document code as the Mac app. It opens the
library you use on the Mac from the Files app (iCloud Drive or Dropbox), so both apps work on the
same files.

- Requires iPadOS 17 or later (the app's deployment target).
- Source: `apps/ipad` (see [ARCHITECTURE.md](ARCHITECTURE.md)).

## Installing

Apple lets anyone install their own apps on their own iPad. With a free Apple Account, an app
installed this way stops opening 7 days after it was signed and has to be signed again; up to 3
such apps can be on a device. A paid Apple Developer Program membership (99 USD a year) makes an
installation last a year. (Apple: [Choosing a membership](https://developer.apple.com/support/compare-memberships/),
[What's included](https://developer.apple.com/programs/whats-included/).)

There are three ways to install. Each build of the app is the same; they differ in how it is signed.

### A. Sideloadly on the Mac (free Apple Account, re-signed automatically)

Sideloadly signs the app file (`Folio-Dome-<version>.ipa`) with your Apple Account, installs it,
and can sign it again before the 7 days run out, while the Mac is on and the iPad is on the same
Wi-Fi. Sideloadly is a third-party tool; its menus may differ from what is written here.

1. On the iPad: **Settings › Privacy & Security › Developer Mode** → on, restart, and confirm.
   (iPadOS 16 and later need this for apps signed this way. If the switch is not there, it appears
   after the first install attempt in step 5.)
2. On the Mac: download Sideloadly from [sideloadly.io](https://sideloadly.io/) and open it.
3. Connect the iPad to the Mac with a cable. On the iPad, tap **Trust** and enter the passcode.
   In Finder, select the iPad in the sidebar and turn on **Show this iPad when on Wi-Fi** (so later
   re-signing works without the cable).
4. In Sideloadly: drag `Folio-Dome-<version>.ipa` onto the window, choose the iPad, and enter your
   Apple Account email. Turn on the automatic refresh option next to **Start**.
5. Click **Start** and enter your Apple Account password when asked. Sideloadly uses it to get a
   signing certificate from Apple.
6. On the iPad: **Settings › General › VPN & Device Management** → tap your Apple Account under
   Developer App → **Trust**.
7. Open Folio Dome from the Home Screen.

Leave Sideloadly running (it starts at login once auto-refresh is on). If a refresh fails (the
app then says it is no longer available), connect the cable and click **Start** again; your
settings and library are kept.

Sources for these steps (third-party, not Sideloadly's own documentation):
[hamradio.my](https://hamradio.my/sideloadly-the-ultimate-ios-sideloading-tool-without-jailbreak/),
[Macwelt](https://www.macwelt.de/article/2138620/sideloading-iphone.html),
[Digital Citizen](https://www.digitalcitizen.life/how-to-sideload-apps-on-iphone/).

### B. Xcode on the Mac (free or paid account)

1. Install Xcode from the Mac App Store, and Node.js 22.
2. In a clone of the repository: `npm install`, then `npm run build:ipad`.
3. Open `apps/ipad/Folio Dome.swiftpm` in Xcode.
4. Xcode › Settings › Accounts: add your Apple Account. In the project's **Signing & Capabilities**,
   choose your team (a free account shows as "Personal Team").
5. Connect the iPad, choose it as the run destination, and press ⌘R.
6. On the iPad, trust the developer (step 6 of A) and turn on Developer Mode if asked.

With a free account, repeat step 5 every 7 days. Xcode's package format cannot set two options
the Sideloadly build has: the app's own Documents folder does not appear in the Files app, and
AI servers on your local network may be blocked. To get those, generate the Xcode project with
[XcodeGen](https://github.com/yonaskolb/XcodeGen) (`cd apps/ipad/xcode && xcodegen generate`) and
open `FolioDome.xcodeproj` instead.

### C. Swift Playgrounds on the iPad (untested)

Swift Playgrounds builds and runs app packages on an iPad without a Mac. Copy
`Folio-Dome-<version>-swiftpm.zip` to the iPad, unzip it in the Files app, open
`Folio Dome.swiftpm` in Swift Playgrounds, and tap Run. It has not been tested whether Swift
Playgrounds accepts this package (its web folder has about 2,000 files), whether apps run this way
stop after 7 days, or whether they keep their data between runs.

## First launch: open your library

On the welcome screen, choose **Choose…** and pick the library folder in the Files picker: in
**iCloud Drive**, or in **Dropbox** (the Dropbox app must be installed and turned on under
Locations in the Files app). The app keeps access to the folder between launches.

**Create** instead makes a new library in the app's own folder (On My iPad › Folio Dome in the
Files app, with the Sideloadly build).

Files in iCloud Drive that are not on the iPad yet are downloaded when the app opens them, so the
first opening can take a moment. Changes made on the Mac reach the open document once iCloud
Drive or Dropbox has synced them; unsaved edits on the iPad are kept, and the other version is put
in History, as on the Mac.

AI service keys are stored in the iPad's Keychain: enter them once in Settings › AI. The page the
interface runs in never holds a key. Requests carry a stand-in that the app replaces with the key
as the request leaves the iPad.

## Differences from the Mac app

- **No Finder tags**: the Tags menu and the coloured dots are not shown. Tags already set on the
  Mac are kept when a file is saved on the iPad.
- **PDF export**: WebKit on iPad prints without accessibility tags, so the PDF does not claim
  PDF/UA, and screen readers get untagged text. Page size, layout, fonts, headers, footers and
  inserted PDF pages are as on the Mac.
- **Saving exports**: the Mac asks for a name and a folder; the iPad asks for a folder and uses
  the suggested name (and asks before replacing a file of that name).
- **Menus**: right-click with a trackpad or mouse, or touch and hold a library item, tab or
  button, for its menu. In the editor, touch and hold text, then choose **More…** in the edit
  menu for spelling, the thesaurus, Insert and Ask AI. The iPadOS menu bar (iPadOS 26) has the
  app's commands; the keyboard shortcuts work with a hardware keyboard.
- **Emoji**: use the keyboard's emoji key; the Mac's emoji panel does not exist on iPad.
- **Spelling** uses the iPad's dictionary; **Learn Spelling** adds to it.
- **Show in Files** opens the Files app at the item's folder.
- **Move to Trash** moves items to Recently Deleted in the Files app. If a storage provider does
  not support that, the app says so and leaves the item in place.
- One window: a second window shows a note instead of a second copy of the app.

## How the iPad build is checked

- `node apps/ipad/e2e/web.mjs` (after `npm run build:ipad`) runs the iPad interface and backend in
  Chromium with a stand-in for the Swift shell: library, editing, saving, shortcuts, menus,
  touch and hold, key stand-ins, streamed AI replies, outside changes, preview, PDF.
- `.github/workflows/ipad.yml` compiles the Swift shell on GitHub's Mac runners, runs the same
  self test in the iOS Simulator (library, export to PDF with page count and size, history,
  search, spelling, Keychain, HTTP, preview in the interface), and makes the unsigned `.ipa`.
- Not tested by either: a real iPad, iCloud Drive and Dropbox folders, the document pickers,
  touch input on hardware, Swift Playgrounds.
