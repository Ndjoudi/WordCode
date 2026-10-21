import { Button } from "../atoms/button.js";
import { estCorrect } from "../../services/normalize.js";

/**
 * ClozeChoice — phrase à trous, sans clavier (README §10, §12.2).
 *
 * On touche un trou pour le choisir, puis un mot de la liste pour l'y poser.
 * Par défaut, le mot va dans le premier trou vide. Toucher un trou rempli
 * rend son mot à la liste.
 *
 * @param {Array<{texte:string}|{trou:number}>} parts  la phrase, trous compris
 * @param {string[]} choices   mots proposés, déjà mélangés par l'appelant
 * @param {string[]} expected  mot attendu pour chaque trou, dans l'ordre
 * @param {string}   sentence  phrase complète, affichée après une erreur
 * @param {Function} onSubmit  reçoit { value, correct }
 * @returns {HTMLElement}
 */
export function ClozeChoice({ parts = [], choices = [], expected = [], sentence = "",
                              onSubmit } = {}) {
  const el = document.createElement("section");
  el.className = "cloze-choice";

  const phrase = document.createElement("p");
  phrase.className = "cloze-choice__phrase";
  el.append(phrase);

  const reserve = document.createElement("div");
  reserve.className = "cloze-choice__pool";
  el.append(reserve);

  const verdict = document.createElement("p");
  verdict.className = "cloze-choice__verdict";
  el.append(verdict);

  const valider = Button({ label: "Valider", fullWidth: true, disabled: true,
                           onClick: () => soumettre() });
  el.append(valider);

  /** Pour chaque trou, l'index du mot posé dans `choices`, ou null. */
  const poses = expected.map(() => null);
  let actif = 0;
  let repondu = false;
  let justes = [];

  const premierVide = () => poses.findIndex((p) => p === null);

  const rendre = () => {
    phrase.replaceChildren();
    reserve.replaceChildren();

    for (const part of parts) {
      if (part.texte !== undefined) {
        phrase.append(document.createTextNode(part.texte));
        continue;
      }
      const rang = part.trou;
      const pose = poses[rang];
      const trou = Button({
        label: pose === null ? "" : choices[pose],
        variant: "secondary",
        disabled: repondu,
        onClick: () => {
          if (poses[rang] !== null) poses[rang] = null;
          actif = rang;
          rendre();
        },
      });
      trou.classList.add("cloze-choice__trou");
      if (pose === null) trou.classList.add("cloze-choice__trou--vide");
      if (!repondu && rang === actif) trou.classList.add("cloze-choice__trou--actif");
      if (repondu) trou.classList.add(justes[rang] ? "cloze-choice__trou--juste" : "cloze-choice__trou--faux");
      trou.setAttribute("aria-label", pose === null ? `Trou ${rang + 1}, vide` : `Trou ${rang + 1} : ${choices[pose]}`);
      phrase.append(trou);
    }

    choices.forEach((mot, index) => {
      if (poses.includes(index)) return;
      const bouton = Button({
        label: mot, variant: "secondary", disabled: repondu,
        onClick: () => {
          const cible = poses[actif] === null ? actif : premierVide();
          if (cible === -1) return;
          poses[cible] = index;
          // Tout est rempli : plus aucun trou en surbrillance.
          actif = premierVide();
          rendre();
        },
      });
      bouton.classList.add("cloze-choice__mot");
      reserve.append(bouton);
    });

    valider.disabled = repondu || premierVide() !== -1;
  };

  function soumettre() {
    if (repondu || premierVide() !== -1) return;
    repondu = true;

    justes = poses.map((index, rang) => estCorrect(choices[index], expected[rang]));
    const correct = justes.every(Boolean);
    if (!correct) {
      verdict.textContent = sentence;
      navigator.vibrate?.(30);
    }
    rendre();

    if (onSubmit) onSubmit({ value: poses.map((index) => choices[index]).join(" "), correct });
  }

  rendre();
  return el;
}
