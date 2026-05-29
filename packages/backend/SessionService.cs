using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using Windows.ApplicationModel;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace WindowsMediaSessions.Backend;

using GsmtcManager = GlobalSystemMediaTransportControlsSessionManager;
using GsmtcSession = GlobalSystemMediaTransportControlsSession;

/// <summary>
/// Wraps GSMTC and emits a <see cref="SnapshotAvailable"/> event every time
/// any session's media properties, playback info, timeline, or the manager's
/// session list changes. The service deliberately exposes a single "snapshot"
/// event so that the host can debounce and forward to Node atomically.
/// </summary>
internal sealed class SessionService : IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, SessionSubscription> _subscriptions = new();
    private readonly ConcurrentDictionary<string, ThumbnailCacheEntry> _thumbnailCache = new();
    private readonly ConcurrentDictionary<string, string?> _displayNameCache = new();
    private GsmtcManager? _manager;

    /// <summary>
    /// Cache row keyed by sessionId. The Key is derived from title/artist/album
    /// so we only re-decode the thumbnail blob when the underlying media
    /// actually changes; TimelinePropertiesChanged fires ~once a second on
    /// some apps and we don't want to re-read art (or re-emit diagnostics)
    /// that often.
    /// </summary>
    private sealed record ThumbnailCacheEntry(string Key, string? DataUrl);

    /// <summary>Fired whenever a relevant event triggers a state change.</summary>
    public event Action? SnapshotAvailable;

    /// <summary>Fired when an unhandled error happens inside an event handler.</summary>
    public event Action<Exception>? Error;

    public async Task StartAsync()
    {
        _manager = await GsmtcManager.RequestAsync();
        _manager.SessionsChanged += OnSessionsChanged;
        _manager.CurrentSessionChanged += OnCurrentSessionChanged;
        RebuildSubscriptions();
        SnapshotAvailable?.Invoke();
    }

    /// <summary>
    /// Returns a deterministic ID for a session. GSMTC does not give us a stable
    /// UUID, but the SourceAppUserModelId is unique per app and persists for the
    /// lifetime of the session, which is close enough for our caching needs.
    /// </summary>
    private static string GetSessionId(GsmtcSession session) => session.SourceAppUserModelId;

    public async Task<Protocol.SessionsMessage> BuildSnapshotAsync()
    {
        var manager = _manager;
        if (manager is null)
        {
            return new Protocol.SessionsMessage { Sessions = Array.Empty<Protocol.SessionDto>() };
        }

        var live = manager.GetSessions();

        // Build DTOs in parallel: thumbnail reads are I/O-bound and we don't
        // want one slow app to serialize the rest of the snapshot.
        var tasks = live.Select(BuildDtoSafelyAsync).ToList();
        var built = await Task.WhenAll(tasks);
        var sessions = built.OfType<Protocol.SessionDto>().ToList();

        // Drop cache entries for sessions that have gone away.
        var liveIds = new HashSet<string>(live.Select(GetSessionId));
        foreach (var key in _thumbnailCache.Keys.ToArray())
        {
            if (!liveIds.Contains(key)) _thumbnailCache.TryRemove(key, out _);
        }

        string? currentId = null;
        try
        {
            currentId = manager.GetCurrentSession() is { } current
                ? GetSessionId(current)
                : null;
        }
        catch (Exception ex)
        {
            Error?.Invoke(ex);
        }

        return new Protocol.SessionsMessage
        {
            Sessions = sessions,
            CurrentSessionId = currentId,
        };
    }

    private async Task<Protocol.SessionDto?> BuildDtoSafelyAsync(GsmtcSession session)
    {
        try
        {
            return await BuildDtoAsync(session);
        }
        catch (Exception ex)
        {
            // Skip the broken session but keep the others; never let one
            // misbehaving app take the whole snapshot down.
            Error?.Invoke(ex);
            return null;
        }
    }

    private async Task<Protocol.SessionDto> BuildDtoAsync(GsmtcSession session)
    {
        var props = await session.TryGetMediaPropertiesAsync();
        var timeline = session.GetTimelineProperties();
        var playback = session.GetPlaybackInfo();

        var controlsDto = playback.Controls is null
            ? null
            : new Protocol.ControlsDto
            {
                CanPlay = playback.Controls.IsPlayEnabled,
                CanPause = playback.Controls.IsPauseEnabled,
                CanSkipNext = playback.Controls.IsNextEnabled,
                CanSkipPrevious = playback.Controls.IsPreviousEnabled,
            };

        Protocol.TimelineDto? timelineDto = null;
        if (timeline is not null)
        {
            // Position/EndTime can both be zero when a track hasn't started yet;
            // emit them anyway so the consumer can detect "stopped at 0/0".
            timelineDto = new Protocol.TimelineDto
            {
                PositionMs = (long)timeline.Position.TotalMilliseconds,
                DurationMs = (long)timeline.EndTime.TotalMilliseconds,
            };
        }

        var sessionId = GetSessionId(session);
        var thumbnail = await GetCachedThumbnailAsync(sessionId, props);
        var displayName = GetCachedDisplayName(session.SourceAppUserModelId);

        return new Protocol.SessionDto
        {
            Id = sessionId,
            SourceAppUserModelId = session.SourceAppUserModelId,
            SourceAppDisplayName = displayName,
            Title = string.IsNullOrEmpty(props?.Title) ? null : props.Title,
            Artist = string.IsNullOrEmpty(props?.Artist) ? null : props.Artist,
            AlbumTitle = string.IsNullOrEmpty(props?.AlbumTitle) ? null : props.AlbumTitle,
            Genres = props?.Genres is { Count: > 0 } g ? g.ToArray() : null,
            PlaybackStatus = MapStatus(playback.PlaybackStatus),
            Timeline = timelineDto,
            Controls = controlsDto,
            Thumbnail = thumbnail,
        };
    }

    /// <summary>
    /// Reads and base64-encodes the thumbnail attached to the media properties,
    /// returning a data URL. Caches the result (success OR failure) against
    /// (title|artist|album) so repeated snapshots within the same track don't
    /// re-decode the blob, and so diagnostic errors fire at most once per
    /// track instead of on every position tick.
    /// </summary>
    private async Task<string?> GetCachedThumbnailAsync(
        string sessionId,
        GlobalSystemMediaTransportControlsSessionMediaProperties? props)
    {
        var cacheKey = $"{props?.Title}|{props?.Artist}|{props?.AlbumTitle}";
        if (_thumbnailCache.TryGetValue(sessionId, out var cached) && cached.Key == cacheKey)
        {
            return cached.DataUrl;
        }

        string? dataUrl = null;
        // A null props, or a source app that exposes no thumbnail through GSMTC,
        // is entirely normal: many browsers/PWAs/OBS never provide one, and any
        // app reports none while it's tearing down (e.g. Spotify on quit). This
        // is not a diagnostic or an error — we just report a null thumbnail.
        if (props?.Thumbnail is { } thumbRef)
        {
            dataUrl = await ReadThumbnailDataUrlAsync(thumbRef);
        }

        _thumbnailCache[sessionId] = new ThumbnailCacheEntry(cacheKey, dataUrl);
        return dataUrl;
    }

    /// <summary>
    /// Resolves an AUMID to its friendly display name (e.g. "Spotify") via
    /// <see cref="AppInfo.GetFromAppUserModelId"/>. Cached for the lifetime of
    /// the process; lookups are cheap COM calls but no point repeating them
    /// every snapshot. Both positive and negative results (null) are cached so
    /// a failed resolve doesn't get retried each tick.
    /// </summary>
    private string? GetCachedDisplayName(string aumid)
    {
        return _displayNameCache.GetOrAdd(aumid, key =>
        {
            // Step 1: AppInfo covers UWP/MSIX apps and well-registered Win32
            // apps. Try it first because it's the official WinRT path.
            try
            {
                var info = AppInfo.GetFromAppUserModelId(key);
                var name = info?.DisplayInfo?.DisplayName;
                if (!string.IsNullOrWhiteSpace(name)) return name;
            }
            catch
            {
                // Fall through to the Shell fallback.
            }

            // Step 2: Shell fallback. Browsers (Firefox/Chrome) use synthetic
            // AUMIDs derived from shortcut paths (e.g. "308046B0AF4A39CB"); these
            // aren't packaged apps but they ARE registered in shell:AppsFolder,
            // which is exactly what Get-StartApps walks. SHCreateItemFromParsingName
            // gives us the IShellItem and GetDisplayName returns "Mozilla Firefox".
            return ResolveAumidViaShell(key);
        });
    }

    private static string? ResolveAumidViaShell(string aumid)
    {
        try
        {
            var iid = typeof(IShellItem).GUID;
            var hr = SHCreateItemFromParsingName($"shell:AppsFolder\\{aumid}", IntPtr.Zero, ref iid, out var item);
            if (hr != 0 || item is null) return null;
            try
            {
                item.GetDisplayName(SIGDN_NORMALDISPLAY, out var name);
                return string.IsNullOrWhiteSpace(name) ? null : name;
            }
            finally
            {
                Marshal.ReleaseComObject(item);
            }
        }
        catch
        {
            return null;
        }
    }

    // SIGDN_NORMALDISPLAY = the human-friendly Start-menu name (e.g. "Spotify").
    private const uint SIGDN_NORMALDISPLAY = 0;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SHCreateItemFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        IntPtr pbc,
        ref Guid riid,
        out IShellItem ppv);

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    private async Task<string?> ReadThumbnailDataUrlAsync(IRandomAccessStreamReference thumbRef)
    {
        try
        {
            using var stream = await thumbRef.OpenReadAsync();
            if (stream is null)
            {
                Error?.Invoke(new Exception("Thumbnail OpenReadAsync returned null"));
                return null;
            }
            if (stream.Size == 0)
            {
                Error?.Invoke(new Exception($"Thumbnail stream has size 0 (contentType={stream.ContentType ?? "?"})"));
                return null;
            }

            // Cap the blob to keep JSON snapshots small. 4 MB is generous;
            // album art rarely exceeds 500 KB.
            const uint maxBytes = 4 * 1024 * 1024;
            var size = (uint)Math.Min(stream.Size, maxBytes);

            using var reader = new DataReader(stream.GetInputStreamAt(0));
            var loaded = await reader.LoadAsync(size);
            if (loaded == 0)
            {
                Error?.Invoke(new Exception($"Thumbnail DataReader.LoadAsync loaded 0 bytes (asked for {size})"));
                return null;
            }
            var bytes = new byte[loaded];
            reader.ReadBytes(bytes);

            var contentType = string.IsNullOrEmpty(stream.ContentType) ? "image/png" : stream.ContentType;
            return $"data:{contentType};base64,{Convert.ToBase64String(bytes)}";
        }
        catch (Exception ex)
        {
            Error?.Invoke(new Exception($"Thumbnail read failed: {ex.GetType().Name}: {ex.Message}", ex));
            return null;
        }
    }

    private static string MapStatus(GlobalSystemMediaTransportControlsSessionPlaybackStatus status) =>
        status switch
        {
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Closed => "closed",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Opened => "opened",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Changing => "changing",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Stopped => "stopped",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing => "playing",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused => "paused",
            _ => "closed",
        };

    private void OnSessionsChanged(GsmtcManager sender, SessionsChangedEventArgs args)
    {
        try
        {
            RebuildSubscriptions();
            SnapshotAvailable?.Invoke();
        }
        catch (Exception ex)
        {
            Error?.Invoke(ex);
        }
    }

    private void OnCurrentSessionChanged(GsmtcManager sender, CurrentSessionChangedEventArgs args)
    {
        // Only the "current" pointer moved; data is unchanged but the snapshot
        // still embeds currentSessionId so we need to re-emit.
        SnapshotAvailable?.Invoke();
    }

    /// <summary>
    /// Diffs the currently subscribed sessions against the manager's live list
    /// and attaches/detaches handlers so we don't leak when an app exits.
    /// </summary>
    private void RebuildSubscriptions()
    {
        if (_manager is null) return;

        var live = _manager.GetSessions();
        var liveIds = new HashSet<string>(live.Select(GetSessionId));

        foreach (var (id, sub) in _subscriptions.ToArray())
        {
            if (!liveIds.Contains(id))
            {
                sub.Dispose();
                _subscriptions.TryRemove(id, out _);
            }
        }

        foreach (var session in live)
        {
            var id = GetSessionId(session);
            _subscriptions.GetOrAdd(id, _ => new SessionSubscription(session, () => SnapshotAvailable?.Invoke()));
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_manager is not null)
        {
            _manager.SessionsChanged -= OnSessionsChanged;
            _manager.CurrentSessionChanged -= OnCurrentSessionChanged;
            _manager = null;
        }

        foreach (var sub in _subscriptions.Values)
        {
            sub.Dispose();
        }
        _subscriptions.Clear();
        await Task.CompletedTask;
    }

    /// <summary>
    /// Holds the three per-session handler delegates so we can detach them by
    /// reference on disposal (anonymous lambdas cannot be unsubscribed otherwise).
    /// </summary>
    private sealed class SessionSubscription : IDisposable
    {
        private GsmtcSession? _session;
        private readonly TypedEventHandler<GsmtcSession, MediaPropertiesChangedEventArgs> _onMedia;
        private readonly TypedEventHandler<GsmtcSession, PlaybackInfoChangedEventArgs> _onPlayback;
        private readonly TypedEventHandler<GsmtcSession, TimelinePropertiesChangedEventArgs> _onTimeline;

        public SessionSubscription(GsmtcSession session, Action notify)
        {
            _session = session;
            _onMedia = (_, _) => notify();
            _onPlayback = (_, _) => notify();
            _onTimeline = (_, _) => notify();

            session.MediaPropertiesChanged += _onMedia;
            session.PlaybackInfoChanged += _onPlayback;
            session.TimelinePropertiesChanged += _onTimeline;
        }

        public void Dispose()
        {
            if (_session is null) return;
            _session.MediaPropertiesChanged -= _onMedia;
            _session.PlaybackInfoChanged -= _onPlayback;
            _session.TimelinePropertiesChanged -= _onTimeline;
            _session = null;
        }
    }
}
