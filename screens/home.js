import { Button } from "../components/atoms/button.js";
import { IconButton } from "../components/atoms/icon-button.js";
import { Counter } from "../components/atoms/counter.js";
import { ProgressBar } from "../components/atoms/progress-bar.js";
import { Divider } from "../components/atoms/divider.js";
import { composerSession } from "../services/session-builder.js";
import { fileDeRevision } from "../services/leitner.js";

/**
 * Home — série, mots à réviser, départ de session (README §11).
 * @param {{state:object, contenu:object, aller:Function}} contexte
 * @returns {HTMLElement}
 */
export function Home({ state, contenu, aller }) {
  const el = document.createElement("main");
  el.className = "ecran home";

  const barre = document.createElement("div");
  barre.className = "home__bar";
  const titre = document.createElement("h1");
  titre.className = "home__title";
  titre.textContent = "WordCode";
  barre.append(titre);

  const actions = document.createElement("div");
  actions.className = "home__actions";
  actions.append(
    IconButton({ icon: "pencil", label: "Ajouter un mot", variant: "ghost",
                 onClick: () => aller("/add") }),
    IconButton({ icon: "chart", label: "Progression", variant: "ghost",
                 onClick: () => aller("/progress") }),
    IconButton({ icon: "settings", label: "Réglages", variant: "ghost",
                 onClick: () => aller("/settings") }),
  );
  barre.append(actions);
  el.append(barre);

  const dus = fileDeRevision(state).filter((e) => e.type === "word");
  const session = composerSession({ state, catalogue: contenu.mots });

  const compteurs = document.createElement("div");
  compteurs.className = "home__counters";
  compteurs.append(
    Counter({ value: state.progression.streak ?? 0, icon: "flame", label: "jours" }),
    Counter({ value: dus.length, icon: "book", label: "à réviser" }),
  );
  el.append(compteurs);

  const palier = contenu.paliers.find(
    (p) => Number(p.id) === Number(state.progression.palier_actuel));
  if (palier) {
    const bloc = document.createElement("div");
    bloc.className = "home__palier";

    const nom = document.createElement("p");
    nom.className = "home__palier-name";
    nom.textContent = `Palier ${palier.id} — ${palier.titre}`;
    bloc.append(nom);

    const total = [...contenu.mots.values()]
      .filter((m) => Number(m.palier) === Number(palier.id)).length;
    const vus = Object.keys(state.words).length;
    bloc.append(ProgressBar({ value: vus, max: total || 1 }));

    const detail = document.createElement("p");
    detail.className = "home__palier-detail";
    detail.textContent = `${vus} mot${vus > 1 ? "s" : ""} sur ${total} rencontré${vus > 1 ? "s" : ""}`;
    bloc.append(detail);
    el.append(bloc);
  }

  el.append(Divider({ spacing: 5 }));

  // État vide : rien de nouveau, rien à réviser. On ne laisse jamais
  // l'utilisateur devant un cul-de-sac (README §11).
  if (session.vide) {
    const vide = document.createElement("div");
    vide.className = "ecran__empty";

    const message = document.createElement("p");
    message.className = "ecran__empty-text";
    message.textContent = dus.length === 0 && Object.keys(state.words).length > 0
      ? "Rien à réviser aujourd'hui. Reviens demain, ou relis ce que tu as appris."
      : "Rien à apprendre pour l'instant.";
    vide.append(message);

    vide.append(Button({
      label: "Voir ma progression",
      variant: "secondary",
      fullWidth: true,
      onClick: () => aller("/progress"),
    }));
    el.append(vide);
    el.append(filieres(contenu, aller));
    return el;
  }

  const resume = document.createElement("p");
  resume.className = "home__summary";
  const parts = [];
  if (session.nouveaux.length) parts.push(`${session.nouveaux.length} nouveau${session.nouveaux.length > 1 ? "x" : ""}`);
  if (session.revision.length) parts.push(`${session.revision.length} à revoir`);
  resume.textContent = `Session du jour : ${parts.join(", ")}.`;
  el.append(resume);

  el.append(Button({
    label: "Commencer",
    fullWidth: true,
    onClick: () => aller("/session"),
  }));

  if (dus.length) {
    el.append(Button({
      label: "Réviser seulement",
      variant: "ghost",
      fullWidth: true,
      onClick: () => aller("/review"),
    }));
  }

  el.append(filieres(contenu, aller));
  return el;
}

/**
 * Accès aux filières. Une filière dont le contenu n'est pas livré est
 * simplement absente de l'interface (README §7) — aucun bouton mort.
 */
function filieres(contenu, aller) {
  const zone = document.createElement("div");
  zone.className = "home__filieres";

  if (contenu.filieres?.verbes && (contenu.verbes ?? []).length) {
    zone.append(Button({
      label: "Verbes irréguliers",
      icon: "book",
      variant: "secondary",
      fullWidth: true,
      onClick: () => aller("/verbs"),
    }));
  }

  return zone;
}
