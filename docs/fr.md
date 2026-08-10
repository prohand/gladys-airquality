# Qualité de l'air

Suivez l'indice de qualité de l'air des lieux de votre choix dans Gladys, avec
un appareil par lieu. Vous ajoutez vos **maisons Gladys en un clic**, ou un lieu
en saisissant simplement le nom de sa **commune**, **n'importe où dans le
monde**.

Aucun compte à créer, aucune clé d'API à saisir : les deux sources utilisées
sont ouvertes et publiques.

## Ajouter vos maisons Gladys, en un clic

Vous avez déjà dit à Gladys où vous habitez : c'est la carte de **Réglages >
Maisons**. Le bouton **« Ajouter mes maisons Gladys »** lit ces maisons et crée
un lieu pour chacune qui n'est pas déjà surveillée — aucune commune à saisir.

Trois choses à savoir :

- **L'accès est une autorisation.** L'endroit où vous vivez est une donnée
  personnelle : Gladys ne la partage que si vous l'avez accepté sur l'écran
  d'installation de l'intégration. Si le bouton répond que l'accès est refusé,
  supprimez puis réinstallez l'intégration en acceptant la demande affichée.
- **Une maison sans position sur la carte n'a pas de coordonnées.** Elle est
  nommée dans la réponse, et il suffit de la placer dans Réglages > Maisons puis
  de relancer l'action.
- **Ce n'est pas une synchronisation.** Les maisons sont lues au moment du clic.
  Le lieu obtenu est un lieu ordinaire, que vous renommez et supprimez comme les
  autres, et une maison déplacée dans Gladys ensuite ne déplace pas son lieu.

Relancer l'action est sans risque : une maison déjà surveillée est signalée, pas
ajoutée une deuxième fois. Un lieu venu d'une maison n'a pas de libellé
d'adresse : la liste affiche son nom et son point, car le géocodeur ne sait pas
nommer la commune qui contient un point.

## Ajouter un lieu

1. Ouvrez l'écran **Configuration** de l'intégration.
2. Dans la section « Vos lieux », cliquez sur **Ajouter un lieu**.
3. Saisissez la **commune** — « Nantes », « Montréal », « Kyoto » — et
   éventuellement un **nom** pour ce lieu (« Maison », « Bureau »…). Sans nom,
   le lieu prend celui de la commune trouvée.
4. La réponse s'affiche sous le bouton. Si tout va bien, elle confirme l'ajout
   et vous indique le numéro du lieu.
5. Allez dans l'onglet **Découverte** : l'appareil « Qualité de l'air — _votre
   lieu_ » y attend d'être ajouté. Cliquez dessus pour le créer dans Gladys.

### Un nom, plusieurs communes

La plupart des noms de communes sont partagés : il y a plusieurs Montauban rien
qu'en France, un Paris au Texas et un Springfield par État américain. Quand
c'est le cas, l'intégration ne choisit pas à votre place — elle vous répond la
liste des lieux trouvés et vous demande de préciser.

Précisez **après une virgule** : la région, le département, l'État, le pays ou
le code postal, dans n'importe quel ordre.

- « Montauban, Tarn-et-Garonne »
- « Springfield, Illinois »
- « Nantes, 44000 »
- « Paris, France »

Les accents et la casse n'ont pas d'importance : « saint-etienne » retrouve
« Saint-Étienne ».

### Ou directement un point

Si le géocodeur ne connaît pas votre hameau, ou si vous voulez un point précis
lu sur une carte, renseignez plutôt la **latitude** et la **longitude** (degrés
décimaux WGS-84). Les deux vont ensemble : une seule ne fait pas un point. Elles
l'emportent alors sur la commune saisie, qui ne sert plus que de libellé.

## Voir vos lieux

Le bouton **Afficher mes lieux** liste tout ce que l'intégration surveille :
numéro, nom, lieu (commune, région, pays) et coordonnées. Une entrée par ligne,
chacune commençant par « • ».

