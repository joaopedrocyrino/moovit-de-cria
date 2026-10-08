using Cria.Domain;
namespace Cria.Application;

public interface ITransitStore
{
    Network Get(); Point[] Shape(string shapeId);
}
public interface IVehicles
{
    Task<VehicleResult> Get(string routeId, string line, int? direction, CancellationToken ct);
}
public sealed record Place(string Label, Point Point);
public interface IPlaces
{
    Task<Place[]> Search(string query, Point? bias, CancellationToken ct); Task<Place?> Reverse(Point point, CancellationToken ct);
}
