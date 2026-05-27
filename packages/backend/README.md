# windows-media-sessions-backend

Self-contained .NET 8 console executable that bridges
`Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`
to a Node.js host over stdio. See [`docs/PROTOCOL.md`](../../docs/PROTOCOL.md)
for the on-the-wire contract.

## Build

```pwsh
dotnet publish -c Release -r win-x64
```

The produced binary lands in
`bin/Release/net8.0-windows10.0.19041.0/win-x64/publish/windows-media-sessions-backend.exe`
and is fully self-contained — no .NET install is required on the target machine.

## Run standalone

```pwsh
.\windows-media-sessions-backend.exe
```

Then type `refresh<enter>` to force a snapshot, or `exit<enter>` to terminate.
