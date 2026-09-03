import CoreMLTranscriptionSupport

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

let placeholder = [TranscriptWordTiming(text: "...", start: 2, end: 2.4)]
check(
    expandWordTimingsToAudio(placeholder, audioSamples: []) == placeholder,
    "an unaligned filler placeholder remains unchanged"
)

let ordered = normalizeWordTimingOrder([
    TranscriptWordTiming(text: "September", start: 16.1, end: 17.45),
    TranscriptWordTiming(text: "first", start: 17.35, end: 17.72),
])
check(ordered[0].end == ordered[1].start, "neighbouring windows share one safe boundary")
check(ordered[1].end > ordered[1].start, "normalization preserves the following word")

let pathWords = [
    TranscriptWordTiming(text: "from", start: 15.60, end: 15.92),
    TranscriptWordTiming(text: "September", start: 16.16, end: 17.04),
    TranscriptWordTiming(text: "first", start: 17.04, end: 17.12),
    TranscriptWordTiming(text: "till", start: 17.84, end: 18.16),
]
let pathCandidates = [
    [AcousticWordCandidate(start: 16.00, end: 16.24, score: -7.2)],
    [
        AcousticWordCandidate(start: 16.037, end: 16.436, score: -7.76),
        AcousticWordCandidate(start: 16.755, end: 17.154, score: -7.31),
    ],
    [
        AcousticWordCandidate(start: 16.755, end: 16.835, score: -7.54),
        AcousticWordCandidate(start: 17.394, end: 17.473, score: -8.06),
    ],
    [AcousticWordCandidate(start: 17.85, end: 18.09, score: -7.1)],
]
let selectedPath = selectOrderedAcousticTimings(
    pathWords,
    candidatesByWord: pathCandidates,
    expectedShift: 0.32
)
check(selectedPath[1].start == 16.755, "ordered path chooses the later September occurrence")
check(selectedPath[2].start == 17.394, "ordered path keeps first after September")
let conservativePath = replaceCollapsedWordTimings(pathWords, with: selectedPath)
check(conservativePath[1] == pathWords[1], "long September timing keeps decoder context")
check(conservativePath[2] == selectedPath[2], "collapsed first timing uses acoustic evidence")

var snapAudio = Array(repeating: Float(0), count: 16_000 * 2)
for sample in Int(0.7 * 16_000)..<Int(0.98 * 16_000) {
    snapAudio[sample] = sample.isMultiple(of: 2) ? 0.2 : -0.2
}
let snapped = snapSilentTimingsToAudio(
    [TranscriptWordTiming(text: "Um", start: 0.34, end: 0.57)],
    audioSamples: snapAudio
)
check(snapped[0].start >= 0.69 && snapped[0].start <= 0.71, "silent CTC peak snaps to nearby speech")
check(snapped[0].end >= 0.95 && snapped[0].end <= 0.99, "snapped word covers the audible run")

let finalOrder = normalizeWordTimingOrder([
    TranscriptWordTiming(text: "one", start: 1, end: 1.005),
    TranscriptWordTiming(text: "two", start: 1.0025, end: 1.2),
])
check(finalOrder[0].end <= finalOrder[1].start, "minimum duration never reintroduces overlap")

print("ALL ACOUSTIC ALIGNMENT TESTS PASSED")
