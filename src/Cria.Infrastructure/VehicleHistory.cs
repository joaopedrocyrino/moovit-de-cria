using Cria.Domain;
namespace Cria.Infrastructure;

public static class VehicleHistory
{
    public static Vehicle[] Merge(IEnumerable<Vehicle> previous, IEnumerable<Vehicle> reports, DateTimeOffset now)
    {
        return reports.Concat(previous)
            .Where(v => v.ObservedAt >= now.AddSeconds(-180) && v.ObservedAt <= now.AddSeconds(30))
            .GroupBy(v => v.Id)
            .Select(group =>
            {
                var ordered = group.OrderByDescending(v => v.ObservedAt).ToArray();
                var latest = ordered[0];
                var confirmed = ordered.FirstOrDefault(v => !string.IsNullOrEmpty(v.RouteId) && v.Direction is not null);
                if (confirmed is null) return latest;
                // A provider's identifier-free report is not evidence that a bus left its route.
                // Keep the last confirmed GPS report, with its original position and timestamp.
                // Explicit newer direction/variant changes invalidate that report immediately.
                var conflicting = ordered.FirstOrDefault(v => v.ObservedAt >= confirmed.ObservedAt &&
                    (!string.IsNullOrEmpty(v.RouteId) && v.RouteId != confirmed.RouteId ||
                     v.Direction is not null && v.Direction != confirmed.Direction ||
                     !string.IsNullOrEmpty(v.ShapeId) && !string.IsNullOrEmpty(confirmed.ShapeId) && v.ShapeId != confirmed.ShapeId));
                return conflicting ?? confirmed;
            }).ToArray();
    }
}
