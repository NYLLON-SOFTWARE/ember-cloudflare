// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "EmberDesktop",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "EmberDesktop",
            path: "Sources/EmberDesktop",
            resources: [.copy("Resources/ember-logo.png")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "EmberDesktopTests",
            dependencies: ["EmberDesktop"],
            path: "Tests/EmberDesktopTests",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
