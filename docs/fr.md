# Qualité de l'air

Suivez l'indice de qualité de l'air des lieux de votre choix dans Gladys, avec
un appareil par lieu. Vous ajoutez un lieu en indiquant simplement son **code
postal**.

Aucun compte à créer, aucune clé d'API à saisir : les deux sources utilisées
sont ouvertes et publiques.

## Ajouter un lieu

1. Ouvrez l'écran **Configuration** de l'intégration.
2. Dans la section « Vos lieux », cliquez sur **Ajouter un lieu**.
3. Choisissez le **pays** (seule la France est disponible pour l'instant),
   saisissez le **code postal**, et éventuellement un **nom** pour ce lieu
   (« Maison », « Bureau »…). Sans nom, le lieu prend celui de la commune.
4. La réponse s'affiche sous le bouton. Si tout va bien, elle confirme l'ajout
   et vous indique le numéro du lieu.
5. Allez dans l'onglet **Découverte** : l'appareil « Qualité de l'air — _votre
   lieu_ » y attend d'être ajouté. Cliquez dessus pour le créer dans Gladys.

### Un code postal, plusieurs communes

Un code postal français est une clé de tri de La Poste, pas une zone
administrative : le code 01400 couvre par exemple une dizaine de communes.
Quand c'est le cas, l'intégration ne choisit pas à votre place — elle vous
répond la liste des communes concernées et vous demande de renseigner le champ
**Commune** avec celle que vous voulez, puis de relancer l'action. Les accents
et la casse n'ont pas d'importance : « saint-etienne » retrouve
« Saint-Étienne ».

À l'inverse, une grande ville a souvent plusieurs codes postaux (Nantes a 44000,
44100, 44200 et 44300). Ils désignent des quartiers différents : choisissez
celui du vôtre.

## Voir vos lieux

Le bouton **Afficher mes lieux** liste tout ce que l'intégration surveille :
numéro, nom, commune, code postal, département et coordonnées. Une entrée par
ligne, chacune commençant par « • ».

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
| **PM2,5** et **PM10**                         | la concentration, en µg/m³                                      |

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

Seuls PM2,5 et PM10 ont en plus une fonctionnalité de concentration : ce sont
les seuls polluants pour lesquels Gladys dispose d'une catégorie dédiée. Le
NO₂, l'O₃ et le SO₂ sont portés par leur sous-indice.

Un polluant pour lequel la source n'a **aucune valeur** ne publie rien du tout.
Une mesure absente n'est pas un air pur : écrire 1 fausserait l'historique et
pourrait déclencher une scène « l'air est redevenu bon ».

## D'où viennent les données

**Les concentrations** proviennent des données européennes de qualité de l'air
**CAMS** (Copernicus Atmosphere Monitoring Service, le modèle de référence de
l'Union européenne, opéré par le CEPMMT sur une grille d'environ 11 km),
rediffusées en open data par [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api).

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

**Les codes postaux** sont résolus en communes via l'
[API Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif/communes)
de `geo.api.gouv.fr`, l'API officielle française publiée par la DINUM sur
data.gouv.fr, construite sur le COG de l'INSEE et la base ADMIN-EXPRESS de
l'IGN.

## Réglages

- **Langue du nom des appareils** — français par défaut. Tout ce que
  l'intégration affiche suit déjà la langue de votre compte Gladys, mais le nom
  d'un appareil et de ses fonctionnalités est enregistré tel qu'il est publié :
  il faut donc le choisir ici. Un appareil déjà ajouté conserve les noms avec
  lesquels il a été créé ; supprimez-le et rajoutez-le depuis l'onglet
  Découverte pour le renommer.
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

- La couverture s'arrête aux limites du domaine européen CAMS. Un lieu situé en
  dehors est refusé au moment de l'ajout, plutôt que de créer un appareil qui
  n'aurait jamais de valeur.
- Vingt lieux au maximum.
- Un lieu n'est pas modifiable : pour changer de commune, supprimez-le et
  ajoutez-en un autre.
