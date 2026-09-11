import { WordCard } from "../molecules/word-card.js";
import { ProgressDots } from "../atoms/progress-dots.js";
import { Button } from "../atoms/button.js";
import { parler } from "../../services/audio.js";

/**
 * DiscoveryDeck — section §02, séquence de `WordCard` (README §2, §12.3).
 *
 * La découverte ne teste rien : elle présente le mot par ses trois canaux
 * (écrit, audio, contexte) et demande un simple tri. Les deux verdicts n'ont
 * pas la même conséquence, mais ils coûtent le même geste — c'est ce qui rend
 * le tri honnête.
 *
 * Le deck pilote la lecture audio lui-même : la synthèse vocale est une
 * capacité de l'appareil, pas une règle métier.
 *
 * @param {object[]} words
 * @param {Function} onKnown     reçoit le mot déclaré connu
 * @param {Function} onUnknown   reçoit le mot déclaré inconnu
 * @param {Function} onComplete  file épuisée
 * @returns {HTMLElement}
 */
export function DiscoveryDeck({ words = [], onKnown, onUnknown, onComplete } = {}) {
  const el = document.createElement("section");
  el.className = "deck deck--discovery";

  let rang = 0;

  const suivant = () => {
    rang += 1;
    if (rang >= words.length) {
      if (onComplete) onComplete();
      return;
    }
    rendre();
  };

  const rendre = () => {
    el.replaceChildren();
    if (!words.length) {
      if (onComplete) onComplete();
      return;
    }

    const mot = words[rang];
    el.append(ProgressDots({ total: words.length, current: rang + 1 }));
    el.append(WordCard({
      word: mot,
      showAudio: true,
      otherSense: mot.autre_sens ?? null,
      onAudio: () => parler(mot.en),
    }));

    const choix = document.createElement("div");
    choix.className = "deck__choices";
    choix.append(
      Button({
        label: "Je connais",
        variant: "secondary",
        fullWidth: true,
        onClick: () => { if (onKnown) onKnown(mot); suivant(); },
      }),
      Button({
        label: "Je ne connais pas",
        variant: "primary",
        fullWidth: true,
        onClick: () => { if (onUnknown) onUnknown(mot); suivant(); },
      }),
    );
    el.append(choix);

    // Un mot nouveau se prononce dès qu'il apparaît : écrit + audio + contexte
    // sont les trois canaux exigés par la §02.
    parler(mot.en);
  };

  rendre();
  return el;
}
