using System.Text.Json.Serialization;

namespace WindowsMediaSessions.Backend;

/// <summary>
/// JSON DTOs for the line-delimited protocol exchanged with the Node host.
/// The shape mirrors the TypeScript <c>MediaSession</c> type one-to-one;
/// any field rename here must be mirrored in the TS side.
/// </summary>
internal static class Protocol
{
    /// <summary>Wire envelope for an outbound full-snapshot message.</summary>
    public sealed class SessionsMessage
    {
        [JsonPropertyName("type")]
        public string Type => "sessions";

        [JsonPropertyName("sessions")]
        public required IReadOnlyList<SessionDto> Sessions { get; init; }

        [JsonPropertyName("currentSessionId")]
        public string? CurrentSessionId { get; init; }
    }

    /// <summary>Wire envelope for an outbound error.</summary>
    public sealed class ErrorMessage
    {
        [JsonPropertyName("type")]
        public string Type => "error";

        [JsonPropertyName("message")]
        public required string Message { get; init; }

        [JsonPropertyName("fatal")]
        public bool Fatal { get; init; }
    }

    /// <summary>Wire envelope for the once-per-start ready handshake.</summary>
    public sealed class ReadyMessage
    {
        [JsonPropertyName("type")]
        public string Type => "ready";

        [JsonPropertyName("version")]
        public required string Version { get; init; }

        [JsonPropertyName("protocol")]
        public int ProtocolVersion { get; init; }
    }

    public sealed class SessionDto
    {
        [JsonPropertyName("id")]
        public required string Id { get; init; }

        [JsonPropertyName("sourceAppUserModelId")]
        public required string SourceAppUserModelId { get; init; }

        /// <summary>
        /// Friendly display name resolved from the AUMID (e.g. "Spotify",
        /// "Mozilla Firefox"). Null when Windows can't resolve the AUMID to a
        /// registered app — falls back to the AUMID itself on the consumer side.
        /// </summary>
        [JsonPropertyName("sourceAppDisplayName")]
        public string? SourceAppDisplayName { get; init; }

        [JsonPropertyName("title")]
        public string? Title { get; init; }

        [JsonPropertyName("artist")]
        public string? Artist { get; init; }

        [JsonPropertyName("albumTitle")]
        public string? AlbumTitle { get; init; }

        [JsonPropertyName("genres")]
        public IReadOnlyList<string>? Genres { get; init; }

        [JsonPropertyName("playbackStatus")]
        public required string PlaybackStatus { get; init; }

        [JsonPropertyName("timeline")]
        public TimelineDto? Timeline { get; init; }

        [JsonPropertyName("controls")]
        public ControlsDto? Controls { get; init; }

        /// <summary>
        /// Base64 data URL (e.g. <c>data:image/jpeg;base64,...</c>) of the album/track
        /// art the app supplies. Null when the app doesn't expose a thumbnail or when
        /// reading the stream failed. <c>JsonIgnoreCondition.Never</c> forces the field
        /// to be present even when null so consumers can tell "missing" from "old binary".
        /// </summary>
        [JsonPropertyName("thumbnail")]
        [JsonIgnore(Condition = JsonIgnoreCondition.Never)]
        public string? Thumbnail { get; init; }
    }

    public sealed class TimelineDto
    {
        [JsonPropertyName("positionMs")]
        public long? PositionMs { get; init; }

        [JsonPropertyName("durationMs")]
        public long? DurationMs { get; init; }
    }

    public sealed class ControlsDto
    {
        [JsonPropertyName("canPlay")]
        public bool CanPlay { get; init; }

        [JsonPropertyName("canPause")]
        public bool CanPause { get; init; }

        [JsonPropertyName("canSkipNext")]
        public bool CanSkipNext { get; init; }

        [JsonPropertyName("canSkipPrevious")]
        public bool CanSkipPrevious { get; init; }
    }
}
