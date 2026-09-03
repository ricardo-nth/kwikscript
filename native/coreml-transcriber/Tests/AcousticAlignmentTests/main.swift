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
let lateCollapsedSource = [
    TranscriptWordTiming(text: "the", start: 26.40, end: 26.48),
    TranscriptWordTiming(text: "Go", start: 26.48, end: 26.64),
]
let lateCollapsedAligned = [
    TranscriptWordTiming(text: "the", start: 26.81, end: 26.89),
    lateCollapsedSource[1],
]
check(
    replaceCollapsedWordTimings(lateCollapsedSource, with: lateCollapsedAligned)[0]
        == lateCollapsedSource[0],
    "a collapsed word cannot jump beyond the following word"
)

let pauseBoundaryWords = [
    TranscriptWordTiming(text: "gym", start: 28.48, end: 28.88),
    TranscriptWordTiming(text: "because", start: 29.04, end: 29.28),
]
let pauseBoundaryCandidates = [
    [AcousticWordCandidate(start: 28.005, end: 29.282, score: -5.89, activity: 0.0296)],
    [
        AcousticWordCandidate(start: 28.883, end: 28.963, score: -6.73, activity: 0.0021),
        AcousticWordCandidate(start: 29.362, end: 29.601, score: -9.50, activity: 0.0317),
    ],
]
let pauseBoundaryPath = selectOrderedAcousticTimings(
    pauseBoundaryWords,
    candidatesByWord: pauseBoundaryCandidates,
    expectedShift: 0.108
)
check(
    pauseBoundaryPath[1].start == 29.362,
    "a bad long candidate before a real pause must not drag the next word into silence"
)

var shiftedPhraseAudio = Array(repeating: Float(0.001), count: 16_000 * 3)
for sample in Int(1.39 * 16_000)..<Int(2.4 * 16_000) {
    shiftedPhraseAudio[sample] = sample.isMultiple(of: 2) ? 0.12 : -0.12
}
let shiftedPhraseSource = [
    TranscriptWordTiming(text: "because", start: 1.04, end: 1.28),
    TranscriptWordTiming(text: "of", start: 1.28, end: 1.44),
]
let shiftedPhraseAligned = [
    TranscriptWordTiming(text: "because", start: 1.39, end: 1.63),
    TranscriptWordTiming(text: "of", start: 1.63, end: 1.79),
]
let correctedPhrase = replaceMisplacedTimingChunks(
    shiftedPhraseSource,
    with: shiftedPhraseAligned,
    audioSamples: shiftedPhraseAudio
)
check(correctedPhrase == shiftedPhraseAligned, "a phrase whose decoder onset is silent uses CTC timing")

var reliablePhraseAudio = shiftedPhraseAudio
for sample in Int(1.04 * 16_000)..<Int(1.28 * 16_000) {
    reliablePhraseAudio[sample] = sample.isMultiple(of: 2) ? 0.12 : -0.12
}
let preservedPhrase = replaceMisplacedTimingChunks(
    shiftedPhraseSource,
    with: shiftedPhraseAligned,
    audioSamples: reliablePhraseAudio
)
check(preservedPhrase == shiftedPhraseSource, "an already-audible decoder phrase remains authoritative")

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
let protectedNeighbour = snapSilentTimingsToAudio(
    [
        TranscriptWordTiming(text: "I've", start: 0.34, end: 0.57),
        TranscriptWordTiming(text: "got", start: 0.72, end: 1.0),
    ],
    audioSamples: snapAudio
)
check(
    protectedNeighbour[0].start == 0.34 && protectedNeighbour[1].start == 0.72,
    "a silent timing cannot snap onto the following word and squeeze it away"
)

var gapAudio = Array(repeating: Float(0.001), count: 16_000 * 2)
for sample in Int(0.2 * 16_000)..<Int(0.72 * 16_000) {
    gapAudio[sample] = sample.isMultiple(of: 2) ? 0.12 : -0.12
}
for sample in Int(1.39 * 16_000)..<Int(1.8 * 16_000) {
    gapAudio[sample] = sample.isMultiple(of: 2) ? 0.12 : -0.12
}
let tightenedGap = tightenTranscriptGapsToAudio(
    [
        TranscriptWordTiming(text: "gym", start: 0.2, end: 0.88),
        TranscriptWordTiming(text: "because", start: 1.04, end: 1.8),
    ],
    audioSamples: gapAudio
)
check(
    tightenedGap[0].end >= 0.71 && tightenedGap[0].end <= 0.73,
    "waveform evidence trims a quiet tail from the word before a transcript pause"
)
check(
    tightenedGap[1].start == 1.04,
    "waveform-only refinement never guesses a new onset for the following word"
)

let finalOrder = normalizeWordTimingOrder([
    TranscriptWordTiming(text: "one", start: 1, end: 1.005),
    TranscriptWordTiming(text: "two", start: 1.0025, end: 1.2),
])
check(finalOrder[0].end <= finalOrder[1].start, "minimum duration never reintroduces overlap")

print("ALL ACOUSTIC ALIGNMENT TESTS PASSED")
