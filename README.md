# Champi Aix

Carte de prévision de pousse des champignons sur Aix-en-Provence et 25 km autour, en cases de 25 m.

## Utilisation

En ligne : https://rgcomgraphic-13.github.io/champi-aix/ (sur téléphone : « Ajouter à l'écran d'accueil »).

En local : ouvrez `index.html` dans votre navigateur (double-clic). Une connexion internet est nécessaire.

- La météo est téléchargée depuis Open-Meteo à chaque ouverture : la carte est donc à jour tous les jours, sans rien faire. Si la page reste ouverte, elle se met à jour toute seule toutes les 6 heures et au changement de jour.
- Choisissez une espèce et un jour (aujourd'hui + 6 jours de prévision).
- Zoomez pour voir le quadrillage de 25 m. Fonds de carte au choix (bouton en haut à droite) : plan OpenStreetMap, plan IGN, photo aérienne IGN, relief.
- Cliquez sur une case pour son détail : indice par espèce, type de forêt (lisière, forêt clairsemée), altitude, exposition, relief (combe, crête), pluie des 20 derniers jours et des 6 prochains, humidité du sol, température. « Itinéraire » ouvre Google Maps, « Géoportail » la carte IGN.
- « Meilleurs coins du jour » liste les 10 meilleures cases, espacées d'au moins 1,5 km.
- Le bouton ◎ affiche votre position (sur le site en ligne).

## Le modèle

Le site chasseursdechampignons.com ne publie pas son algorithme. Celui-ci reprend le même principe (météo + biotope, espèce par espèce) et tous ses réglages sont dans `model.js` :

| Facteur | Ce qui est calculé |
|---|---|
| Pluie déclenchante | Cumul de pluie tombé entre 5 et 18 jours avant (fenêtre propre à chaque espèce), comparé au cumul nécessaire (20 à 35 mm) |
| Humidité | Humidité du sol (0-7 cm) et de l'air sur les 5 derniers jours |
| Température | Moyenne des 7 derniers jours, corrigée de l'altitude (-0,65 °C / 100 m), plage idéale par espèce ; pénalité de gel |
| Saison | Coefficient mensuel calé sur la Provence calcaire |
| Arbres hôtes | Essence de chaque case de 25 m : pinède, chênaie, chênaie verte, hêtraie, forêt mixte, garrigue, prairie, peupleraie… (BD Forêt IGN, complétée par OpenStreetMap) |
| Lisière, forêt clairsemée | Bonus en lisière (sanguins, coulemelles, cèpes) ; ajustement en forêt ouverte |
| Altitude, exposition, relief | Plage d'altitude par espèce ; bonus en ubac (versant nord), malus en adret ; bonus dans les combes et creux qui gardent l'humidité, malus sur les crêtes |

Indice final = produit de ces facteurs, de 0 à 100. Pour ajuster une espèce (ex. vos coins à sanguins sortent trop tard), modifiez `lag`, `rain`, `t` ou `season` dans `model.js`.

## Données

- `biotope.js` : grille de 2048 × 2048 cases de 25 m encodée en image. Essences forestières BD Forêt V2 (© IGN), forêts, garrigue et prairies OpenStreetMap (© contributeurs, ODbL), relief Terrarium (~15 m), villages. Pour le régénérer : `cd data && python3 fetch_osm.py && python3 fetch_scrub.py && python3 fetch_fine.py && python3 build_fine.py`.
- Fonds de carte : OpenStreetMap, IGN (plan et photo aérienne, Géoplateforme), OpenTopoMap.
- Météo : [Open-Meteo](https://open-meteo.com), gratuit pour un usage personnel.

## Limites

- C'est un indice de probabilité. Il ne remplace ni la connaissance du terrain ni l'identification : faites vérifier chaque récolte en cas de doute (pharmacien, société mycologique).
- La BD Forêt décrit des parcelles d'au moins 0,5 ha : un bosquet isolé peut manquer, et l'essence indiquée est la dominante de la parcelle.
- La météo vient de points espacés d'environ 10 km : deux cases voisines ont la même pluie ; ce qui les distingue, c'est le biotope.
- La nature du sol (calcaire ou siliceux) n'est pas prise en compte ; autour d'Aix, il est surtout calcaire.
- En été, l'accès aux massifs des Bouches-du-Rhône et du Var peut être interdit à cause du risque d'incendie : vérifiez avant de partir.
