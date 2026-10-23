using System.Text;
using System.Threading.Channels;

namespace Novora.ServiceHost;

// Node delivers stdout and stderr callbacks on different threads, and concurrent File.AppendAllText
// on one file throws IOException, so lines are only queued here: a single writer thread owns the
// file, appends whole batches and rotates it once the batch would exceed the size cap.
internal sealed class ServiceLogWriter : IDisposable
{
    internal const long MaximumFileBytes = 5L * 1024 * 1024;
    internal const int ArchivedFileCount = 3;
    private const int MaximumBatchLines = 512;
    private static readonly TimeSpan ShutdownDrainTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan RetryBackoff = TimeSpan.FromMilliseconds(200);

    private readonly Channel<string> queue = Channel.CreateUnbounded<string>();
    private readonly Task writer;
    private readonly string filePath;

    internal ServiceLogWriter(string filePath)
    {
        this.filePath = filePath;
        writer = Task.Run(RunAsync);
    }

    internal void Append(string? line)
    {
        if (line is null) return;
        queue.Writer.TryWrite($"{DateTimeOffset.Now:O} {line}");
    }

    public void Dispose()
    {
        queue.Writer.TryComplete();
        try { writer.Wait(ShutdownDrainTimeout); }
        catch (Exception) { /* A wedged disk must never block service shutdown. */ }
    }

    private async Task RunAsync()
    {
        var batch = new List<string>();
        while (true)
        {
            try
            {
                if (!await queue.Reader.WaitToReadAsync().ConfigureAwait(false)) break;
                batch.Clear();
                while (batch.Count < MaximumBatchLines && queue.Reader.TryRead(out var line)) batch.Add(line);
                Write(batch);
            }
            catch (Exception)
            {
                // Per batch, not around the loop: Write only filters the IO family, so anything
                // else has to be survived here. If this thread died, Append would keep filling an
                // unbounded queue that nothing drains, silently cutting off the log.
                await Task.Delay(RetryBackoff).ConfigureAwait(false);
            }
        }
    }

    private void Write(List<string> batch)
    {
        if (batch.Count == 0) return;
        var builder = new StringBuilder();
        foreach (var line in batch) builder.Append(line).Append(Environment.NewLine);
        var text = builder.ToString();
        try
        {
            if (ShouldRotate(Encoding.UTF8.GetByteCount(text))) Rotate();
            File.AppendAllText(filePath, text);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { /* Only a failing disk can cost a batch. */ }
    }

    private bool ShouldRotate(long incomingBytes)
    {
        try
        {
            return File.Exists(filePath) && new FileInfo(filePath).Length > MaximumFileBytes - incomingBytes;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return false; // Keep appending rather than dropping lines over a size probe.
        }
    }

    // ".1" is the most recent archive; the oldest one is dropped rather than growing without bound.
    private void Rotate()
    {
        try
        {
            var oldest = $"{filePath}.{ArchivedFileCount}";
            if (File.Exists(oldest)) File.Delete(oldest);
            for (var index = ArchivedFileCount - 1; index >= 1; index--)
            {
                var archived = $"{filePath}.{index}";
                if (File.Exists(archived)) File.Move(archived, $"{filePath}.{index + 1}");
            }
            File.Move(filePath, $"{filePath}.1");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // The file stays oversized; appending to it still beats losing the queue.
        }
    }
}
