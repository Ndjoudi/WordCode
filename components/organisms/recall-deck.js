import { InputAnswer } from "../molecules/input-answer.js";
import { ClozeInput } from "../molecules/cloze-input.js";
import { Button } from "../atoms/button.js";
import { ProgressDots } from "../atoms/progress-dots.js";

/**
 * RecallDeck — phase 4, rappel actif (README §10.3, §3.4).
 *
 * Les items sont préparés par `session-builder.construireRappel` : traduction
 * isolée pour les mots de palier, phrase source à trous pour `perso` et
 * `organique`.
 *
 * @param {Array<object>} items
 * @param {Function} onComplete  reçoit [{ id, correct }]
 * @returns {HTMLElement}
 */
export function RecallDeck({ items = [], onComplete } = {}) {
  const el = document.createElement("section");
  el.className = "deck";

  const resultats = [];
  let rang = 0;

  const suivant = () => {
    rang += 1;
    if (rang >= items.length) {
      if (onComplete) onComplete(resultats);
      return;
    }
    rendre();
  };

  const rendre = () => {
    el.replaceChildren();
    if (!items.length) {
      if (onComplete) onComplete(resultats);
      return;
    }

    const item = items[rang];
    el.append(ProgressDots({ total: items.length, current: rang + 1 }));

    const zone = document.createElement("div");
    zone.className = "deck__body";

    const repondu = ({ correct }) => {
      resultats.push({ id: item.mot.id, correct });
      const suite = document.createElement("div");
      suite.className = "deck__continue";
      suite.append(Button({
        label: rang + 1 >= items.length ? "Terminer" : "Continuer",
        fullWidth: true,
        onClick: suivant,
      }));
      zone.append(suite);
    };

    zone.append(item.type === "cloze"
      ? ClozeInput({
          sentence: item.sentence,
          blankIndex: item.blankIndex,
          expected: item.expected,
          translation: item.translation,
          onSubmit: repondu,
        })
      : InputAnswer({
          prompt: item.prompt,
          expected: item.expected,
          hint: null,
          onSubmit: repondu,
        }));

    el.append(zone);
  };

  rendre();
  return el;
}
