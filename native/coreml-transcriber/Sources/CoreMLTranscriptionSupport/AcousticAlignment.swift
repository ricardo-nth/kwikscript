import Foundation

public struct TranscriptWordTiming: Equatable, Sendable {
    public let text: String
    public let start: TimeInterval
    public let end: TimeInterval

    public init(text: String, start: TimeInterval, end: TimeInterval) {
        self.text = text
        self.start = start
        self.end = end
    }
}

public struct AcousticWordCandidate: Equatable, Sendable {
    public let start: TimeInterval
    public let end: TimeInterval
    public let score: Float
    public let activity: Float

    public init(start: TimeInterval, end: TimeInterval, score: Float, activity: Float = 0) {
        self.start = start
        self.end = end
        self.score = score
        self.activity = activity
    }
}

/// Pick one CTC word-spotting result per transcript word as a single ordered
/// path. Transition cost preserves Parakeet's reliable word order and relative
/// cadence; the acoustic score and distance choose the actual occurrence.
public func selectOrderedAcousticTimings(
    _ words: [TranscriptWordTiming],
    candidatesByWord: [[AcousticWordCandidate]],
    maxCenterShift: TimeInterval = 0.9,
    expectedShift: TimeInterval? = nil,
    splitGap: TimeInterval = 0.18
) -> [TranscriptWordTiming] {
    guard !words.isEmpty else { return [] }
    var output: [TranscriptWordTiming] = []
    var start = 0
    for index in 1...words.count {
        let isBoundary = index == words.count || words[index].start - words[index - 1].end >= splitGap
        guard isBoundary else { continue }
        output.append(contentsOf: selectOrderedAcousticTimingChunk(
            Array(words[start..<index]),
            candidatesByWord: (start..<index).map {
                $0 < candidatesByWord.count ? candidatesByWord[$0] : []
            },
            maxCenterShift: maxCenterShift,
            expectedShift: expectedShift
        ))
        start = index
    }
    return output
}

private func selectOrderedAcousticTimingChunk(
    _ words: [TranscriptWordTiming],
    candidatesByWord: [[AcousticWordCandidate]],
    maxCenterShift: TimeInterval,
    expectedShift: TimeInterval?
) -> [TranscriptWordTiming] {
    struct Option {
        let timing: TranscriptWordTiming
        let localCost: Double
    }
    let maximumActivityByWord = candidatesByWord.map { candidates in
        candidates.map(\.activity).max() ?? 0
    }
    let options: [[Option]] = words.enumerated().map { index, word in
        let center = (word.start + word.end) / 2
        var out = (index < candidatesByWord.count ? candidatesByWord[index] : [])
            .filter {
                $0.end > $0.start && $0.score >= -20 &&
                    abs(($0.start + $0.end) / 2 - center) <= maxCenterShift
            }
            .map { candidate in
                let candidateCenter = (candidate.start + candidate.end) / 2
                let shift = candidateCenter - center
                let distance = abs(shift)
                let scorePenalty = max(0, Double(-candidate.score) - 5) * 0.035
                let shiftPenalty = expectedShift.map { abs(shift - $0) * 0.9 } ?? 0
                let maximumActivity = index < maximumActivityByWord.count
                    ? maximumActivityByWord[index]
                    : 0
                let activityPenalty = maximumActivity > 0 && candidate.activity > 0
                    ? max(0, log(Double(maximumActivity / candidate.activity))) * 0.2
                    : 0
                return Option(
                    timing: TranscriptWordTiming(
                        text: word.text,
                        start: candidate.start,
                        end: candidate.end
                    ),
                    localCost: distance * 0.8 + scorePenalty + shiftPenalty + activityPenalty
                )
            }
        out.append(Option(timing: word, localCost: 1.15))
        return out
    }

    var costs = options[0].map(\.localCost)
    var backPointers: [[Int]] = [Array(repeating: -1, count: options[0].count)]
    if words.count > 1 {
        for index in 1..<words.count {
            var nextCosts = Array(repeating: Double.infinity, count: options[index].count)
            var previous = Array(repeating: -1, count: options[index].count)
            let rawPreviousCenter = (words[index - 1].start + words[index - 1].end) / 2
            let rawCenter = (words[index].start + words[index].end) / 2
            let rawDelta = max(0.01, rawCenter - rawPreviousCenter)
            for currentIndex in options[index].indices {
                let current = options[index][currentIndex]
                let currentCenter = (current.timing.start + current.timing.end) / 2
                for previousIndex in options[index - 1].indices {
                    let prior = options[index - 1][previousIndex]
                    let priorCenter = (prior.timing.start + prior.timing.end) / 2
                    guard currentCenter > priorCenter + 0.002 else { continue }
                    let cadencePenalty = abs((currentCenter - priorCenter) - rawDelta) * 2.5
                    let cost = costs[previousIndex] + current.localCost + cadencePenalty
                    if cost < nextCosts[currentIndex] {
                        nextCosts[currentIndex] = cost
                        previous[currentIndex] = previousIndex
                    }
                }
            }
            costs = nextCosts
            backPointers.append(previous)
        }
    }

    guard var optionIndex = costs.indices.min(by: { costs[$0] < costs[$1] }),
          costs[optionIndex].isFinite
    else { return words }
    var output = words
    for index in stride(from: words.count - 1, through: 0, by: -1) {
        output[index] = options[index][optionIndex].timing
        if index > 0 {
            optionIndex = backPointers[index][optionIndex]
            if optionIndex < 0 { return words }
        }
    }
    return output
}