Ces **numéros sont ceux qu'utilise la suppression** : lancez cette action avant
de supprimer un lieu pour être sûr du numéro.

## Supprimer un lieu

1. Cliquez sur **Supprimer un lieu**.
2. Choisissez le **numéro** du lieu dans la liste déroulante.
3. Lancez l'action une première fois **sans cocher** la case : la réponse vous
   dit quel lieu serait supprimé. Vérifiez que c'est le bon.
4. Cochez **Je confirme la suppression** et relancez.

Le lieu disparaît aussitôt de l'onglet Découverte.

> **L'appareil Gladys, lui, n'est pas supprimé.** Une intégration n'a pas le
> droit de supprimer un appareil que vous avez créé — elle peut seulement
> cesser de le proposer. Si vous aviez ajouté l'appareil de ce lieu, la réponse
> vous le rappelle en le nommant : supprimez-le vous-même depuis l'onglet
> **Appareils** de l'intégration, sinon il restera là sans plus jamais se mettre
> à jour.

Attention aussi à la renumérotation : si vous supprimez le lieu 2 sur quatre,
les lieux 3 et 4 deviennent les lieux 2 et 3. Relancez « Afficher mes lieux »
avant d'en supprimer un autre.

## Ce que mesure l'appareil

Chaque appareil expose :

| Fonctionnalité                                | Ce qu'elle vaut                                                 |
| --------------------------------------------- | --------------------------------------------------------------- |
| **Indice de qualité de l'air**                | de 1 à 6 — c'est celle à utiliser dans une scène                |
| **Qualité de l'air (texte)**                  | Bon, Moyen, Dégradé, Mauvais, Très mauvais, Extrêmement mauvais |
| **Polluant dominant**                         | le polluant qui a déterminé l'indice                            |
| **Sous-indice PM2,5 / PM10 / NO₂ / O₃ / SO₂** | de 1 à 6, polluant par polluant                                 |
| **PM2,5 / PM10 / NO₂ / O₃ / SO₂**             | la concentration, en µg/m³                                      |
| **Dernière mise à jour des données**          | l'heure de la donnée, en heure locale du lieu                   |

Les six classes de l'indice :

| Indice | Qualité de l'air    |
| ------ | ------------------- |
| 1      | Bon                 |
| 2      | Moyen               |
| 3      | Dégradé             |
| 4      | Mauvais             |
| 5      | Très mauvais        |
| 6      | Extrêmement mauvais |

L'indice global est celui du **polluant le plus mauvais** — c'est ainsi que
l'indice ATMO comme l'indice européen sont définis : un seul polluant dégradé
suffit à dégrader l'air.

À côté de son sous-indice, chaque polluant expose aussi sa **concentration brute
en µg/m³** : un sous-indice est une classe, et une classe masque ce qui se passe
à l'intérieur — un après-midi d'ozone qui monte de 55 à 128 µg/m³ ne quitte
jamais la classe 3. Gladys ne dispose d'une catégorie dédiée que pour les PM2,5
et les PM10, donc le NO₂, l'O₃ et le SO₂ apparaissent dans la catégorie
« Inconnu » : ils affichent leur valeur et leur unité comme les autres, ils se
tracent en courbe comme les autres, ils n'ont simplement pas d'icône de
catégorie propre.

La **dernière mise à jour des données** est l'heure de l'analyse CAMS pour ce
lieu, pas celle du dernier passage de l'intégration : le modèle tourne toutes
les heures, donc rafraîchir plus souvent ne change pas cette heure. Elle est
affichée en **heure locale du lieu** (suivie de son fuseau, `CEST`, `GMT+9`…),
et c'est pourquoi elle est portée par chaque appareil : deux lieux peuvent
légitimement afficher deux heures différentes.

Un polluant pour lequel la source n'a **aucune valeur** ne publie rien du tout.
Une mesure absente n'est pas un air pur : écrire 1 fausserait l'historique et
pourrait déclencher une scène « l'air est redevenu bon ».

## D'où viennent les données

