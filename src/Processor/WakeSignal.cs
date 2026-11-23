namespace Processor;

/// <summary>Lets /wake cut a poll short. Coalesces bursts into one wake.</summary>
public sealed class WakeSignal
{
    readonly SemaphoreSlim _signal = new(0, 1);

    public void Wake()
    {
        try
        {
            _signal.Release();
        }
        catch (SemaphoreFullException)
        {
        }
    }

    public Task WaitAsync(TimeSpan timeout, CancellationToken ct) => _signal.WaitAsync(timeout, ct);
}
