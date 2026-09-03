# WordCode — README

> **Document de référence unique.** Toute décision de code doit s'y conformer.
> Si une information manque ici, elle doit y être ajoutée avant d'être codée.
> **Nom de l'application : WordCode** (nom de travail).
> Clés localStorage : `wordcode_state`, `wordcode_perso`.

---

## SOMMAIRE

1. [Principe](#1-principe)
2. [Sources de vocabulaire](#2-sources-de-vocabulaire)
3. [Boucle d'apprentissage](#3-boucle-dapprentissage)
4. [Moteur de répétition espacée](#4-moteur-de-répétition-espacée)
5. [Schémas de données](#5-schémas-de-données)
6. [Stockage](#6-stockage)
7. [Contenu enfichable](#7-contenu-enfichable)
8. [Architecture technique](#8-architecture-technique)
9. [Design tokens](#9-design-tokens)
10. [Inventaire des composants](#10-inventaire-des-composants)
11. [Écrans](#11-écrans)
12. [Services](#12-services)
13. [Générateur de grilles](#13-générateur-de-grilles)
14. [API externe](#14-api-externe)
15. [Règles anti-duplication](#15-règles-anti-duplication)
16. [Roadmap](#16-roadmap)
17. [Spécifications d'interaction](#17-spécifications-dinteraction)
18. [Points ouverts](#18-points-ouverts)

---

## 1. Principe

Application d'apprentissage du vocabulaire anglais pour francophone. Le moteur
de rétention est un **codeword** : grille où chaque lettre est remplacée par un
chiffre, constant sur toute la grille.

**Ce n'est pas un jeu de mots croisés.** Un codeword seul n'enseigne rien : il
fait *retrouver* un mot par déduction logique sans en transmettre le sens.
La grille est l'examen, pas le cours. L'apprentissage se fait avant et après.

### Positionnement

| Jeux de codeword existants | Cette app |
|---|---|
| Écran de fin passif | Écran de fin → rappel actif obligatoire |
| Aucune trace des mots joués | Répétition espacée (Leitner) |
| Pas de traduction | Traduction contextuelle à la demande |
| Grilles aléatoires | Progression par palier de fréquence |
| Pour anglophones natifs | Pour apprenant francophone |

### Contraintes produit

- **100% hors ligne** sauf saisie manuelle (seul appel API)
- **Mono-appareil**, localStorage, avec export/import manuel obligatoire
- **Publié sur GitHub Pages** — pas de build step, pas de serveur
- **Component-driven** — chaque élément d'interface existe en un seul exemplaire

---

## 2. Sources de vocabulaire

Six filières alimentent un moteur unique. Le champ `source` pilote le mode de
jeu, l'écran de découverte et l'éligibilité à la grille.

| `source` | Origine | Éligible grille |
|---|---|---|
| `palier` | listes de fréquence prédéfinies | oui |
| `verbe` | verbes irréguliers | non (mode dédié) |
| `phrasal` | phrasal verbs | non |
| `expression` | idiomes, collocations, formules | non |
| `perso` | saisie manuelle par l'utilisateur | si conforme |
| `organique` | mot tapé dans un indice pendant une grille | si conforme |

### 2.1 Paliers de fréquence

Source : **NGSL** (New General Service List), 2800 mots couvrant ~92% de
l'anglais courant. Découpage en **paliers de 50 mots** — une session doit
pouvoir se terminer.

**Traitement des mots-outils.** Le top 100 en fréquence (*the, of, and, to, a,
in, that, is*) est déjà connu, ne se traduit pas isolément et ne peut pas être
mis en indice. Ces mots passent **uniquement par la phrase cachée**, jamais par
les indices. La déduction par les chiffres suffit à les exposer.

Déblocage de palier : **80% des mots en boîte 3+**, pas la complétion.

### 2.2 Verbes irréguliers

Morphologie, pas vocabulaire : trois formes pour une unité de sens. Un codeword
ferait deviner WENT sans jamais le relier à GO — **mode dédié obligatoire**.

Apprentissage **par famille de patterns**, pas par ordre alphabétique :

- **G1 — Invariables (A-A-A)** : cut, put, let, set, hit, hurt, cost, read
- **G2 — En -ought/-aught** : think, bring, buy, catch, teach, fight
- **G3 — A-B-B** : have, say, make, get, find, tell, sell, hold, keep, leave,
  feel, lose, mean, meet, pay, sit, stand, understand, send, spend, build,
  sleep, hear, win, lead
- **G4 — A-B-C** : be, do, go, see, take, give, know, come, write, speak,
  break, choose, drive, eat, fall, forget, grow, begin, drink, run, show, wear

~60 verbes couvrant la majorité des occurrences réelles.

### 2.3 Phrasal verbs

**Priorité maximale.** Point noir de tous les francophones : `get` + particule
donne *get up, get on, get over, get out, get in, get along, get through* —
sept sens sans rapport, aucun devinable, et ils saturent l'anglais parlé.
Ce n'est pas du décor, c'est du vocabulaire de base déguisé.

Source : **PHaVE List** — 150 phrasal verbs classés par fréquence.

### 2.4 Expressions

| Famille | Exemple | Traitement |
|---|---|---|
| `idiome` | break the ice | phrase cachée type A |
| `collocation` | make a decision | exercice à trous |
| `formule` | How's it going? | bloc mémorisé tel quel |

**Filtre obligatoire :** uniquement ce qui apparaît dans un corpus oral réel.
Les listes « 100 idiomes anglais » sont pleines d'expressions jamais employées
(*it's raining cats and dogs*). Source : Simpson-Vlach & Ellis, formulaic
sequences.

Ordre d'apprentissage : phrasal verbs (150) → formules (50) → collocations
(100) → idiomes (50). **350 unités suffisent.**

### 2.5 Saisie manuelle

Champ libre. L'utilisateur tape un mot ou une phrase rencontrés en lecture.
L'app traduit **la phrase entière**, l'utilisateur sélectionne ce qu'il garde.

Traduire la phrase et non le mot isolé donne : le sens contextuel
(*to run a business* ≠ courir), la construction grammaticale
(*reluctant **to** + verbe*), un ancrage épisodique, et un exercice à trous
réutilisable sans contenu supplémentaire.

**Seul point d'appel API de l'application.**

### 2.6 Organique

Pendant une grille, les indices sont en anglais et **chaque mot est tappable**.
Un tap affiche la traduction contextuelle (pré-calculée, aucun appel réseau).
Un second tap sur `+` ajoute le mot à la file de découverte.

Voir §3.5 pour les garde-fous.

---

## 3. Boucle d'apprentissage

Ordre non négociable : **on apprend d'abord, on joue ensuite.**

```
DÉCOUVERTE  →  ANCRAGE  →  GRILLE  →  RAPPEL ACTIF  →  LEITNER
  (2 min)      (1 min)     (4 min)      (1 min)      (J+1, J+3…)
reconnaître    valider     déduire      produire        revoir
```

Durée cible d'une session : **~8 minutes**.

### 3.1 Phase 1 — Découverte

Les mots nouveaux sont présentés **avant** la grille, un par écran.
Trois canaux minimum : écrit, audio, contexte de phrase.

La file de découverte se remplit dans cet ordre :
1. mots ajoutés organiquement lors des sessions précédentes
2. mots saisis manuellement
3. mots du palier courant

Les mots que l'utilisateur a réellement bloqués passent en priorité.

### 3.2 Phase 2 — Ancrage

QCM de reconnaissance immédiat sur les mots découverts. 4 options,
distracteurs proches graphiquement (*MENU / MEAL / MEET / MELT*).
Objectif : consolider, pas tester. Doit être facile.

### 3.3 Phase 3 — Grille

Le codeword. Ayant vu les mots en phase 1, la déduction devient de la
**reconnaissance** — c'est le mécanisme qui produit la mémorisation.

**Composition obligatoire :**

| Nombre | Origine |
|---|---|
| 2 | mots nouveaux (vus en phase 1) |
| 3 | mots déjà acquis (révision Leitner) |

Jamais 5 nouveaux : la grille devient infaisable et décourageante.
Les 3 anciens servent d'appuis pour débloquer l'alphabet.

> **10 mots/semaine réellement acquis > 50 mots survolés.**

### 3.4 Phase 4 — Rappel actif

FR → EN à taper, sans chiffres, sans aide. Le seul vrai test.
Réussi → boîte +1. Raté → retour boîte 1.

Pour les mots `perso` et `organique`, l'exercice utilise la **phrase source à
trous** plutôt que la traduction isolée.

**Cette phase est obligatoire.** Sans elle, l'app est un jeu de mots croisés.

### 3.5 Indices anglais et tap-to-translate

Tous les indices sont en anglais. Décision fondée sur deux arguments :

- un indice FR duplique la phase 4 (même exercice deux fois)
- un indice EN fait lire, comprendre et produire — et chaque indice devient une
  révision passive gratuite de 4-5 mots

**Garde-fous contre l'inondation du stock :**

| Action | Effet |
|---|---|
| Tap sur un mot | Traduction affichée. **Rien n'est enregistré.** |
| Tap sur `+` | Le mot entre en file de découverte |

Consulter est gratuit et illimité. Ajouter est délibéré.
**Plafond : 3 ajouts par partie.** Au-delà, l'app propose de reporter.

**Timing :** un mot ajouté pendant la grille ne peut pas être inséré dans la
session en cours. Il va en file d'attente et sera découvert à la session
suivante. Écran de fin de session :

```
3 mots ajoutés aujourd'hui
  thirsty   assoiffé
  gone      parti
  butter    beurre
Tu les découvriras demain.
```

**Expressions :** la zone tappable est le **segment**, pas le mot. Tap sur
*give* dans *don't give up* doit renvoyer « abandonner », pas « donner ».
Le découpage est défini à la génération du contenu, jamais détecté à
l'exécution.

### 3.6 Modes de jeu par filière

| Filière | Modes |
|---|---|
| `palier` | découverte, QCM, grille, rappel actif |
| `verbe` | découverte, saisie des 3 formes, QCM de pattern |
| `phrasal` | complétion du mot-clé, remise en ordre, discrimination de particule |
| `expression` | phrase cachée, exercice à trous |
| `perso` / `organique` | découverte, QCM, phrase source à trous |

**Discrimination de particule** (le mode le plus formateur) :
```
Il s'est remis de sa maladie.
He got _____ his illness.
[ over ]  [ up ]  [ through ]  [ out ]
```

Le rappel actif « tape l'expression entière » est trop punitif : ne jamais
l'utiliser pour `phrasal` et `expression`.

---

## 4. Moteur de répétition espacée

Leitner à 5 boîtes.

| Boîte | Délai |
|---|---|
| 1 | 1 jour |
| 2 | 3 jours |
| 3 | 7 jours |
| 4 | 21 jours |
| 5 | 365 jours (acquis) |

```
succès → boite++, prochaine_revision = today + DELAIS[boite]
échec  → boite = 1, prochaine_revision = today + 1
```

**Requête unique**, commune aux six filières :
```js
words.filter(w => w.statut === "actif" && w.prochaine_revision <= today)
     .sort((a,b) => a.prochaine_revision - b.prochaine_revision)
```

Pas de séparation « un jour verbes, un jour vocabulaire » : le mélange est plus
efficace pour la mémorisation.

**Signal de maîtrise :** si l'utilisateur a eu besoin de la traduction FR pour
résoudre un mot, ce mot **ne monte pas d'une boîte**. Donnée gratuite, sans
exercice supplémentaire.

**Verbes irréguliers :** le Leitner suit chaque forme séparément, sinon GO est
validé alors que GONE est raté. Un verbe apparaît jusqu'à deux fois dans la
file. Il est `acquis` quand les deux formes sont en boîte 5.

---

## 5. Schémas de données

### 5.1 `word` — entité unifiée

Une seule structure encaisse les six sources. Les champs non pertinents restent
`null`. Objectif : **un seul moteur de révision, un seul écran de rappel**.

```json
{
  "id": "w_00147",
  "en": "reluctant",
  "fr": "réticent",
  "type": "adj",
  "source": "palier",
  "phonetique": "/rɪˈlʌk.tənt/",

  "famille": "reluctant",
  "sens_index": 1,

  "rang_freq": 2847,
  "palier": 6,
  "themes": ["emotion", "opinion"],
  "def_en": "not willing to do something",
  "exemple_en": "She was reluctant to speak.",
  "exemple_fr": "Elle était réticente à parler.",

  "phrase_en": null,
  "phrase_fr": null,
  "date_capture": null,
  "origine_partie": null,

  "preterit": null,
  "participe": null,
  "groupe_verbe": null,

  "famille_expr": null,
  "verbe_base": null,
  "particule": null,
  "litteral": null,

  "eligible_grille": true,
  "eligible_phrase_cachee": false
}
```

**Champs — règles :**

| Champ | Règle |
|---|---|
| `id` | préfixe : `w_` mot, `v_` verbe, `e_` expression, `p_` perso |
| `type` | `n / v / adj / adv / prep / conj / pron / det` — filtre les mots-outils hors indices |
| `famille` + `sens_index` | polysémie : **une entrée par sens** (voir §5.2) |
| `exemple_*` | généré, pour la phase Découverte |
| `phrase_*` | capturé par l'utilisateur, sert d'exercice à trous |
| `litteral` | sens mot-à-mot d'une expression — affiché à côté du vrai sens, c'est ce qui débloque la mémorisation |
| `eligible_grille` | calculé : longueur 3-8 ET `[A-Z]` uniquement ET sans espace/tiret |
| `eligible_phrase_cachee` | 3 à 6 mots, lettres simples |

### 5.2 Polysémie

**Une entrée par sens.** Argument décisif : en rappel actif, une entrée
multi-sens n'affiche rien de testable et le Leitner ne peut pas suivre
« connaît *droite* mais pas *correct* ».

**Mais ne pas créer tous les sens d'office** — l'utilisateur apprendrait des
sens jamais rencontrés.

| Moment | Action |
|---|---|
| Import du palier | 1 entrée, le sens le plus fréquent |
| Capture d'un autre sens | nouvelle entrée, même `famille` |

Détection de doublon à la saisie :
> « Tu connais déjà **right** = droite. Ajouter le sens "correct" ? »

En phase Découverte, afficher : *« autre sens déjà connu : droite »*.
Consolide au lieu de créer de la confusion.

### 5.3 `partie`

```json
{
  "id": "p_012",
  "type": "A",
  "palier_min": 1,

  "phrase_en": "WHEN LIFE GIVES YOU LEMONS",
  "phrase_fr": "Quand la vie te donne des citrons",
  "contexte_fr": "Proverbe américain. Rester optimiste face aux difficultés. Équivalent : faire de nécessité vertu.",

  "mots": ["w_00012", "w_00089", "w_00301", "w_00455", "w_00877"],
  "mot_amorce": "w_00089",
  "lettres_offertes": ["E", "L", "O", "V"],
  "alphabet": { "1": "W", "2": "H", "4": "E", "6": "I" },

  "indices": {
    "w_00012": {
      "en": "You drink it when you are thirsty",
      "fr": "Eau",
      "segments": [
        { "txt": "You",      "trad": null },
        { "txt": "drink",    "trad": "boire",     "ref": "w_00089" },
        { "txt": "it",       "trad": null },
        { "txt": "when",     "trad": "quand",     "ref": "w_00003" },
        { "txt": "you are",  "trad": "tu es",     "ref": null },
        { "txt": "thirsty",  "trad": "assoiffé",  "ref": "w_01247" }
      ]
    }
  },

  "verifie": true
}
```

**Règles :**

- La partie **référence** les mots par id, ne les duplique jamais
- `indices` est un dictionnaire séparé : le même mot n'a pas le même indice
  partout, ça évite la répétition d'une partie à l'autre
- `alphabet` est **pré-calculé**. L'app ne génère rien à l'exécution
- `segments` : `trad: null` → mot-outil non tappable ; `ref` → id existant, ou
  `null` si le mot n'est pas au catalogue (création à l'ajout)
- `verifie` : flag manuel. **Une partie non vérifiée n'est jamais servie**

**Type de partie :**

| Type | Phrase cachée | Contrainte sémantique sur les mots | Disponible |
|---|---|---|---|
| `A` | idiome ou proverbe | non | palier 1+ |
| `B` | fait historique/scientifique | oui (champ lexical) | palier 3+ |

Le type B attend le palier 3 car trois contraintes simultanées (alphabétique +
fréquence + sémantique) sont insolubles avec 50 mots disponibles.

> **Constat de conception :** dans les jeux de référence, les mots de la grille
> n'ont aucun lien sémantique avec la phrase. Le lien est purement alphabétique
> — la phrase sert de réservoir de lettres. C'est ce qui rend la génération
> possible. Le type B est un ajout, pas la norme.

### 5.4 `state` — données mutables

Stocké en localStorage. **Clés courtes** : sur 2800 mots ça divise le poids par
trois (~200 Ko au lieu de 600).

```json
{
  "v": 1,
  "words": {
    "w_00147": { "b": 3, "r": "2026-09-09", "s": 4, "e": 1, "d": "2026-09-02", "st": "actif" }
  },
  "verbes": {
    "v_0012": {
      "preterit":  { "b": 2, "r": "2026-09-04", "s": 3, "e": 0 },
      "participe": { "b": 1, "r": "2026-09-03", "s": 1, "e": 2 }
    }
  },
  "progression": {
    "palier_actuel": 2,
    "paliers_valides": [1],
    "groupe_verbe_actuel": 1,
    "parties_jouees": ["p_001", "p_004"],
    "file_decouverte": ["w_01247", "w_00891"],
    "ajouts_aujourdhui": 2,
    "streak": 7,
    "derniere_session": "2026-09-02",
    "derniere_sauvegarde": "2026-08-15",
    "objectif_quotidien": 5
  },
  "perso": [ /* objets word complets, source: perso|organique */ ]
}
```

| Clé | Signification |
|---|---|
| `b` | boîte Leitner (1-5) |
| `r` | prochaine révision (ISO date) |
| `s` | nb succès |
| `e` | nb échecs |
| `d` | date dernière réponse |
| `st` | statut : `nouveau` / `actif` / `acquis` / `suspendu` |

`statut` évite toute suppression : un mot mis de côté est `suspendu`, pas effacé.

---

## 6. Stockage

| Donnée | Nature | Emplacement |
|---|---|---|
| mots des paliers | statique, immuable | `/content/paliers/*.json` |
| parties | statique, immuable | `/content/parties/*.json` |
| verbes | statique | `/content/verbes.json` |
| phrasal verbs | statique | `/content/phrasal.json` |
| expressions | statique | `/content/expressions.json` |
| état de progression | mutable | `localStorage['wordcode_state']` |
| mots perso | mutable | `localStorage['wordcode_perso']` |

### Export / import — obligatoire

localStorage se vide au nettoyage du navigateur. **Sans export, des mois de
progression disparaissent.**

- Bouton « Sauvegarder ma progression » → télécharge `backup-YYYY-MM-DD.json`
- Bouton « Restaurer » → upload, validation du champ `v`, remplacement
- Rappel automatique tous les 30 jours, calculé sur
  `progression.derniere_sauvegarde` (§5.4). Pas de rappel tant qu'il n'y a
  rien à perdre.

**Deux clés, un seul objet.** En mémoire l'état est l'objet unique de la §5.4,
`perso` compris. À l'écriture il est scindé : `wordcode_state` reçoit `v`,
`words`, `verbes` et `progression`, `wordcode_perso` reçoit le tableau `perso`.
La lecture recompose l'objet. C'est ce qui réconcilie la §5.4 et le tableau
des emplacements ci-dessus.

### Chargement

Au boot : chargement du manifeste, puis des paliers **débloqués uniquement**.
Ne jamais charger 2800 mots si l'utilisateur est au palier 2.

---

## 7. Contenu enfichable

**Objectif : ajouter un palier = déposer un fichier + une ligne de manifeste.
Aucune modification de code.**

### Arborescence

```
/content
  manifest.json
  /paliers
    palier-01.json
    palier-02.json
  /parties
    parties-01.json
    parties-02.json
  verbes.json
  phrasal.json
  expressions.json
```

### `manifest.json`

Nécessaire car un hébergement statique ne permet pas de lister un dossier.

```json
{
  "version": 1,
  "paliers": [
    { "id": 1, "fichier": "paliers/palier-01.json", "parties": "parties/parties-01.json", "titre": "Les 50 mots essentiels", "nb_mots": 50 },
    { "id": 2, "fichier": "paliers/palier-02.json", "parties": "parties/parties-02.json", "titre": "Vie quotidienne", "nb_mots": 50 }
  ],
  "verbes": "verbes.json",
  "phrasal": "phrasal.json",
  "expressions": "expressions.json"
}
```

### `palier-XX.json`

```json
{
  "palier": 1,
  "titre": "Les 50 mots essentiels",
  "version": 1,
  "mots": [ /* tableau d'objets word */ ]
}
```

### `parties-XX.json`

```json
{
  "palier": 1,
  "version": 1,
  "parties": [ /* tableau d'objets partie */ ]
}
```

### Validation au chargement

`contentLoader` doit **rejeter proprement** un fichier invalide et l'afficher
dans l'écran Réglages, sans casser l'app :

- champs obligatoires présents
- tous les `mots[]` d'une partie existent dans le palier ou un palier antérieur
- `alphabet` cohérent avec `phrase_en` et les mots
- `verifie: true`

**Fichier déclaré mais absent.** Une entrée du manifeste dont le fichier renvoie
404 est traitée comme **filière non encore disponible** : pas d'erreur, pas de
message, la filière est simplement masquée dans l'interface. C'est le cas normal
de `verbes.json`, `phrasal.json` et `expressions.json` tant que leur contenu
n'est pas produit. En revanche, un fichier **présent mais malformé** est une
erreur : il est écarté et signalé dans l'écran Réglages.

---

## 8. Architecture technique

### Stack

- **HTML / CSS / JS vanilla**, modules ES natifs — pas de build step
- **GitHub Pages** comme hébergement
- **Vercel serverless** pour l'unique appel Gemini (clé jamais exposée)
- **Web Speech API** (`SpeechSynthesis`) pour l'audio — gratuit, suffisant

### Arborescence

```
/index.html
/app.js                    point d'entrée, routeur
/styles
  tokens.css               variables — SEULE source de vérité visuelle
  base.css                 reset, typographie
  components.css           styles des composants
/components
  /atoms
  /molecules
  /organisms
/screens
/services
/content
/tools
  generateur.js            script Node, hors application
```

### Convention de composant

Un composant = **un fichier**, exportant **une fonction factory** qui retourne
un élément DOM. Pas de framework, pas de classe.

```js
// components/atoms/button.js
export function Button({ label, variant = "primary", icon = null,
                         disabled = false, onClick }) {
  const el = document.createElement("button");
  el.className = `btn btn--${variant}`;
  // ...
  return el;
}
```

**Règles :**
- un composant ne lit **jamais** le store directement — tout passe par les props
- un composant n'écrit **jamais** dans le store — il émet via `onXxx`
- aucun style inline : uniquement des classes définies dans `components.css`
- aucune couleur en dur : uniquement des variables de `tokens.css`

---

## 9. Design tokens

`styles/tokens.css` est la **seule** source de vérité visuelle. Aucune valeur
en dur ailleurs dans le projet.

```css
:root {
  /* Couleurs */
  --c-bg:            #f4f7fb;
  --c-surface:       #ffffff;
  --c-surface-alt:   #eaf0f8;
  --c-text:          #2c3e56;
  --c-text-muted:    #7a8ca3;
  --c-primary:       #5b8def;
  --c-primary-dark:  #3f6fd1;
  --c-accent:        #ffb340;
  --c-success:       #3fbf7f;
  --c-error:         #e5544b;
  --c-tile:          #ffffff;
  --c-tile-filled:   #dcecff;
  --c-tile-active:   #ffe4b0;
  --c-tile-offered:  #d6f2e4;

  /* Espacements */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;
  --sp-4: 16px; --sp-5: 24px; --sp-6: 32px; --sp-7: 48px;

  /* Rayons */
  --r-sm: 6px; --r-md: 12px; --r-lg: 20px; --r-full: 999px;

  /* Typographie */
  --f-base: -apple-system, "Segoe UI", Roboto, sans-serif;
  --fs-xs: 12px; --fs-sm: 14px; --fs-md: 16px;
  --fs-lg: 20px; --fs-xl: 26px; --fs-2xl: 34px;
  --fw-regular: 400; --fw-medium: 600; --fw-bold: 800;

  /* Ombres */
  --sh-sm: 0 1px 3px rgba(44,62,86,.10);
  --sh-md: 0 4px 12px rgba(44,62,86,.12);
  --sh-lg: 0 8px 28px rgba(44,62,86,.16);

  /* Couches */
  --z-popover: 100; --z-keyboard: 200; --z-modal: 300; --z-toast: 400;

  /* Cibles tactiles */
  --touch-min: 44px;
}
```

Cible : **mobile portrait en priorité**. Toute cible tactile ≥ `--touch-min`.

---

## 10. Inventaire des composants

**Liste fermée.** Tout besoin d'interface doit se résoudre avec un composant de
cette liste, ou par l'ajout documenté d'un nouveau composant dans ce README.
**Il est interdit de créer un composant non listé ici.**

### 10.1 Atoms

| Composant | Fichier | Props | Usage |
|---|---|---|---|
| `Button` | `atoms/button.js` | `label, variant(primary\|secondary\|ghost\|danger), icon, disabled, fullWidth, onClick` | **Tout** bouton textuel de l'app |
| `IconButton` | `atoms/icon-button.js` | `icon, label(a11y), variant, badge, onClick` | Accueil, menu, audio, indice |
| `Tile` | `atoms/tile.js` | `letter, number, state(empty\|filled\|active\|offered\|error\|revealed), onClick` | **Toute** case lettre : grille, indices, phrase cachée |
| `Chip` | `atoms/chip.js` | `label, variant(theme\|palier\|source)` | Thèmes, badges de filière |
| `ProgressDots` | `atoms/progress-dots.js` | `total, current` | Progression dans une phase (`○ ○ ● ○ ○`) |
| `ProgressBar` | `atoms/progress-bar.js` | `value, max, variant` | Progression de palier |
| `Counter` | `atoms/counter.js` | `value, icon, label` | Streak, compteur de session |
| `Spinner` | `atoms/spinner.js` | `size` | Attente API (saisie manuelle uniquement) |
| `Toast` | `atoms/toast.js` | `message, variant(info\|success\|error), duration` | Confirmations, erreurs |
| `Divider` | `atoms/divider.js` | `spacing` | Séparation de sections |

### 10.2 Molecules

| Composant | Fichier | Props | Usage |
|---|---|---|---|
| `TileGroup` | `molecules/tile-group.js` | `tiles[], activeIndex, onTileClick` | Un mot = suite de `Tile`. Phrase cachée ET indices |
| `ClueText` | `molecules/clue-text.js` | `segments[], onWordTap` | Indice EN avec mots tappables |
| `ClueRow` | `molecules/clue-row.js` | `clue(ClueText), tiles(TileGroup), solved` | Une ligne d'indice complète |
| `TranslationPopover` | `molecules/translation-popover.js` | `word, translation, alreadyKnown, canAdd, onAdd, onClose` | Popover au tap sur un mot d'indice |
| `WordCard` | `molecules/word-card.js` | `word, showAudio, otherSense, onAudio, onNext` | Carte de découverte (EN, phonétique, FR, exemple) |
| `MCQ` | `molecules/mcq.js` | `question, options[], correctId, onAnswer` | Ancrage, discrimination de particule |
| `InputAnswer` | `molecules/input-answer.js` | `prompt, expected, hint, onSubmit` | Rappel actif FR→EN |
| `ClozeInput` | `molecules/cloze-input.js` | `sentence, blankIndex, expected, translation, onSubmit` | Phrase à trous |
| `VerbTriad` | `molecules/verb-triad.js` | `verb, showBase, onSubmit` | Saisie prétérit + participe |
| `WordOrder` | `molecules/word-order.js` | `tokens[], expected, onSubmit` | Remise en ordre (phrasal verbs) |
| `Keyboard` | `molecules/keyboard.js` | `layout(azerty\|qwerty), disabledKeys[], onKey, onBackspace` | Clavier virtuel unique de l'app |
| `SessionHeader` | `molecules/session-header.js` | `title, onHome, onMenu, progress` | En-tête de toute session |
| `StatRow` | `molecules/stat-row.js` | `label, value, icon` | Écran de progression |
| `WordListItem` | `molecules/word-list-item.js` | `word, showBox, actions[]` | Ligne de mot dans toute liste |

### 10.3 Organisms

| Composant | Fichier | Props | Usage |
|---|---|---|---|
| `CodewordBoard` | `organisms/codeword-board.js` | `partie, alphabetState, onLetterInput, onComplete, onAddWord` | La grille complète : phrase + liste d'indices |
| `DiscoveryDeck` | `organisms/discovery-deck.js` | `words[], onComplete` | Séquence de `WordCard` (phase 1) |
| `AnchorDeck` | `organisms/anchor-deck.js` | `words[], onComplete` | Séquence de `MCQ` (phase 2) |
| `RecallDeck` | `organisms/recall-deck.js` | `items[], onComplete` | Séquence de rappel actif (phase 4) |
| `EndCard` | `organisms/end-card.js` | `partie, words[], onContinue` | Contexte + liste des mots appris |
| `QueueSummary` | `organisms/queue-summary.js` | `words[], onClose` | Récapitulatif des ajouts organiques |
| `ManualEntryForm` | `organisms/manual-entry-form.js` | `onTranslate, onSave` | Saisie, traduction, sélection des mots |
| `PalierList` | `organisms/palier-list.js` | `paliers[], current, onSelect` | Choix de palier |

**`CodewordBoard` — partie enrichie.** L'écran passe une copie de la partie
augmentée de deux informations que le composant ne peut pas déduire seul, sans
jamais toucher au store : `motsResolus` (les entités `word` des cinq mots, la
partie ne portant que des ids) et, sur chaque segment d'indice, `connu` (le mot
est déjà au catalogue ou déjà ajouté). `onComplete` signale la grille résolue,
`onAddWord` remonte un segment tapé vers la file de découverte.

### 10.4 Composants explicitement uniques

Pour éviter toute duplication, ces éléments **n'existent qu'en un exemplaire** :

- Tout bouton passe par `Button` ou `IconButton` — **aucun `<button>` brut**
- Toute case lettre passe par `Tile` — grille, indices et phrase cachée
  partagent le même composant, seul `state` change
- Tout clavier passe par `Keyboard` — un seul dans le DOM, monté/démonté
- Tout affichage de mot en liste passe par `WordListItem`
- Toute saisie de réponse passe par `InputAnswer`, `ClozeInput`, `VerbTriad`
  ou `WordOrder` — jamais un `<input>` ad hoc

---

## 11. Écrans

| Écran | Fichier | Contenu |
|---|---|---|
| `Home` | `screens/home.js` | Streak, mots à réviser, bouton session, accès filières |
| `Session` | `screens/session.js` | **Orchestrateur** des 4 phases. Aucune logique métier |
| `Review` | `screens/review.js` | Révision Leitner seule, hors session |
| `ManualAdd` | `screens/manual-add.js` | Saisie manuelle + traduction Gemini |
| `Verbs` | `screens/verbs.js` | Mode verbes irréguliers |
| `Phrasal` | `screens/phrasal.js` | Mode phrasal verbs |
| `Progress` | `screens/progress.js` | Statistiques, paliers, répartition par boîte |
| `Settings` | `screens/settings.js` | Export/import, objectif quotidien, erreurs de contenu |

### États obligatoires par écran

Chaque écran doit gérer explicitement :

| État | Traitement |
|---|---|
| **vide** | « Rien à réviser aujourd'hui » + action alternative |
| **chargement** | `Spinner` (uniquement `ManualAdd`) |
| **erreur** | `Toast` + repli fonctionnel |
| **hors ligne** | tout fonctionne sauf `ManualAdd` — le signaler |
| **fin** | récapitulatif + action suivante, jamais un cul-de-sac |

### Parcours de session

```
Home
 └─ [Commencer]
     ├─ Phase 1  DiscoveryDeck   (0-5 WordCard)
     ├─ Phase 2  AnchorDeck      (MCQ)
     ├─ Phase 3  CodewordBoard   (grille + taps de traduction)
     ├─ Phase 4  EndCard → RecallDeck
     └─ QueueSummary (si ajouts organiques) → Home
```

Si aucun mot nouveau n'est dû, les phases 1 et 2 sont **sautées** — la session
commence directement par la grille avec 5 mots de révision.

---

## 12. Services

| Service | Fichier | Responsabilité |
|---|---|---|
| `store` | `services/store.js` | Lecture/écriture localStorage, migration de version |
| `leitner` | `services/leitner.js` | Calcul des boîtes et dates, file de révision |
| `contentLoader` | `services/content-loader.js` | Manifeste, chargement paresseux, validation |
| `sessionBuilder` | `services/session-builder.js` | Compose une session (2 nouveaux + 3 acquis) |
| `audio` | `services/audio.js` | Web Speech API, voix EN |
| `api` | `services/api.js` | **Unique** point d'appel réseau (Gemini via Vercel) |
| `router` | `services/router.js` | Navigation par hash, historique |
| `normalize` | `services/normalize.js` | Normalisation des saisies texte (§17.4) — importée par `InputAnswer`, `ClozeInput`, `VerbTriad`, `WordOrder`, jamais dupliquée |

**Règle :** toute la logique métier vit dans les services. Les écrans
orchestrent, les composants affichent. Un composant qui contient du calcul de
Leitner est un bug d'architecture.

---

## 13. Générateur de grilles

**Script Node séparé** (`/tools/generateur.js`), exécuté hors ligne.
Il ne fait pas partie de l'application.

```
words.json + phrases.json + indices.json
        ↓  generateur.js  (Node)
   parties-XX.json  →  /content/parties/
```

### Contraintes à satisfaire

| Contrainte | Règle |
|---|---|
| **Point d'entrée** | au moins un mot résoluble avec les seules lettres offertes |
| **Couverture alphabétique** | max 2 lettres nouvelles introduites par mot |
| **Longueur** | 3 à 8 lettres (au-delà : illisible sur mobile) |
| **Unicité de l'indice** | « eau » → WATER mais aussi SEA, OCEAN : l'indice doit être discriminant |
| **Composition** | 2 nouveaux / 3 acquis |

### Algorithme

1. Sélectionner la phrase cachée → elle fixe l'alphabet de base
2. Choisir un **mot-amorce** parmi les mots acquis, révéler ses lettres
   *(dans les jeux de référence : E, L, O, V révélés = les lettres de LOVE)*
3. Ajouter les mots restants par ordre de **réutilisation maximale** des lettres
   déjà placées
4. **Simuler la chaîne de déduction complète.** Rejeter si un mot devient
   indevinable
5. Marquer `verifie: true` après contrôle

### Cas d'échec principal

L'absence de point d'entrée provoque un blocage total. Test de référence validé
en conception : `WATER → WANT → LEARN → NIGHT → ENGLISH` — la cascade fonctionne
si et seulement si le premier maillon est accessible.

---

## 14. API externe

**Un seul appel dans toute l'application : la traduction en saisie manuelle.**

```
App → fonction Vercel → Gemini → App
```

La clé n'est **jamais** dans le code client.

### Contrat

Endpoint : `POST /api/translate`, même origine que l'application.

```json
// requête
{ "texte": "She was reluctant to admit her mistake." }

// réponse
{
  "phrase_en": "She was reluctant to admit her mistake.",
  "phrase_fr": "Elle était réticente à admettre son erreur.",
  "mots": [
    { "en": "reluctant", "fr": "réticent", "type": "adj",
      "phonetique": "/rɪˈlʌk.tənt/", "def_en": "not willing to do something",
      "rang_freq": 2847, "phrasal": false,
      "ambigu": false, "confiance": 0.95, "retro": "reluctant" }
  ]
}
```

`phrase_en`, `def_en`, `phrasal` et `retro` sont produits en plus par
`api/translate.js`. `retro` est le mot rendu par la rétro-traduction : quand il
ne correspond pas à `en`, la fonction lève `ambigu` et abaisse `confiance`.

**Codes de retour :** `400` texte manquant ou au-delà de 400 caractères,
`405` méthode, `502` échec Gemini, `200` sinon.

### Fiabilité

Trois garde-fous, par ordre d'efficacité :

1. **Traduire la phrase, pas le mot.** *« He ran a company »* force le bon sens.
   Un mot isolé n'a pas de bon sens.
2. **Rétro-traduction.** Second appel : renvoyer le FR, demander l'EN. Si le mot
   d'origine ne revient pas, lever `ambigu: true`.
3. **Confirmation utilisateur en 1 tap** avant enregistrement.

Si `rang_freq` est bien au-delà du palier courant, afficher :
> « Ce mot est au palier 6, tu es au palier 2. »

### Contenu pré-généré

**Toutes les traductions des paliers, indices et segments sont produites et
vérifiées en amont, hors application.** La vérification des sens ambigus
(*right, just, mean, get, run, set, still, like*) est faite à la production,
par recherche documentaire — **jamais déléguée à l'utilisateur**.

Génération des indices — exigence : **périphrases culturelles**, pas des
définitions de dictionnaire.

- ✅ *« The Oprah Winfrey ___ »*, *« Meal selection guide »*
- ❌ *« a list of dishes »*, *« a television programme »*

Les indices doivent être **longs et riches** : chaque mot tappable est une
occasion d'apprentissage. Préférer *« You drink it when you are thirsty »* à
*« Water »*.

Pour le type B, vérification manuelle obligatoire des dates et chiffres :
un jeu qui enseigne de faux faits perd toute sa valeur.

---

## 15. Règles anti-duplication

À respecter impérativement lors du codage.

1. **Aucun composant hors de l'inventaire §10.** Un besoin non couvert →
   ajouter le composant au README d'abord.
2. **Aucun `<button>`, `<input>` ou case lettre brut** dans un écran. Toujours
   passer par le composant dédié.
3. **Aucune valeur visuelle en dur.** Couleurs, espacements, rayons, tailles :
   uniquement des variables de `tokens.css`.
4. **Une seule instance de `Keyboard`** dans le DOM.
5. **Un composant ne touche jamais au store.** Props en entrée, callbacks en
   sortie.
6. **Toute logique métier dans `/services`.** Un écran ne calcule pas une date
   de révision.
7. **Un seul point d'appel réseau** : `services/api.js`.
8. **Un seul format de date** : ISO `YYYY-MM-DD`, partout.
9. **Un seul fichier de contenu par palier.** Ne jamais éclater un palier.
10. **Avant de créer quoi que ce soit, chercher si ça existe déjà** dans §10.

---

## 16. Roadmap

Chaque étape produit quelque chose d'utilisable.

| # | Étape | Livrable |
|---|---|---|
| 1 | Tokens + atoms + molecules | catalogue de composants visible |
| 2 | `store` + `leitner` + export/import | moteur testable sans interface |
| 3 | `contentLoader` + `palier-01.json` | contenu chargé et validé |
| 4 | Phases 1, 2, 4 (sans grille) | **app fonctionnelle et utile** |
| 5 | Mode verbes irréguliers | filière indépendante |
| 6 | `ManualAdd` + Gemini | capture de vocabulaire |
| 7 | `generateur.js` + `CodewordBoard` | le morceau risqué, en dernier |
| 8 | Mode phrasal verbs + expressions | |
| 9 | Type B (faits) | quand le stock le permet |
| 10 | Industrialisation paliers 2→56 | |

**Logique :** la grille, techniquement la plus risquée, arrive quand tout le
reste fonctionne déjà. L'app est utile dès l'étape 4.

---

## 17. Spécifications d'interaction

Décisions arrêtées. Aucune interprétation autorisée.

### 17.1 Saisie dans la grille

- **Le clavier reste affiché en permanence** pendant toute la phase 3. Il ne se
  ferme jamais, ne se replie jamais. La zone de jeu défile au-dessus.
- L'utilisateur **touche une case** → elle passe en `state: "active"`.
- Il **tape une lettre** → la lettre s'inscrit dans la case active.
- **Propagation immédiate :** toutes les cases portant le même numéro, partout
  dans la grille (phrase cachée comprise), reçoivent la même lettre et passent
  en `state: "filled"`.
- Après saisie, le curseur avance automatiquement à la case vide suivante **du
  même mot**. Si le mot est complet, il passe au premier mot non résolu.
- Retirer une lettre : touche retour. Elle disparaît de **toutes** les cases
  portant ce numéro.
- Les cases `offered` (lettres du mot-amorce) sont **verrouillées** : non
  éditables, non sélectionnables.
- Une lettre déjà attribuée à un autre numéro reste saisissable. L'app
  n'empêche rien — c'est la validation qui tranche.

### 17.2 Validation d'un mot

- Un mot est validé **uniquement quand toutes ses cases sont remplies**.
  Aucune vérification lettre par lettre, aucun retour intermédiaire.
- Si le mot est correct : cases en `state: "revealed"`, indice grisé, ligne
  marquée `solved`.
- Si le mot est faux : cases en `state: "error"` pendant 600 ms, puis les
  lettres **saisies par l'utilisateur** sont effacées. Les lettres provenant
  d'autres mots déjà validés sont conservées.
- Aucune limite de tentatives. Aucun score de fautes.
- La partie est terminée quand les 5 mots **et** la phrase cachée sont validés.

### 17.3 Système d'indices

**Aucun.** Pas d'ampoule, pas de compteur, pas de révélation payante.
Ne pas implémenter, ne pas prévoir de place dans l'interface.

Le seul secours disponible est le tap-to-translate sur les indices (§3.5), qui
est gratuit et illimité.

### 17.4 Tolérance de saisie

Toute réponse texte (phase 4, `InputAnswer`, `ClozeInput`, `VerbTriad`) est
normalisée **des deux côtés** avant comparaison :

```js
function normaliser(s) {
  return s.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // accents
    .replace(/[^a-z0-9 ]/g, "")                        // ponctuation
    .replace(/\s+/g, " ")                              // espaces multiples
    .trim();                                           // bords, cf. ci-dessous
}
```

Le `trim()` **final** est indispensable. Le premier `trim()` agit avant le
retrait de la ponctuation : `"eau !"` devient `"eau "`, avec un espace résiduel
qui ne vaudra jamais `"eau"`. Le cas est fréquent chez un francophone, qui met
une espace avant `?` et `!` — sans ce second `trim()`, `"How is it going ?"`
serait compté faux.

Conséquences — **tout ceci est accepté** :

| Saisie | Attendu | Résultat |
|---|---|---|
| `Réticent` | réticent | ✅ |
| `reticent` | réticent | ✅ |
| `RÉTICENT` | réticent | ✅ |
| ` réticent ` | réticent | ✅ |
| `l'eau` | eau | ❌ (mot différent) |

Si le mot attendu comporte plusieurs traductions acceptables, le champ `fr`
peut contenir des variantes séparées par `|` — n'importe laquelle valide.

### 17.5 Icônes

**SVG inline, jeu minimal fait maison.** Pas de bibliothèque externe, pas
d'emoji (rendu incohérent entre plateformes), pas de police d'icônes.

Un seul fichier `components/atoms/icons.js` exportant un objet :

```js
export const ICONS = {
  home:     '<svg viewBox="0 0 24 24">…</svg>',
  back:     '…',
  close:    '…',
  audio:    '…',
  plus:     '…',
  check:    '…',
  cross:    '…',
  flame:    '…',   // streak
  book:     '…',   // paliers
  pencil:   '…',   // saisie manuelle
  settings: '…',
  chart:    '…',   // progression
  download: '…',
  upload:   '…',
};
```

Règles : `viewBox="0 0 24 24"`, trait `stroke="currentColor"`,
`stroke-width="2"`, `fill="none"`, extrémités arrondies. La couleur est
héritée du parent — aucune couleur en dur dans les SVG.
`IconButton` et `Button` reçoivent une **clé** de cet objet, jamais du SVG brut.

### 17.6 Clavier

- Disposition **AZERTY** par défaut — l'utilisateur est francophone et tape sur
  un clavier français. `qwerty` reste disponible via la prop `layout`.
- 3 rangées, 26 touches + retour arrière.
- Aucune touche espace, aucune touche entrée (la validation est automatique).
- Hauteur fixe, ancré en bas, `z-index: var(--z-keyboard)`.
- Le clavier natif du téléphone n'est **jamais** invoqué en phase 3 : les cases
  ne sont pas des `<input>`.
- **Le clavier virtuel sert aussi en phase 4.** Le clavier natif du téléphone
  apporte autocorrection et suggestions, ce qui contredit la §3.4 : le rappel
  actif doit se faire « sans aide ». Les champs de `RecallDeck` sont donc en
  `inputmode="none"` et alimentés par le clavier virtuel.
- **La saisie manuelle garde le clavier natif** : on y tape des phrases
  entières, avec espaces et ponctuation — un clavier de 26 touches sans espace
  ne conviendrait pas.

### 17.7 Retours visuels

| Événement | Retour |
|---|---|
| Lettre saisie | fond de case `--c-tile-filled`, sans animation |
| Mot correct | `--c-success` 400 ms, puis `revealed` |
| Mot faux | `--c-error` 600 ms + secousse horizontale 200 ms |
| Phrase complétée | transition vers `EndCard` après 800 ms |
| Bonne réponse en QCM/rappel | bordure verte, passage auto après 700 ms |
| Mauvaise réponse | bordure rouge, bonne réponse affichée, passage sur tap |

Vibration (`navigator.vibrate`) : 30 ms sur erreur uniquement, si disponible.
Aucun son.

### 17.8 Cas particulier du palier 1

Le palier 1 ne peut pas respecter la règle « 2 nouveaux / 3 acquis » : rien
n'est encore acquis. Ses 10 parties utilisent **5 mots nouveaux chacune**, tous
découverts en phase 1 avant la grille. La règle standard s'applique à partir du
palier 2.


---

## 18. Points ouverts

- Volume cible : ~560 parties pour couvrir 2800 mots à 5 mots/partie
- ~~Statistiques de progression : quel niveau de détail dans `Progress` ?~~
  **Tranché.** `PalierList` montre deux chiffres, issus d'un seul calcul
  (`avancementPalier`) : la barre suit les **mots rencontrés**, parce que c'est
  ce qui avance à chaque session ; le **seuil de déblocage** (§2.1) est écrit
  en dessous. N'afficher que la boîte 3+ laissait la barre à zéro après une
  session parfaite — une boîte 3 demande deux réussites à des jours différents.
- Thème sombre : prévu par les tokens, à activer plus tard
