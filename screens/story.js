import { SessionHeader } from "../components/molecules/session-header.js";
import { Button } from "../components/atoms/button.js";
import { Toast } from "../components/atoms/toast.js";
import { TranslationPopover } from "../components/molecules/translation-popover.js";
import { Spinner } from "../components/atoms/spinner.js";
import { StoryReader } from "../components/organisms/story-reader.js";
import { choisirHistoire, appliquerHistoire, requeteHistoire,
         histoireDepuisApi, idHistoireGeneree,
         COUVERTURE_MIN } from "../services/story-builder.js";
import { genererHistoire, traduire } from "../services/api.js";
import { ajouterHistoireGeneree } from "../services/store.js";
import { motDepuisTraduction, prochainIdPerso,
         ajouterMotsPerso } from "../services/session-builder.js";
import { appliquerResultat, aujourdhui } from "../services/leitner.js";

/**
 * Story — section §06 « Histoire du jour » (README §2, §13).
 *
 * Un tap sur un mot affiche sa traduction et, si le mot est inconnu, propose
 * de l'ajouter à la file de découverte. Consulter la traduction d'un mot du
 * lexique l'empêche de monter d'une boîte : c'est le signal de maîtrise (§5).
 *
 * @param {{state:object, contenu:object, aller:Function, enregistrer:Function}} contexte
 * @returns {HTMLElement}
 */
