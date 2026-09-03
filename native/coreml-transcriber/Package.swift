// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "RescriptCoreMLTranscriber",
    platforms: [
        .macOS(.v14),
    ],
    dependencies: [
        .package(
            url: "https://github.com/FluidInference/FluidAudio.git",
            exact: "0.15.6"
        ),
    ],
    targets: [
        .target(
            name: "CoreMLTranscriptionSupport"
        ),
        .executableTarget(
            name: "rescript-coreml-transcriber",
            dependencies: [
                "CoreMLTranscriptionSupport",
                .product(name: "FluidAudio", package: "FluidAudio"),
            ]
        ),
        .executableTarget(
            name: "acoustic-alignment-test",
            dependencies: ["CoreMLTranscriptionSupport"],
            path: "Tests/AcousticAlignmentTests"
        ),
    ]
)
