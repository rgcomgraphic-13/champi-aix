# Champi Aix

Carte de prévision de pousse des champignons sur Aix-en-Provence et 50 km autour.

## Utilisation

En ligne : https://rgcomgraphic-13.github.io/champi-aix/ (sur téléphone : « Ajouter à l'écran d'accueil »).

En local : ouvrez `index.html` dans votre navigateur (double-clic). Une connexion internet est nécessaire.

- La météo est téléchargée depuis Open-Meteo à chaque ouverture : la carte est donc à jour tous les jours, sans rien faire. Si la page reste ouverte, elle se met à jour toute seule toutes les 6 heures et au changement de jour.
- Choisissez une espèce et un jour (aujourd'hui + 6 jours de prévision).
- Cliquez n'importe où sur la carte pour voir le détail d'un coin : indice par espèce, pluie des 20 derniers jours et des 6 prochains, humidité du sol, température, altitude, exposition, type de forêt. Le lien « Itinéraire » ouvre Google Maps.
- « Meilleurs coins du jour » liste les 8 meilleurs secteurs, espacés d'au moins 5 km.

## Le modèle

Le site chasseursdechampignons.com ne publie pas son algorithme. Celui-ci reprend le même principe (météo + biotope, espèce par espèce) et tous ses réglages sont dans `model.js` :

| Facteur | Ce qui est calculé |
|---|---|
| Pluie déclenchante | Cumul de pluie tombé entre 5 et 18 jours avant (fenêtre propre à chaque espèce), comparé au cumul nécessaire (20 à 35 mm) |
| Humidité | Humidité du sol (0-7 cm) et de l'air sur les 5 derniers jours |
| Température | Moyenne des 7 derniers jours, corrigée de l'altitude (-0,65 °C / 100 m), plage idéale par espèce ; pénalité de gel |
| Saison | Coefficient mensuel calé sur la Provence calcaire |
| Arbres hôtes | Part de résineux, feuillus, forêt mixte, garrigue et prairie dans chaque maille de 1 km (OpenStreetMap) |
| Altitude, exposition | Plage d'altitude par espèce ; bonus en ubac (versant nord), malus en adret |

Indice final = produit de ces facteurs, de 0 à 100. Pour ajuster une espèce (ex. vos coins à sanguins sortent trop tard), modifiez `lag`, `rain`, `t` ou `season` dans `model.js`.

## Données

- `biotope.js` : forêts et prairies (© contributeurs OpenStreetMap, ODbL), altitude SRTM (OpenTopoData), villages. Généré une fois par `data/build_biotope.py`. Pour le régénérer : `cd data && python3 fetch_osm.py && python3 fetch_scrub.py && python3 build_biotope.py`.
- Météo : [Open-Meteo](https://open-meteo.com), gratuit pour un usage personnel.

## Limites

- C'est un indice de probabilité. Il ne remplace ni la connaissance du terrain ni l'identification : faites vérifier chaque récolte en cas de doute (pharmacien, société mycologique).
- L'essence des forêts n'est pas toujours renseignée dans OpenStreetMap (« essence non précisée »).
- La nature du sol (calcaire ou siliceux) n'est pas prise en compte ; autour d'Aix, il est surtout calcaire.
- En été, l'accès aux massifs des Bouches-du-Rhône et du Var peut être interdit à cause du risque d'incendie : vérifiez avant de partir.
