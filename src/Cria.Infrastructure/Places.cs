using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Cria.Application;
using Cria.Domain;
namespace Cria.Infrastructure;

/// <summary>Maps Photon GeoJSON to the app contract without trusting coordinates or city labels.</summary>
public static class PhotonPlaces
{
    private static string? Text(JsonElement properties, string key) =>
        properties.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()?.Trim() : null;

    public static Place[] Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("features", out var features) || features.ValueKind != JsonValueKind.Array)
            throw new FormatException("Unexpected Photon response.");
        var places = new List<Place>();
        foreach (var feature in features.EnumerateArray())
        {
            if (feature.ValueKind != JsonValueKind.Object || !feature.TryGetProperty("properties", out var properties) || properties.ValueKind != JsonValueKind.Object ||
                !feature.TryGetProperty("geometry", out var geometry) || geometry.ValueKind != JsonValueKind.Object ||
                !geometry.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "Point" ||
                !geometry.TryGetProperty("coordinates", out var coordinates) || coordinates.ValueKind != JsonValueKind.Array || coordinates.GetArrayLength() < 2 ||
                coordinates[0].ValueKind != JsonValueKind.Number || coordinates[1].ValueKind != JsonValueKind.Number ||
                !coordinates[0].TryGetDouble(out var lon) || !coordinates[1].TryGetDouble(out var lat))
                continue;
            var point = new Point(lat, lon);
            var city = Text(properties, "city");
            var country = Text(properties, "countrycode");
            if (!point.InRioBounds || (city is not null && !city.Equals("Rio de Janeiro", StringComparison.OrdinalIgnoreCase)) ||
                (country is not null && !country.Equals("BR", StringComparison.OrdinalIgnoreCase)))
                continue;
            var street = Text(properties, "street");
            var number = Text(properties, "housenumber");
            var streetAddress = street is null ? null : number is null ? street : $"{street}, {number}";
            var parts = new[] { Text(properties, "name"), streetAddress, Text(properties, "district"), city }
                .Where(p => !string.IsNullOrWhiteSpace(p)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            if (parts.Length > 0)
                places.Add(new(string.Join(", ", parts), point));
        }
        return places.DistinctBy(p => (p.Label, Math.Round(p.Point.Lat, 5), Math.Round(p.Point.Lon, 5))).Take(6).ToArray();
    }
}

public sealed class Places(IHttpClientFactory clients, IMemoryCache cache, IConfiguration config) : IPlaces
{
    private readonly SemaphoreSlim gate = new(1);
    private DateTimeOffset last;

    private async Task<string> Fetch(string baseUrl, string path, CancellationToken ct)
    {
        var url = baseUrl.TrimEnd('/') + path;
        if (cache.TryGetValue<string>(url, out var value))
            return value!;
        await gate.WaitAsync(ct);
        try
        {
            if (cache.TryGetValue<string>(url, out value))
                return value!;
            // Shared provider throttle also protects the public demo from autocomplete bursts.
            var delay = last.AddMilliseconds(1100) - DateTimeOffset.UtcNow;
            if (delay > TimeSpan.Zero)
                await Task.Delay(delay, ct);
            last = DateTimeOffset.UtcNow;
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.UserAgent.ParseAdd(config["Geocoding:UserAgent"] ?? "MoovitDeCria/1.0 (+https://moovit.joaocyrino.com)");
            request.Headers.AcceptLanguage.ParseAdd("pt-BR,pt;q=0.9");
            using var response = await clients.CreateClient("external").SendAsync(request, ct);
            response.EnsureSuccessStatusCode();
            value = await response.Content.ReadAsStringAsync(ct);
            cache.Set(url, value, TimeSpan.FromMinutes(15));
            return value;
        }
        catch (HttpRequestException) { throw new AppError(503, "Busca de lugares indisponível. Tente novamente."); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new AppError(503, "A busca demorou demais. Tente novamente."); }
        finally { gate.Release(); }
    }

    private static Place? ParseReverse(JsonElement element)
    {
        if (!element.TryGetProperty("lat", out var lat) || !element.TryGetProperty("lon", out var lon) ||
            !double.TryParse(lat.ToString(), CultureInfo.InvariantCulture, out var latitude) ||
            !double.TryParse(lon.ToString(), CultureInfo.InvariantCulture, out var longitude))
            return null;
        var point = new Point(latitude, longitude);
        if (!point.InRioBounds)
            return null;
        if (element.TryGetProperty("address", out var address))
        {
            var city = new[] { "city", "municipality", "town" }.Select(key => address.TryGetProperty(key, out var c) ? c.ToString() : null).FirstOrDefault(c => c is not null);
            if (city is not null && !city.Equals("Rio de Janeiro", StringComparison.OrdinalIgnoreCase))
                return null;
        }
        return element.TryGetProperty("display_name", out var label) ? new(label.ToString(), point) : null;
    }

    public async Task<Place[]> Search(string query, Point? bias, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Trim().Length is < 3 or > 180)
            throw new AppError(400, "Digite de 3 a 180 caracteres do lugar ou endereço.");
        if (bias is not null && !bias.InRioBounds)
            throw new AppError(400, "Localização de busca fora da região atendida.");
        var focus = bias ?? new Point(-22.924, -43.228);
        var path = $"/api/?q={Uri.EscapeDataString(query.Trim().ToLowerInvariant())}&limit=6&bbox=-43.85,-23.12,-43.08,-22.72&countrycode=BR&lat={focus.Lat.ToString("F3", CultureInfo.InvariantCulture)}&lon={focus.Lon.ToString("F3", CultureInfo.InvariantCulture)}";
        var endpoint = config["Geocoding:AutocompleteUrl"] ?? "https://photon.komoot.io";
        try
        {
            using var document = JsonDocument.Parse(await Fetch(endpoint, path, ct));
            return PhotonPlaces.Parse(document.RootElement);
        }
        catch (Exception e) when (e is JsonException or FormatException)
        {
            throw new AppError(503, "A busca de lugares está temporariamente indisponível.");
        }
    }

    // Reverse geocoding is a one-off GPS lookup, never autocomplete through public Nominatim.
    public async Task<Place?> Reverse(Point point, CancellationToken ct)
    {
        if (!point.InRioBounds)
            throw new AppError(400, "Sua localização está fora da região atendida.");
        var lat = point.Lat.ToString("F5", CultureInfo.InvariantCulture);
        var lon = point.Lon.ToString("F5", CultureInfo.InvariantCulture);
        var endpoint = config["Geocoding:BaseUrl"] ?? "https://nominatim.openstreetmap.org";
        using var document = JsonDocument.Parse(await Fetch(endpoint, $"/reverse?format=jsonv2&addressdetails=1&lat={lat}&lon={lon}", ct));
        return ParseReverse(document.RootElement);
    }
}
