/**
 * router.js — navigation par hash (README §12).
 *
 * Aucune dépendance, aucun état applicatif : le routeur ne connaît que des
 * chemins et les fonctions qui rendent les écrans.
 */

/** Chemin courant, déduit du hash. `#/session` → `/session`. */
export function cheminCourant(hash = globalThis.location?.hash ?? "") {
  const brut = String(hash).replace(/^#/, "");
  if (!brut || brut === "/") return "/";
  return brut.startsWith("/") ? brut : `/${brut}`;
}

/**
 * Crée un routeur.
 *
 * @param {object}   options
 * @param {Object<string, Function>} options.routes  chemin → fabrique d'écran
 * @param {string}   options.defaut   chemin de repli
 * @param {Function} options.monter   reçoit l'élément rendu, le chemin, et
 *                                    `{ conserver }` : vrai quand l'écran est
 *                                    seulement re-rendu, sans navigation
 * @returns {{demarrer:Function, aller:Function, rafraichir:Function, chemin:Function}}
 */
export function creerRouteur({ routes, defaut = "/", monter }) {
  let dernier = null;

  const resoudre = ({ conserver = false } = {}) => {
    const chemin = cheminCourant();
    const fabrique = routes[chemin] ?? routes[defaut];
    dernier = routes[chemin] ? chemin : defaut;
    monter(fabrique(), dernier, { conserver });
  };

  return {
    demarrer() {
      globalThis.addEventListener("hashchange", () => resoudre());
      resoudre();
    },
    /** Navigue. Passer par le hash conserve l'historique du navigateur. */
    aller(chemin) {
      const cible = chemin.startsWith("/") ? chemin : `/${chemin}`;
      if (cheminCourant() === cible) resoudre();
      else globalThis.location.hash = `#${cible}`;
    },
    /**
     * Re-rend l'écran courant, sans toucher à l'historique ni au défilement :
     * c'est ce qui suit un enregistrement, l'utilisateur n'a pas changé de page.
     */
    rafraichir: () => resoudre({ conserver: true }),
    chemin: () => dernier,
  };
}
