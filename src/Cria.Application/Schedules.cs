using Cria.Domain;
namespace Cria.Application;

public static class Schedules
{
    public static readonly TimeZoneInfo Rio = TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo");
    public static int? Next(Window window, int ready, int offset)
    {
        var t = ready - offset;
        if (window.Headway == 0)
            return t <= window.Start ? window.Start + offset : null;
        int departure;
        if (window.Exact)
            departure = window.Start + Math.Max(0, (int)Math.Ceiling((t - window.Start) / (double)window.Headway)) * window.Headway;
        else
            departure = Math.Max(t, window.Start) + window.Headway / 2;
        return departure < window.End ? departure + offset : null;
    }
    public static DateTimeOffset? Departure(Pattern p, int index, DateTimeOffset ready, Network n)
    {
        var local = TimeZoneInfo.ConvertTime(ready, Rio);
        DateTimeOffset? best = null;
        // Yesterday's service may continue beyond 24:00; tomorrow can begin inside the search horizon.
        foreach (var shift in new[] { -1, 0, 1 })
        {
            var date = DateOnly.FromDateTime(local.DateTime).AddDays(shift);
            var day = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), Rio.GetUtcOffset(date.ToDateTime(TimeOnly.MinValue)));
            var seconds = (int)Math.Ceiling((ready - day).TotalSeconds);
            foreach (var w in p.Windows)
            {
                if (!n.Services.TryGetValue(w.ServiceId, out var svc) || !svc.Runs(date))
                    continue;
                var time = Next(w, seconds, p.Mode == "metro" ? 0 : p.Stops[index].Departure);
                if (time is null)
                    continue;
                var departure = day.AddSeconds(time.Value);
                if (departure >= ready && departure <= ready.AddHours(3) && (best is null || departure < best))
                    best = departure;
            }
        }
        return best;
    }

    public static int? Previous(Window window, int latest, int offset)
    {
        var limit = Math.Min(latest - offset, window.End - 1);
        if (window.Headway == 0) return latest >= window.Start + offset ? window.Start + offset : null;
        if (window.Exact)
            return limit < window.Start ? null : window.Start + (limit - window.Start) / window.Headway * window.Headway + offset;
        // Leave enough time for the same half-headway waiting estimate used in forward routing.
        return limit < window.Start + window.Headway / 2 ? null : limit + offset;
    }
    public static (DateTimeOffset Departure, DateTimeOffset Ready)? LatestDeparture(Pattern pattern, int index, DateTimeOffset latest, Network network)
    {
        var local = TimeZoneInfo.ConvertTime(latest, Rio);
        (DateTimeOffset Departure, DateTimeOffset Ready)? best = null;
        foreach (var shift in new[] { -1, 0, 1 })
        {
            var date = DateOnly.FromDateTime(local.DateTime).AddDays(shift);
            var day = new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), Rio.GetUtcOffset(date.ToDateTime(TimeOnly.MinValue)));
            var seconds = (int)Math.Floor((latest - day).TotalSeconds);
            foreach (var window in pattern.Windows)
            {
                if (!network.Services.TryGetValue(window.ServiceId, out var service) || !service.Runs(date)) continue;
                var time = Previous(window, seconds, pattern.Mode == "metro" ? 0 : pattern.Stops[index].Departure);
                if (time is null) continue;
                var departure = day.AddSeconds(time.Value);
                var ready = departure.AddSeconds(!window.Exact && window.Headway > 0 ? -window.Headway / 2 : 0);
                if (departure <= latest && departure >= latest.AddHours(-3) && (best is null || ready > best.Value.Ready)) best = (departure, ready);
            }
        }
        return best;
    }
}