/// Estimate the decoder-to-acoustic delay from longer words with relatively
/// unambiguous CTC detections. The median makes repeated words and occasional
/// false spots harmless while supplying the ordered path with a useful anchor.
public func estimateDominantAcousticShift(
    _ words: [TranscriptWordTiming],
    candidatesByWord: [[AcousticWordCandidate]],
    maxCenterShift: TimeInterval = 0.9
) -> TimeInterval? {
    var shifts: [TimeInterval] = []
    for index in words.indices where words[index].text.filter(\.isLetter).count >= 5 {
        let center = (words[index].start + words[index].end) / 2
        let candidates = index < candidatesByWord.count ? candidatesByWord[index] : []
        let eligible = candidates.filter {
            $0.end > $0.start && $0.score >= -12 &&
                abs(($0.start + $0.end) / 2 - center) <= maxCenterShift
        }
        guard let best = eligible.max(by: {
            let leftQuality = Double($0.score) + log(Double(max($0.activity, 0.000001)))
            let rightQuality = Double($1.score) + log(Double(max($1.activity, 0.000001)))
            return leftQuality < rightQuality
        }) else { continue }
        shifts.append((best.start + best.end) / 2 - center)
    }
    guard shifts.count >= 3 else { return nil }
    shifts.sort()
    let middle = shifts.count / 2
    let median = shifts.count.isMultiple(of: 2)
        ? (shifts[middle - 1] + shifts[middle]) / 2
        : shifts[middle]
    return min(0.65, max(-0.4, median))
}

/// Replace only decoder spans that collapsed to roughly one 80 ms encoder
/// frame. Longer words retain the safer TDT context and are refined against
/// waveform energy later.
public func replaceCollapsedWordTimings(
    _ source: [TranscriptWordTiming],
    with aligned: [TranscriptWordTiming],
    maximumDuration: TimeInterval = 0.12
) -> [TranscriptWordTiming] {
    source.indices.map { index in
        guard index < aligned.count else { return source[index] }
        return source[index].end - source[index].start <= maximumDuration
            ? aligned[index]
            : source[index]
    }
}

