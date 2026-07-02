// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "GrooveCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "GrooveCore", targets: ["GrooveCore"]),
    ],
    targets: [
        .target(name: "GrooveCore"),
        .testTarget(name: "GrooveCoreTests", dependencies: ["GrooveCore"]),
    ]
)
