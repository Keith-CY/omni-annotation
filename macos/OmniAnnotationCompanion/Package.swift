// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "OmniAnnotationCompanion",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "OmniAnnotationCompanion", targets: ["OmniAnnotationCompanion"]),
        .library(name: "OmniAnnotationCore", targets: ["OmniAnnotationCore"])
    ],
    targets: [
        .target(name: "OmniAnnotationCore"),
        .executableTarget(
            name: "OmniAnnotationCompanion",
            dependencies: ["OmniAnnotationCore"]
        ),
        .testTarget(
            name: "OmniAnnotationCoreTests",
            dependencies: ["OmniAnnotationCore"]
        )
    ]
)
