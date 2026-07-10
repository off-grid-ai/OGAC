/** Preference order for the recorder container. webm/opus first (Chrome/Firefox), then plain
 *  webm/ogg, then mp4/mpeg (Safari). The empty string result is the universal "let the UA decide". */
declare const RECORDER_MIME_PREFERENCE: readonly string[];
/**
 * Choose a recorder MIME type given a support predicate (MediaRecorder.isTypeSupported). Pure:
 * the predicate is injected so this is testable without a browser. Returns '' when none of the
 * preferred types are supported — the caller then constructs MediaRecorder with no options and
 * lets the UA choose (still valid).
 */
declare function chooseRecorderMime(isSupported: (mime: string) => boolean): string;
/** Map a recorder MIME type to an upload filename with the right extension. The STT backend keys
 *  off the extension, so this must track the container we actually recorded. */
declare function audioFilename(mime: string): string;
interface AudioEnv {
    /** Dedicated on-prem STT service base URL. Empty/undefined → use the gateway. */
    sttUrl?: string;
    /** Dedicated on-prem TTS service base URL. Empty/undefined → use the gateway. */
    ttsUrl?: string;
    /** The on-prem gateway aggregator base. Its /v1/audio/* is the default target. */
    gatewayUrl?: string;
}
/** Which backend a modality resolves to. */
type AudioBackend = 'dedicated' | 'gateway' | 'none';
interface ModalityTarget {
    backend: AudioBackend;
    /** Absolute URL the client should POST to. '' when backend === 'none'. */
    url: string;
    /** Whether this modality is usable (dedicated or gateway present). */
    available: boolean;
    /** Host to SHOW the operator. Mapped by the app-supplied displayHost fn. '' when unavailable. */
    displayHost: string;
}
/**
 * Maps an internal base URL to the host string shown to the operator. The host app injects this so
 * it controls display policy (the console maps loopback/private IP → mDNS host so no raw IP leaks).
 * Defaults to identity when the app doesn't care.
 */
type DisplayHostFn = (url: string) => string;
/**
 * Resolve the STT target: a dedicated service if configured, else the gateway's
 * /v1/audio/transcriptions, else none. Pure.
 */
declare function resolveSttTarget(env: AudioEnv, displayHost?: DisplayHostFn): ModalityTarget;
/**
 * Resolve the TTS target: a dedicated service if configured, else the gateway's /v1/audio/speech,
 * else none. Pure. Server TTS being 'none' is NOT fatal — the host may offer a fully-local browser
 * speechSynthesis fallback (also air-gap-safe), decided by `speakBackend`.
 */
declare function resolveTtsTarget(env: AudioEnv, displayHost?: DisplayHostFn): ModalityTarget;
/** Honest config view handed to the client so it renders the right enabled/disabled + tooltip. */
interface AudioConfigView {
    stt: {
        available: boolean;
        backend: AudioBackend;
        displayHost: string;
    };
    /** TTS: serverAvailable=false still allows the browser fallback (browserFallback always true). */
    tts: {
        serverAvailable: boolean;
        backend: AudioBackend;
        displayHost: string;
        browserFallback: true;
    };
}
/** Build the client-facing config view from env. Pure. */
declare function audioConfigView(env: AudioEnv, displayHost?: DisplayHostFn): AudioConfigView;

/** Failure reasons shared by both modalities. */
type SpeechFailure = {
    ok: false;
    reason: 'not-configured' | 'unavailable';
};
type TranscribeResult = {
    ok: true;
    text: string;
} | SpeechFailure;
type SpeakResult = {
    ok: true;
    body: ReadableStream<Uint8Array>;
    contentType: string;
} | SpeechFailure;
/**
 * Injects auth headers for a resolved target. Return the headers to merge onto the request. The
 * `extra` (e.g. content-type) is passed so the app can merge in one place. Default: no auth.
 */
type AuthHeadersFn = (target: ModalityTarget, extra?: Record<string, string>) => Record<string, string>;
interface SpeechClientOptions {
    /** App-resolved on-prem URLs (dedicated STT/TTS + gateway). */
    env: AudioEnv;
    /** Auth-header injector (app owns credentials). Default: none. */
    authHeaders?: AuthHeadersFn;
    /** Display-host mapper for `target.displayHost` (app display policy). Default: identity. */
    displayHost?: DisplayHostFn;
    /** Upstream timeout in ms. Default 110s (under a typical 120s route budget). */
    timeoutMs?: number;
    /** fetch impl (injectable for tests / non-browser). Default: global fetch. */
    fetchImpl?: typeof fetch;
}
/**
 * Create a speech client bound to an app's env + auth. Both methods are no-throw and return a
 * discriminated result. This is the ONE copy of the audio I/O shared by the console (+ desktop).
 */
declare function createSpeechClient(options: SpeechClientOptions): {
    transcribe: (audio: Blob, opts?: {
        filename: string;
        model?: string;
    }) => Promise<TranscribeResult>;
    speak: (text: string, opts?: {
        voice?: string;
        model?: string;
    }) => Promise<SpeakResult>;
};
type SpeechClient = ReturnType<typeof createSpeechClient>;

type SpeechKind = 'stt' | 'tts';
interface SpeechVoice {
    /** Voice id sent to the TTS endpoint. */
    id: string;
    /** Operator-facing voice name. */
    label: string;
}
interface SpeechModel {
    /** Technical model id passed to the gateway's /v1/audio/* `model` field. May be technical. */
    id: string;
    kind: SpeechKind;
    /** Operator-facing name (no OSS-internal engine leak). */
    label: string;
    /** INTERNAL engine tag for our diagnostics — do NOT render verbatim in user-facing copy. */
    engine: string;
    /** Operator-facing one-liner describing the trade-off (quality/speed/size). */
    notes: string;
    /** Available voices (TTS only). Omitted/empty for STT. */
    voices?: readonly SpeechVoice[];
}
/** The full catalog — STT then TTS. */
declare const SPEECH_MODELS: readonly SpeechModel[];
/** Default STT model id (preferred when the gateway serves it). */
declare const defaultStt = "parakeet";
/** Default TTS model id (preferred when the gateway serves it). */
declare const defaultTts = "orpheus";
/** List the catalog models for one modality (stt|tts). Pure. */
declare function listSpeechModels(kind: SpeechKind): readonly SpeechModel[];
/** Look up a model by id (any kind). Pure. */
declare function getSpeechModel(id: string): SpeechModel | undefined;
/** The default voice id for a TTS model (its first voice), or undefined for STT / no voices. */
declare function defaultVoice(modelId: string): string | undefined;

export { type AudioBackend, type AudioConfigView, type AudioEnv, type AuthHeadersFn, type DisplayHostFn, type ModalityTarget, RECORDER_MIME_PREFERENCE, SPEECH_MODELS, type SpeakResult, type SpeechClient, type SpeechClientOptions, type SpeechFailure, type SpeechKind, type SpeechModel, type SpeechVoice, type TranscribeResult, audioConfigView, audioFilename, chooseRecorderMime, createSpeechClient, defaultStt, defaultTts, defaultVoice, getSpeechModel, listSpeechModels, resolveSttTarget, resolveTtsTarget };