**Les concentrations** proviennent des données **CAMS** (Copernicus Atmosphere
Monitoring Service, le service atmosphérique de l'Union européenne, opéré par le
CEPMMT), rediffusées en open data par
[Open-Meteo](https://open-meteo.com/en/docs/air-quality-api). Deux modèles, et
l'intégration choisit selon l'endroit :

| Où est le lieu | Modèle lu     | Résolution |
| -------------- | ------------- | ---------- |
| En Europe      | CAMS européen | ~11 km     |
| Ailleurs       | CAMS mondial  | ~40 km     |

Les deux publient les cinq mêmes polluants réglementés. Un lieu reste toujours
sur le même modèle : son historique est donc une seule série, pas deux jeux de
données superposés.

Le site [Atmo France](https://www.atmo-france.org/) est la référence pour
l'indice ATMO français, mais son API demande un compte et un jeton
d'authentification que chaque utilisateur devrait créer avant de pouvoir se
servir de l'intégration. Le choix s'est donc porté sur une source officielle
ouverte et sans authentification.

**L'indice** est calculé à partir de ces concentrations avec les seuils de
l'**indice européen de qualité de l'air** (Agence européenne pour
l'environnement). Ce sont, seuil pour seuil, ceux de l'**indice ATMO** français
depuis l'arrêté du 10 juillet 2020, entré en vigueur le 1er janvier 2021, qui a
aligné l'indice national sur l'indice européen : six classes, les cinq mêmes
polluants réglementés, les mêmes bornes.

Une différence à connaître : l'indice ATMO publié est **journalier** (moyenne du
jour pour les particules, maximum horaire pour les gaz), alors que cette
intégration lit l'**heure en cours**, comme le fait l'indice européen. La valeur
réagit donc dans l'heure — ce qu'on attend d'une scène domotique — plutôt que de
reproduire le bulletin ATMO du jour.

**Les communes** sont résolues en coordonnées par l'
[API de géocodage Open-Meteo](https://open-meteo.com/en/docs/geocoding-api),
adossée à la base **GeoNames**, qui couvre le monde entier. Ouverte, sans compte
ni clé d'API elle non plus.

## Réglages

- **Langue du nom des appareils** — français par défaut. Tout ce que
  l'intégration affiche suit déjà la langue de votre compte Gladys, mais le nom
  d'un appareil et de ses fonctionnalités est enregistré tel qu'il est publié :
  il faut donc le choisir ici. Un appareil déjà ajouté conserve les noms avec
  lesquels il a été créé ; supprimez-le et rajoutez-le depuis l'onglet
  Découverte pour le renommer. Ce réglage est aussi la langue dans laquelle le
  géocodeur répond : « Munich » ou « München » pour la même ville.
- **Intervalle de rafraîchissement** — 1 heure par défaut (entre 15 minutes et
  24 heures). L'analyse CAMS est produite une fois par heure : descendre plus bas
  n'apporte rien.

## Vérifier que tout fonctionne

Le bouton **Tester la source de qualité de l'air** interroge la source en direct
pour **tous** vos lieux et affiche l'indice de chacun, dans le même format que
la liste. C'est le moyen le plus rapide de voir si un lieu pose problème et
pourquoi.

L'écran **Supervision** affiche l'état applicatif de l'intégration : il passe au
rouge, avec la raison, si un lieu ne peut plus être lu.

## Limites

- **L'indice est l'indice européen, appliqué partout.** Hors d'Europe, ce n'est
  donc pas l'indice national local : un lieu aux États-Unis, en Chine ou en Inde
  est mesuré avec les seuils européens, pas avec l'US AQI, l'indice chinois ou le
  CAQI indien. Les concentrations, elles, restent les concentrations.
- Hors d'Europe, le modèle est **quatre fois plus grossier** (~40 km contre
  ~11 km) : il décrit bien un fond régional, moins bien une rue.
- Vingt lieux au maximum.
- Un lieu n'est pas modifiable : pour changer de commune, supprimez-le et
  ajoutez-en un autre.