export function Story({ state, contenu, aller, enregistrer }) {
  const el = document.createElement("main");
  el.className = "ecran story-screen";

  const today = aujourdhui();
  const histoires = contenu.histoires ?? [];
  const choix = choisirHistoire({ state, histoires, today });

  el.append(SessionHeader({ title: "Histoire du jour", onHome: () => aller("/") }));

  if (choix.dejaLue) {
    return vide(el, aller, choix.chapitre
      ? "Tu as lu tes chapitres du jour. La suite demain."
      : "Tu as déjà lu l'histoire du jour. Reviens demain.");
  }
  if (choix.verrouille || !choix.histoire) {
    return vide(el, aller, choix.raison ?? "Aucune histoire disponible.");
  }

  let histoire = choix.histoire;
  /** Mots du lexique dont la traduction a été consultée. */
  const aides = new Set();
  /** Mots ajoutés à la file de découverte pendant la lecture. */
  const ajoutes = [];

  // Index en → entité, pour retrouver un mot tapé dans le texte.
  const parEn = new Map();
  for (const mot of contenu.mots.values()) if (!parEn.has(mot.en)) parEn.set(mot.en, mot);
  for (const mot of state.perso ?? []) if (!parEn.has(mot.en)) parEn.set(mot.en, mot);

  const corps = document.createElement("div");
  corps.className = "session__body";

  /**
   * Bandeau de couverture insuffisante, avec l'offre de génération (§16).
   *
   * Un seul bandeau existe : la zone d'action passe du bouton au spinner et
   * revient au bouton si l'appel échoue. Le texte reste lisible pendant ce
   * temps — l'utilisateur n'est jamais bloqué en attendant le réseau.
   */
  const bandeau = () => {
    const zone = document.createElement("div");
    zone.className = "story-screen__warning";

    const texte = document.createElement("p");
    texte.className = "story-screen__warning-text";
    texte.textContent =
      `Tu connais ${Math.round(choix.couverture * 100)}% des mots de ce texte, `
      + `en dessous des ${Math.round(COUVERTURE_MIN * 100)}% recommandés. `
      + "Il te faudra la traduction plus souvent que d'habitude.";
    zone.append(texte);

    const action = document.createElement("div");
    zone.append(action);

    const bouton = () => action.replaceChildren(Button({
      label: "Demander un texte à ma mesure",
      variant: "secondary",
      fullWidth: true,
      onClick: async () => {
        action.replaceChildren(Spinner({ size: "md" }));

        const requete = requeteHistoire({ state, catalogue: contenu.mots, histoires });
        const reponse = await genererHistoire(requete);

        if (!reponse.ok) {
          el.append(Toast({ message: reponse.erreur, variant: "error", duration: 5000 }));
          bouton();
          return;
        }

        const generee = histoireDepuisApi(reponse.donnees, {
          catalogue: contenu.mots,
          id: idHistoireGeneree(today),
          arc: requete.arc?.id ?? null,
        });
        if (!generee) { bouton(); return; }

        // L'histoire générée vit en localStorage, jamais dans /content (§16).
        ajouterHistoireGeneree(generee);
        histoire = generee;
        zone.remove();
        corps.replaceChildren(StoryReader({ histoire, onWordTap: taper, onFinish: terminer }));
      },
    }));

    bouton();
    el.append(zone);
  };

  if (!choix.suffisante) bandeau();

  /** Popover courant : un seul à la fois dans le DOM. */
  let popover = null;
  /** Le mot auquel il est accroché, pour pouvoir refermer au second tap. */
  let ancrePopover = null;
  const fermer = () => { popover?.remove(); popover = null; ancrePopover = null; };

  /** Pose un popover sous un mot et retient son ancre. */
  const poser = (element, ancre) => {
    popover = element;
    ancrePopover = ancre;
    ancre.insertAdjacentElement("afterend", element);
  };

  const taper = async (nu, ancre) => {
    // Deuxième tap sur le même mot : on referme. Sans cette bascule, le
    // popover était détruit puis recréé à l'identique — il restait donc
    // ouvert, et le mot suivant partait à la ligne, ce qui se lit comme un
    // espace disparu.
    if (ancrePopover === ancre) { fermer(); return; }
    fermer();

    const mot = parEn.get(nu);
    if (!mot) { await traduireInconnu(nu, ancre); return; }

    // Consulter la traduction d'un mot du lexique le prive de sa montée (§5).
    if ((histoire.lexique ?? []).includes(mot.id)) aides.add(mot.id);

    const connu = Boolean(state.words?.[mot.id]) || ajoutes.some((m) => m.en === nu);
    popover = TranslationPopover({
      word: mot.en,
      translation: mot.fr,
      alreadyKnown: connu,
      canAdd: !connu,
      onAdd: () => {
        const ajout = motDepuisTraduction({
          mot: { en: mot.en, fr: mot.fr, type: mot.type ?? null },
          phrase_en: histoire.titre_en ?? null,
          phrase_fr: histoire.titre_fr ?? null,
          id: prochainIdPerso([...(state.perso ?? []), ...ajoutes]),
          date: today,
        });
        if (ajout) ajoutes.push(ajout);
        fermer();
      },
      onClose: fermer,
    });
    poser(popover, ancre);
  };

  /**
   * Un mot absent du catalogue se fait traduire à la demande.
   *
   * Sans ça, tomber sur un mot inconnu dans une histoire ne produisait
   * **rien** : il fallait sortir de l'application pour le chercher ailleurs.
   * Or c'est exactement le mot qu'on veut apprendre.
   */
  const traduireInconnu = async (nu, ancre) => {
    const attente = document.createElement("div");
    attente.className = "translation-popover";
    attente.append(Spinner({ size: "md" }));
    poser(attente, ancre);

    const reponse = await traduire(nu);
    if (popover !== attente) return;   // l'utilisateur est passé à autre chose
    attente.remove();
    popover = null;
    ancrePopover = null;

    const trouve = reponse.ok ? (reponse.donnees?.mots?.[0] ?? null) : null;
    const fr = trouve?.fr ?? (reponse.ok ? reponse.donnees?.phrase_fr : null);

    if (!fr) {
      el.append(Toast({ message: reponse.erreur ?? "Traduction indisponible.",
                        variant: "error", duration: 4000 }));
      return;
    }

    poser(TranslationPopover({
      word: nu,
      translation: fr,
      alreadyKnown: false,
      canAdd: true,
      onAdd: () => {
        const ajout = motDepuisTraduction({
          mot: { en: nu, fr, type: trouve?.type ?? null,
                 phonetique: trouve?.phonetique ?? null },
          phrase_en: histoire.titre_en ?? null,
          phrase_fr: histoire.titre_fr ?? null,
          id: prochainIdPerso([...(state.perso ?? []), ...ajoutes]),
          date: today,
        });
        if (ajout) ajoutes.push(ajout);
        fermer();
      },
      onClose: fermer,
    }), ancre);
  };

  const terminer = () => {
    fermer();
    let suivant = appliquerHistoire({
      state, histoire, aides: [...aides], appliquer: appliquerResultat, today,
    });
    if (ajoutes.length) {
      suivant = ajouterMotsPerso(suivant, ajoutes);
      suivant = {
        ...suivant,
        progression: {
          ...suivant.progression,
          ajouts_aujourdhui: Number(suivant.progression.ajouts_aujourdhui ?? 0) + ajoutes.length,
        },
      };
    }
    if (ajoutes.length) {
      el.append(Toast({
        message: `${ajoutes.length} mot(s) ajouté(s) à ta file de découverte.`,
        variant: "success",
        duration: 3000,
      }));
    }

    // Feuilleton : un deuxième chapitre est permis aujourd'hui. On propose la
    // suite plutôt que de renvoyer à l'accueil — mais sans l'imposer.
    const apres = choisirHistoire({ state: suivant, histoires, today });
    if (choix.chapitre && apres.chapitre && !apres.dejaLue) {
      // Silencieux : un re-rendu servirait tout de suite le chapitre suivant,
      // sans laisser le choix.
      enregistrer(suivant, { silencieux: true });
      corps.replaceChildren(finDeChapitre(apres.chapitre));
      return;
    }
    enregistrer(suivant);
    aller("/");
  };

  /** Fin d'un chapitre : lire la suite maintenant, ou garder le suspense. */
  const finDeChapitre = (prochain) => {
    const zone = document.createElement("div");
    zone.className = "ecran__empty";

    const message = document.createElement("p");
    message.className = "ecran__empty-text";
    message.textContent = `Chapitre ${choix.chapitre.numero} terminé. Tu peux lire `
      + `le chapitre ${prochain.numero} maintenant, ou garder la suite pour demain.`;
    zone.append(message);

    zone.append(
      Button({ label: `Lire le chapitre ${prochain.numero}`, fullWidth: true,
               onClick: () => aller("/story") }),
      Button({ label: "La suite demain", variant: "secondary", fullWidth: true,
               onClick: () => aller("/") }),
    );
    return zone;
  };

  if (choix.chapitre) {
    const repere = document.createElement("p");
    repere.className = "story-screen__chapitre";
    repere.textContent = `${choix.chapitre.serie_fr ?? "Feuilleton"} · chapitre `
      + `${choix.chapitre.numero} sur ${choix.chapitre.total}`;
    corps.append(repere);
  }
  corps.append(StoryReader({ histoire, onWordTap: taper, onFinish: terminer }));
  el.append(corps);
  return el;
}

/** État vide : message et action alternative, jamais un cul-de-sac (§13). */
function vide(el, aller, texte) {
  const zone = document.createElement("div");
  zone.className = "ecran__empty";

  const message = document.createElement("p");
  message.className = "ecran__empty-text";
  message.textContent = texte;
  zone.append(message);

  zone.append(Button({ label: "Retour à l'accueil", fullWidth: true,
                       onClick: () => aller("/") }));
  el.append(zone);
  return el;
}