/// Move a timing that lands entirely in near-silence onto the closest audible
/// run. Keyword spotting sometimes identifies the correct ordered word but its
/// narrow CTC peak precedes a soft onset. A strict distance and ordering gate
/// keeps this correction local and prevents one word from jumping across a
/// genuine pause or onto a neighbouring sentence.
public func snapSilentTimingsToAudio(
    _ words: [TranscriptWordTiming],
    audioSamples: [Float],
    sampleRate: Int = 16_000,
    hopSeconds: TimeInterval = 0.005,
    maxShift: TimeInterval = 0.7
) -> [TranscriptWordTiming] {
    guard !words.isEmpty, !audioSamples.isEmpty, sampleRate > 0 else { return words }
    let envelope = audioEnvelope(
        audioSamples: audioSamples,
        sampleRate: sampleRate,
        hopSeconds: hopSeconds
    )
    guard !envelope.isEmpty else { return words }

    let floor = percentile(envelope, fraction: 0.1)
    let speechLevel = percentile(envelope, fraction: 0.8)
    let threshold = max(0.0001, floor * 2.5, floor + 0.04 * (speechLevel - floor))
    let maximumGapFrames = max(1, Int((0.015 / hopSeconds).rounded()))
    let minimumRunFrames = max(1, Int((0.02 / hopSeconds).rounded()))
    var runs: [(start: Int, end: Int)] = []
    var frame = 0
    while frame < envelope.count {
        guard envelope[frame] >= threshold else {
            frame += 1
            continue
        }
        let start = frame
        var lastActive = frame
        frame += 1
        while frame < envelope.count {
            if envelope[frame] >= threshold {
                lastActive = frame
            } else if frame - lastActive > maximumGapFrames {
                break
            }
            frame += 1
        }
        if lastActive - start + 1 >= minimumRunFrames {
            runs.append((start: start, end: lastActive + 1))
        }
    }
    guard !runs.isEmpty else { return words }

    func clampedFrame(_ time: TimeInterval) -> Int {
        min(envelope.count - 1, max(0, Int((time / hopSeconds).rounded())))
    }
    var output = words
    for index in words.indices {
        let from = clampedFrame(words[index].start)
        let to = clampedFrame(words[index].end)
        let peak = envelope[min(from, to)...max(from, to)].max() ?? 0
        guard peak < threshold else { continue }

        let center = (words[index].start + words[index].end) / 2
        let lowerCenter = index > 0
            ? (output[index - 1].start + output[index - 1].end) / 2
            : 0
        let upperCenter = index + 1 < words.count
            ? (words[index + 1].start + words[index + 1].end) / 2
            : .infinity
        let originalDuration = max(hopSeconds, words[index].end - words[index].start)
        let candidate = runs
            .map { run -> (start: TimeInterval, end: TimeInterval, center: TimeInterval, distance: TimeInterval) in
                let audibleStart = Double(run.start) * hopSeconds
                let audibleEnd = Double(run.end) * hopSeconds
                let maximumSpan = originalDuration + 0.03
                let proposedStart: TimeInterval
                let proposedEnd: TimeInterval
                if audibleEnd - audibleStart <= maximumSpan {
                    proposedStart = audibleStart
                    proposedEnd = audibleEnd
                } else if center <= audibleStart {
                    proposedStart = audibleStart
                    proposedEnd = audibleStart + maximumSpan
                } else if center >= audibleEnd {
                    proposedStart = audibleEnd - maximumSpan
                    proposedEnd = audibleEnd
                } else {
                    proposedStart = max(audibleStart, center - maximumSpan / 2)
                    proposedEnd = min(audibleEnd, proposedStart + maximumSpan)
                }
                let proposedCenter = (proposedStart + proposedEnd) / 2
                return (proposedStart, proposedEnd, proposedCenter, abs(proposedCenter - center))
            }
            .filter { item in
                item.distance <= maxShift && item.center > lowerCenter && item.start < upperCenter
            }
            .min { $0.distance < $1.distance }
        guard let candidate else { continue }
        let runStart = candidate.start
        let runEnd = candidate.end
        if runEnd > runStart {
            if index > 0, output[index - 1].end > runStart {
                let boundary = (output[index - 1].end + runStart) / 2
                output[index - 1] = TranscriptWordTiming(
                    text: output[index - 1].text,
                    start: output[index - 1].start,
                    end: boundary
                )
            }
            output[index] = TranscriptWordTiming(
                text: words[index].text,
                start: runStart,
                end: runEnd
            )
            if index + 1 < output.count, output[index + 1].start < runEnd {
                output[index + 1] = TranscriptWordTiming(
                    text: output[index + 1].text,
                    start: runEnd,
                    end: max(output[index + 1].end, runEnd + hopSeconds)
                )
            }
        }
    }
    return output
}

