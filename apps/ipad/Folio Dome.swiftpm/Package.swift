// swift-tools-version: 5.9

// Folio Dome for iPad, as an app package: it opens in Xcode on a Mac and in Swift Playgrounds
// on an iPad. Resources/web is made by `npm run build:ipad` (apps/ipad/build.mjs).

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "Folio Dome",
    platforms: [
        .iOS("17.0")
    ],
    products: [
        .iOSApplication(
            name: "Folio Dome",
            targets: ["AppModule"],
            bundleIdentifier: "com.bradnagle.foliodome",
            teamIdentifier: "",
            displayVersion: "0.9.3",
            bundleVersion: "1",
            appIcon: .asset("AppIcon"),
            accentColor: .presetColor(.blue),
            supportedDeviceFamilies: [
                .pad
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown
            ],
            appCategory: .productivity
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: ".",
            exclude: ["README.md"],
            resources: [
                .copy("Resources/web")
            ]
        )
    ]
)
