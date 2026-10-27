/**
 * Pagination — précédente, numéros de page, suivante.
 *
 * Au-delà de sept pages, on garde la première, la dernière et les voisines de
 * la page courante ; le reste devient « … ». La rangée garde ainsi une largeur
 * stable, qui tient sur un téléphone.
 *
 * @param {number}   page      page courante, à partir de 0
 * @param {number}   pages     nombre de pages
 * @param {Function} onChange  reçoit la page choisie, à partir de 0
 * @returns {HTMLElement}
 */
export function Pagination({ page = 0, pages = 1, onChange } = {}) {
  const el = document.createElement("nav");
  el.className = "pagination";
  el.setAttribute("aria-label", "Pages");

  const bouton = (texte, cible, { label = null, courante = false } = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `pagination__page${courante ? " pagination__page--courante" : ""}`;
    b.textContent = texte;
    if (label) b.setAttribute("aria-label", label);
    if (courante) b.setAttribute("aria-current", "page");
    b.disabled = cible < 0 || cible >= pages || courante;
    b.addEventListener("click", () => onChange?.(cible));
    return b;
  };

  el.append(bouton("‹", page - 1, { label: "Page précédente" }));
  for (const p of pagesAffichees(page, pages)) {
    if (p === null) {
      const trou = document.createElement("span");
      trou.className = "pagination__trou";
      trou.textContent = "…";
      el.append(trou);
    } else {
      el.append(bouton(String(p + 1), p, { label: `Page ${p + 1}`, courante: p === page }));
    }
  }
  el.append(bouton("›", page + 1, { label: "Page suivante" }));
  return el;
}

/**
 * Pages à montrer, `null` pour un « … ». Un trou d'une seule page affiche la
 * page plutôt que « … » : le symbole prendrait la même place.
 *
 * @param {number} page   à partir de 0
 * @param {number} pages
 * @returns {Array<?number>}
 */
export function pagesAffichees(page, pages) {
  if (pages <= 7) return Array.from({ length: Math.max(0, pages) }, (_, i) => i);

  const garder = new Set([0, pages - 1, page - 1, page, page + 1]);
  // Près d'un bord, on complète pour que la rangée garde sa longueur.
  if (page <= 2) [1, 2, 3].forEach((p) => garder.add(p));
  if (page >= pages - 3) [pages - 4, pages - 3, pages - 2].forEach((p) => garder.add(p));

  const sortie = [];
  let dernier = null;
  for (const p of [...garder].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b)) {
    if (dernier !== null && p - dernier === 2) sortie.push(dernier + 1);
    else if (dernier !== null && p - dernier > 2) sortie.push(null);
    sortie.push(p);
    dernier = p;
  }
  return sortie;
}
