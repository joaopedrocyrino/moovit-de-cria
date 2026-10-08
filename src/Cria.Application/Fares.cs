using Cria.Domain;
namespace Cria.Application;

public static class Fares
{
    public static Fare Quote(IEnumerable<Leg> legs, string payment)
    {
        var rides = legs.Where(l => l.Kind == "transit").ToArray();
        if (rides.Any(l => l.FareCents is null))
            return new(null, "Tarifa não disponível", ["Há um serviço sem tarifa publicada. Consulte o operador."]);
        var total = rides.Select((ride, i) => ride.Mode == "metro" && i > 0 && rides[i - 1].Mode == "metro" && rides[i - 1].To.Id == ride.From.Id ? 0 : ride.FareCents!.Value).Sum();
        var notes = new List<string> { "Estimativa a partir do GTFS e da tarifa MetrôRio; descontos pessoais e serviços especiais podem alterar o valor." };
        if (rides.Any(l => l.Mode == "metro"))
            notes.Add("Metrô: R$ 7,90 por acesso; transferência interna entre linhas sem nova tarifa. Integração com ônibus/BRT não foi presumida.");
        var municipal = rides.Where(l => l.Municipal).ToArray();
        if (payment == "jae" && municipal.Length is >= 2 and <= 3 && municipal.All(l => l.FareCents == 500) && municipal.Any(l => l.Mode == "brt") && municipal[^1].Start - municipal[0].Start <= TimeSpan.FromHours(3))
        {
            total -= (municipal.Length - 1) * 500;
            notes.Add("Estimativa BUC: exige Jaé preto/QR Code elegível, viagens no mesmo sentido e até 3 embarques em 3h, incluindo BRT. Confirme a elegibilidade; sentido tarifário não é verificável pelo GTFS.");
        }
        else if (payment == "jae")
            notes.Add("Nenhuma integração BUC foi aplicada a esta combinação; confirme seus benefícios no Jaé.");
        return new(total, payment == "jae" ? "Estimativa com Jaé" : "Tarifas individuais", notes.ToArray());
    }
}
