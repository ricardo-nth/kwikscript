import CoreML
import FluidAudio
import Foundation

private struct RescriptWord: Codable {
    let id: Int
    let text: String
    let start: TimeInterval
    let end: TimeInterval
    let speaker: Int
    let deleted: Bool
}

private struct TranscriptionOutput: Codable {
    let words: [RescriptWord]
    let text: String
    let audioDuration: TimeInterval
    let processingTime: TimeInterval
    let realtimeFactor: Float
    let model: String
}

private enum CommandError: LocalizedError {
    case missingAudioPath
    case audioFileNotFound(String)

    var errorDescription: String? {
        switch self {
        case .missingAudioPath:
            return "Usage: rescript-coreml-transcriber <audio-file> [output-json]"
        case .audioFileNotFound(let path):
            return "Audio file does not exist: \(path)"
        }
    }
}

@main
private struct RescriptCoreMLTranscriber {
    static func main() async {
        do {
            let output = try await transcribe()
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let json = try encoder.encode(output)
            if CommandLine.arguments.count == 3 {
                let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
                try json.write(to: outputURL, options: [.atomic])
            } else {
                FileHandle.standardOutput.write(json)
                FileHandle.standardOutput.write(Data("\n".utf8))
            }
        } catch {
            let message = "rescript-coreml-transcriber: \(error.localizedDescription)\n"
            FileHandle.standardError.write(Data(message.utf8))
            Foundation.exit(EXIT_FAILURE)
        }
    }

    private static func transcribe() async throws -> TranscriptionOutput {
        guard CommandLine.arguments.count == 2 || CommandLine.arguments.count == 3 else {
            throw CommandError.missingAudioPath
        }

        let path = CommandLine.arguments[1]
        guard FileManager.default.fileExists(atPath: path) else {
            throw CommandError.audioFileNotFound(path)
        }

        let audioURL = URL(fileURLWithPath: path)
        let version = AsrModelVersion.v3
        let modelName = "parakeet-tdt-0.6b-v3-coreml-int8"

        let configuration = MLModelConfiguration()
        configuration.computeUnits = .cpuAndNeuralEngine

        reportProgress(stage: "loading-model", fraction: 0)
        let models = try await AsrModels.downloadAndLoad(
            configuration: configuration,
            version: version,
            encoderPrecision: .int8,
            encoderComputeUnits: .cpuAndNeuralEngine,
            progressHandler: { progress in
                reportProgress(stage: "loading-model", fraction: progress.fractionCompleted)
            }
        )

        let asrConfig = ASRConfig(
            tdtConfig: TdtConfig(blankId: version.blankId),
            encoderHiddenSize: version.encoderHiddenSize,
            parallelChunkConcurrency: 1,
            streamingEnabled: true,
            melChunkContext: false,
            dualDecodeArbitration: false
        )
        let manager = AsrManager(config: asrConfig)
        try await manager.loadModels(models)

        reportProgress(stage: "transcribing", fraction: 0)
        var decoderState = TdtDecoderState.make(decoderLayers: version.decoderLayers)
        let result = try await manager.transcribe(
            audioURL,
            decoderState: &decoderState,
            language: .english
        )
        reportProgress(stage: "transcribing", fraction: 1)
        let timings = buildWordTimings(from: result.tokenTimings ?? [])

        reportProgress(stage: "loading-vad", fraction: 0)
        let vad = try await VadManager(
            config: VadConfig(defaultThreshold: 0.35),
            progressHandler: { progress in
                reportProgress(stage: "loading-vad", fraction: progress.fractionCompleted)
            }
        )
        reportProgress(stage: "detecting-speech", fraction: 0)
        let vadResults = try await vad.process(audioURL)
        reportProgress(stage: "detecting-speech", fraction: 1)
        let words = wordsWithDisfluencies(
            timings: timings,
            vadResults: vadResults,
            duration: result.duration
        )

        return TranscriptionOutput(
            words: words,
            text: result.text,
            audioDuration: result.duration,
            processingTime: result.processingTime,
            realtimeFactor: result.rtfx,
            model: modelName
        )
    }

    /// Recover filled pauses that Parakeet heard but intentionally omitted.
    /// The audio remains untouched until ReScript cuts the inserted `...` word.
    private static func wordsWithDisfluencies(
        timings: [WordTiming],
        vadResults: [VadResult],
        duration: TimeInterval
    ) -> [RescriptWord] {
        let frameSeconds = Double(VadManager.chunkSize) / Double(VadManager.sampleRate)
        var baseWords: [RescriptWord] = []
        baseWords.reserveCapacity(timings.count)
        for timing in timings {
            baseWords.append(RescriptWord(
                id: 0,
                text: timing.word,
                start: timing.startTime,
                end: timing.endTime,
                speaker: 0,
                deleted: false
            ))
        }
        baseWords.sort { left, right in
            left.start == right.start ? left.end < right.end : left.start < right.start
        }

        var covered = Array(repeating: false, count: vadResults.count)
        for word in baseWords {
            let first = max(0, Int(floor(word.start / frameSeconds)))
            let last = min(vadResults.count, Int(ceil(word.end / frameSeconds)))
            if first < last {
                for index in first..<last { covered[index] = true }
            }
        }

        var placeholders: [RescriptWord] = []
        var index = 0
        while index < vadResults.count {
            if !vadResults[index].isVoiceActive || covered[index] {
                index += 1
                continue
            }
            var endIndex = index + 1
            while endIndex < vadResults.count,
                  vadResults[endIndex].isVoiceActive,
                  !covered[endIndex] {
                endIndex += 1
            }

            var start = Double(index) * frameSeconds
            var end = min(duration, Double(endIndex) * frameSeconds)
            var previousEnd: TimeInterval?
            for word in baseWords where word.end <= start + frameSeconds {
                previousEnd = max(previousEnd ?? 0, word.end)
            }
            let nextStart = baseWords.first(where: { $0.start >= start - frameSeconds })?.start
            // A missing token at either physical edge may be a clipped real word,
            // not a filler. Only middle-of-sentence speech is safe to expose as `...`.
            guard let previousEnd, let nextStart else {
                index = endIndex
                continue
            }
            if start - previousEnd <= frameSeconds + 0.0001 {
                start = min(end, start + 0.12)
            }
            end = min(end, nextStart)

            if end - start >= 0.3 - 0.0001, start < duration - 0.0001 {
                placeholders.append(
                    RescriptWord(
                        id: 0,
                        text: "...",
                        start: start,
                        end: end,
                        speaker: 0,
                        deleted: false
                    )
                )
            }
            index = endIndex
        }

        return (baseWords + placeholders)
            .sorted { left, right in
                left.start == right.start ? left.end < right.end : left.start < right.start
            }
            .enumerated()
            .map { index, word in
                RescriptWord(
                    id: index,
                    text: word.text,
                    start: word.start,
                    end: word.end,
                    speaker: word.speaker,
                    deleted: word.deleted
                )
            }
    }

    private static func reportProgress(stage: String, fraction: Double) {
        let clamped = min(max(fraction, 0), 1)
        let message = "RESCRIPT_PROGRESS {\"stage\":\"\(stage)\",\"fraction\":\(clamped)}\n"
        FileHandle.standardError.write(Data(message.utf8))
    }
}
