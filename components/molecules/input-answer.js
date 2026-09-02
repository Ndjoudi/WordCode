import { Button } from "../atoms/button.js";
import { estCorrect } from "../../services/normalize.js";

/**
 * InputAnswer — rappel actif FR → EN, phase 4 (README §10.2, §3.4).
 * Champ natif : en phase 4 c'est le clavier du téléphone qui sert (§17.6).
 *
 * @param {string}   prompt    ce qu'on demande de traduire
 * @param {string}   expected  réponse attendue, variantes séparées par « | »
 * @param {?string}  hint
 * @param {Function} onSubmit  reçoit { value, correct }
 * @returns {HTMLFormElement}
 */
export function InputAnswer({ prompt, expected, hint = null, onSubmit } = {}) {
  const el = document.createElement("form");
  el.className = "input-answer";
  el.noValidate = true;

  const intitule = document.createElement("p");
  intitule.className = "input-answer__prompt";
  intitule.textContent = prompt ?? "";
  el.append(intitule);

  if (hint) {
    const aide = document.createElement("p");
    aide.className = "input-answer__hint";
    aide.textContent = hint;
    el.append(aide);
  }

  const champ = document.createElement("input");
  champ.type = "text";
  champ.className = "input-answer__field";
  champ.lang = "en";
  champ.autocomplete = "off";
  champ.autocapitalize = "none";
  champ.spellcheck = false;
  champ.setAttribute("aria-label", prompt ?? "Réponse");
  el.append(champ);

  const verdict = document.createElement("p");
  verdict.className = "input-answer__verdict";
  el.append(verdict);

  el.append(Button({ label: "Valider", fullWidth: true, onClick: () => el.requestSubmit() }));

  let repondu = false;
  el.addEventListener("submit", (evenement) => {
    evenement.preventDefault();
    if (repondu) return;
    repondu = true;

    const value = champ.value;
    const correct = estCorrect(value, expected);

    champ.readOnly = true;
    champ.classList.add(correct ? "input-answer__field--correct" : "input-answer__field--wrong");
    if (!correct) {
      verdict.textContent = String(expected ?? "").split("|")[0].trim();
      navigator.vibrate?.(30);
    }

    if (onSubmit) onSubmit({ value, correct });
  });

  return el;
}
