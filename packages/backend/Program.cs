using System.Reflection;
using System.Text.Json;
using WindowsMediaSessions.Backend;

// Entry point: line-delimited JSON over stdout, control commands over stdin.
//
// The host (Node) treats this process as a single source of truth: every
// non-trivial event in GSMTC produces a fresh full snapshot. Diffing is
// performed on the Node side, which keeps this process tiny and stateless.

const int ProtocolVersion = 1;
const int DebounceMs = 50;

// stdout must be UTF-8 with newline-only line terminators so the Node side
// can split on '\n' without worrying about CRLF.
Console.OutputEncoding = System.Text.Encoding.UTF8;
var stdout = new StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false))
{
    AutoFlush = true,
    NewLine = "\n",
};

var jsonOptions = new JsonSerializerOptions
{
    DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
};

var writeLock = new SemaphoreSlim(1, 1);

async Task WriteAsync(object payload)
{
    var json = JsonSerializer.Serialize(payload, jsonOptions);
    await writeLock.WaitAsync();
    try
    {
        await stdout.WriteLineAsync(json);
    }
    finally
    {
        writeLock.Release();
    }
}

// Handshake — Node uses this to confirm the binary is alive and speaks the
// expected protocol revision.
var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0";
await WriteAsync(new Protocol.ReadyMessage { Version = version, ProtocolVersion = ProtocolVersion });

await using var service = new SessionService();
service.Error += ex =>
{
    // Fire-and-forget: failing to write an error must never throw upwards,
    // and a dead pipe will be picked up by the host as a process exit.
    _ = Task.Run(async () =>
    {
        try
        {
            await WriteAsync(new Protocol.ErrorMessage { Message = ex.Message, Fatal = false });
        }
        catch
        {
            // Pipe broken — nothing we can do here.
        }
    });
};

// Debounce snapshot emissions: GSMTC can fire several events in quick succession
// (e.g. when a track changes Spotify will burst MediaPropertiesChanged +
// PlaybackInfoChanged + TimelinePropertiesChanged inside ~10ms).
var debounceCts = new CancellationTokenSource();
var pending = 0;
service.SnapshotAvailable += () =>
{
    if (Interlocked.Exchange(ref pending, 1) == 1) return;
    _ = Task.Run(async () =>
    {
        try
        {
            await Task.Delay(DebounceMs);
            Interlocked.Exchange(ref pending, 0);
            var snapshot = await service.BuildSnapshotAsync();
            await WriteAsync(snapshot);
        }
        catch (Exception ex)
        {
            try
            {
                await WriteAsync(new Protocol.ErrorMessage { Message = ex.Message, Fatal = false });
            }
            catch { /* swallow — pipe broken */ }
        }
    });
};

try
{
    await service.StartAsync();
}
catch (Exception ex)
{
    await WriteAsync(new Protocol.ErrorMessage { Message = ex.Message, Fatal = true });
    return 1;
}

// stdin: a single "exit" line (or EOF) ends the process. Anything else is
// reserved for future commands like "refresh".
var stdin = Console.In;
var lifetime = new TaskCompletionSource<int>();

_ = Task.Run(async () =>
{
    try
    {
        string? line;
        while ((line = await stdin.ReadLineAsync()) is not null)
        {
            if (line.Equals("exit", StringComparison.OrdinalIgnoreCase))
            {
                lifetime.TrySetResult(0);
                return;
            }
            if (line.Equals("refresh", StringComparison.OrdinalIgnoreCase))
            {
                await WriteAsync(await service.BuildSnapshotAsync());
            }
        }
        // Node closed stdin → it has gone away; shut down cleanly.
        lifetime.TrySetResult(0);
    }
    catch (Exception ex)
    {
        lifetime.TrySetException(ex);
    }
});

return await lifetime.Task;
