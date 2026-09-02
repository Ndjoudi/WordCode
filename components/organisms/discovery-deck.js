import { WordCard } from "../molecules/word-card.js";
import { ProgressDots } from "../atoms/progress-dots.js";
import { parler } from "../../services/audio.js";

/**
 * DiscoveryDeck — phase 1, séquence de `WordCard` (README §10.3, §3.1).
 *
 * Le deck pilote la lecture audio lui-même : la synthèse vocale est une
 * capacité de l'appareil, pas une règle métier, et les props documentées de
 * l'organism n'exposent pas de callback pour elle.
 *
 * @param {object[]} words
 * @param {Function} onComplete
 * @returns {HTMLElement}
 */
export function DiscoveryDeck({ words = [], onComplete } = {}) {
  const el = document.createElement("section");
  el.className = "deck";

  let rang = 0;

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
      onNext: () => {
        rang += 1;
        if (rang >= words.length) {
          if (onComplete) onComplete();
          return;
        }
        rendre();
      },
    }));

    // Un mot nouveau se prononce dès qu'il apparaît : écrit + audio + contexte
    // sont les trois canaux exigés par la §3.1.
    parler(mot.en);
  };

  rendre();
  return el;
}