/// Grow peaky CTC spans through contiguous audible energy without crossing the
/// neighbouring decoded span. This recovers full words instead of cutting only
/// the frame where a CTC token peaked, while preserving real pauses.
public func expandWordTimingsToAudio(
    _ words: [TranscriptWordTiming],
    audioSamples: [Float],
    sampleRate: Int = 16_000,
    hopSeconds: TimeInterval = 0.005,
    maxGrowth: TimeInterval = 0.35
) -> [TranscriptWordTiming] {
    guard !words.isEmpty, !audioSamples.isEmpty, sampleRate > 0 else { return words }
    let levels = audioEnvelope(
        audioSamples: audioSamples,
        sampleRate: sampleRate,
        hopSeconds: hopSeconds
    )
    let frameCount = levels.count
    guard frameCount > 0 else { return words }
    let floor = percentile(levels, fraction: 0.1)
    let lastFrame = frameCount - 1
    func clampedFrame(_ time: TimeInterval) -> Int {
        min(lastFrame, max(0, Int((time / hopSeconds).rounded())))
    }

    let thresholds = words.map { word -> Float in
        let from = clampedFrame(word.start)
        let to = clampedFrame(word.end)
        var loud: Float = 0
        if from <= to {
            for frame in from...to { loud = max(loud, levels[frame]) }
        }
        return max(floor * 2.5, floor + 0.08 * (loud - floor))
    }
    let decodedStarts = words.map(\.start)
    let decodedEnds = words.map(\.end)
    var starts = decodedStarts
    var ends = decodedEnds

    for index in words.indices {
        var frame = clampedFrame(words[index].start)
        let startLimit = clampedFrame(
            max(index > 0 ? decodedEnds[index - 1] : 0, words[index].start - maxGrowth)
        )
        while frame > startLimit, levels[frame - 1] >= thresholds[index] { frame -= 1 }
        starts[index] = Double(frame) * hopSeconds

        frame = clampedFrame(words[index].end)
        let nextStart = index + 1 < words.count ? decodedStarts[index + 1] : .infinity
        let endLimit = clampedFrame(min(nextStart, words[index].end + maxGrowth))
        while frame < endLimit, levels[frame] >= thresholds[index] { frame += 1 }
        ends[index] = Double(frame) * hopSeconds
    }

    if words.count > 1 {
        for index in 0..<(words.count - 1) where ends[index] > starts[index + 1] {
            let middle = (ends[index] + starts[index + 1]) / 2
            ends[index] = middle
            starts[index + 1] = middle
        }
    }
    return words.indices.map { index in
        return TranscriptWordTiming(
            text: words[index].text,
            start: starts[index],
            end: max(ends[index], starts[index] + hopSeconds)
        )
    }
}

private func audioEnvelope(
    audioSamples: [Float],
    sampleRate: Int,
    hopSeconds: TimeInterval
) -> [Float] {
    guard !audioSamples.isEmpty, sampleRate > 0, hopSeconds > 0 else { return [] }
    let hopSamples = max(1, Int((hopSeconds * Double(sampleRate)).rounded()))
    let frameCount = Int(ceil(Double(audioSamples.count) / Double(hopSamples)))
    var levels = Array(repeating: Float(0), count: frameCount)
    for frame in 0..<frameCount {
        let from = frame * hopSamples
        let to = min(audioSamples.count, from + hopSamples)
        var sum: Float = 0
        for sample in audioSamples[from..<to] { sum += sample * sample }
        levels[frame] = sqrt(sum / Float(max(1, to - from)))
    }
    return levels
}

/// Resolve the small overlaps produced when neighbouring words are aligned in
/// separate context windows. The midpoint retains both acoustic estimates and
/// guarantees a safe, ordered transcript for cutting and pause detection.
public func normalizeWordTimingOrder(
    _ words: [TranscriptWordTiming],
    minimumDuration: TimeInterval = 0.005
) -> [TranscriptWordTiming] {
    guard !words.isEmpty else { return [] }
    var starts = words.map(\.start)
    var ends = words.map(\.end)
    if words.count > 1 {
        for index in 0..<(words.count - 1) {
            if ends[index] > starts[index + 1] {
                let middle = max(starts[index], min(ends[index + 1], (ends[index] + starts[index + 1]) / 2))
                ends[index] = middle
                starts[index + 1] = middle
            }
        }
    }
    return words.indices.map { index in
        let requestedEnd = max(ends[index], starts[index] + minimumDuration)
        let safeEnd = index + 1 < words.count
            ? min(requestedEnd, starts[index + 1])
            : requestedEnd
        return TranscriptWordTiming(
            text: words[index].text,
            start: starts[index],
            end: max(starts[index], safeEnd)
        )
    }
}

private func percentile(_ values: [Float], fraction: Double) -> Float {
    guard !values.isEmpty else { return 0 }
    let sorted = values.sorted()
    let index = min(sorted.count - 1, max(0, Int(Double(sorted.count) * fraction)))
    return sorted[index]
}
