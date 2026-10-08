# Catálogo de lugares e apelidos

O arquivo `src/Cria.Infrastructure/Data/places.json` contém lugares curados do Rio.
Não existe uma lista fixa de nomes no código C#: adicione novas entradas pelo comando
abaixo ou edite o JSON. O catálogo é incluído no backend e na imagem Docker, sem banco
extra, chave de API ou endpoint público de escrita.

## Adicionar um lugar

Na raiz do projeto:

```bash
npm run places:add
```

O formulário no terminal solicita nome, apelidos separados por `;`, endereço opcional,
bairro, **latitude, longitude** e origem das coordenadas. Use ponto nos decimais.
O comando verifica IDs duplicados e limites geográficos antes de salvar; um erro
preserva o arquivo anterior. Se houver outra unidade com o mesmo nome, passe um ID:

```bash
npm run places:add -- --id nome-do-lugar-bairro
```

Também é possível cadastrar sem perguntas interativas:

```bash
npm run places:add -- --name "Nome verificado" --id nome-verificado-botafogo \
  --aliases "Apelido;Outro nome" --address "Endereço verificado" \
  --neighborhood "Botafogo" --coordinates="LATITUDE_VERIFICADA,LONGITUDE_VERIFICADA" \
  --source "GPS próprio, data da visita"
```

Substitua os valores de exemplo por dados reais. Não use o centro de uma rua ou
coordenadas inventadas: o ponto é usado diretamente como destino da rota.

```bash
npm run places:validate
```

Para editar/desativar um lugar, altere sua entrada no JSON e rode a validação.
`enabled: false` permite guardar um rascunho com `lat`/`lon` nulos, sem aparecer nas
sugestões. Uma entrada ativa precisa de coordenadas válidas e uma origem registrada.

Reinicie `npm run dev` após alterar o catálogo. Em produção, faça commit/push em
**main**: o CI reconstrói a imagem com as entradas novas. O arquivo não fica no volume
GTFS e não é substituído por uma atualização de horários. Não há publicação automática
no OpenStreetMap nem acesso à `.env` do droplet.

## Busca

- Ignora caixa, acentos, pontuação e espaços extras; aceita prefixos e palavras fora
  de ordem em nomes/apelidos, endereço e bairro.
- Correspondência exata de nome/apelido retorna o catálogo sem depender de Photon.
- Nas outras buscas, combina catálogo e Photon, com lugares locais primeiro e até
  seis sugestões. Mesma unidade/nome ou apelido a até 30 metros não aparece duas vezes;
  negócios diferentes no mesmo prédio e unidades distantes permanecem separados.
- Se Photon estiver indisponível, sugestões locais encontradas continuam funcionando.
- Coordenadas de Casa do Amor e RFT são as fornecidas pelo mantenedor. Chora Café usa
  um ponto OSM do estabelecimento. Canastra Rosé usa o ponto do prédio OSM no endereço
  publicado, Rua Álvaro Ramos, 154: refine com GPS da entrada se necessário.
- A origem `catalog`, `photon` ou `nominatim` acompanha cada resultado da API.

## Contribuir para OpenStreetMap/Photon

Photon pesquisa dados do OpenStreetMap; o caminho normal para corrigir um lugar no
servidor público é contribuir para OSM, não enviar uma entrada JSON a Photon.

1. Crie uma conta em [OpenStreetMap](https://www.openstreetmap.org/).
2. Localize o endereço, clique **Editar** e verifique se o lugar já existe, para não duplicá-lo.
3. Adicione/corrija o ponto do lugar com categoria adequada, nome e endereço verificados.
4. Use `name` para o nome comum, `short_name` para uma abreviação real como RFT e
   `alt_name` para outros nomes efetivamente usados. Não adicione palavras-chave de busca
   ou variações sem acentos só para manipular resultados.
5. Salve com um comentário explicando sua visita/verificação. Confira depois a busca
   Photon: a disponibilidade depende de atualização e indexação do serviço; não há
   prazo garantido. Se um objeto já existe corretamente e não é encontrado, relate
   o problema ao Photon com o link OSM e a consulta que falhou.

Use observação própria, GPS e fontes permitidas por OSM. **Não copie dados de Google
Maps/Waze para OSM.** O catálogo local continua separado das contribuições públicas.

Referências: [guia de edição OSM](https://wiki.openstreetmap.org/wiki/Beginners%27_guide),
[nomes alternativos](https://wiki.openstreetmap.org/wiki/Key:alt_name),
[abreviações](https://wiki.openstreetmap.org/wiki/Key:short_name),
[boas práticas e fontes](https://wiki.openstreetmap.org/wiki/Good_practice),
[Photon](https://github.com/komoot/photon).
