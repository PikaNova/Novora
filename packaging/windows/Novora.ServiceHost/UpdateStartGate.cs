using System.Text.Json;
using Novora.Update;

namespace Novora.ServiceHost;

internal static class UpdateStartGate
{
    // The updater starts this service itself while state.json still reports these phases
    // (UpdateEngine.cs:99 verifies the new version, UpdateEngine.cs:148 verifies a recovery),
    // so they must stay startable or every update fails its own health check.
    private static bool IsUpdaterDrivenStart(string phase) => phase is "verifying" or "rolling-back";

    public static bool BlocksStart(string? phase) =>
        phase is not null && UpdateEngine.NeedsRecovery(phase) && !IsUpdaterDrivenStart(phase);

    public static UpdateState? ReadState(string path) => File.Exists(path)
        ? JsonSerializer.Deserialize<UpdateState>(File.ReadAllText(path), UpdatePackage.Json)
        : null;
}
