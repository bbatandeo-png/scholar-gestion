// Recherche instantanee pour les listes filtrees cote serveur (inscriptions,
// eleves, anciens eleves, utilisateurs, stocks, enseignants).
//
// Active sur tout <form method="get" data-live-search="#zone-a, #zone-b">.
// Pendant la frappe (avec un court delai) ou au changement d'un filtre, la
// meme requete GET que le bouton "Rechercher" est envoyee en arriere-plan,
// puis seules les zones listees sont remplacees par celles de la page
// recue : le champ garde le focus et la position du curseur. L'URL est mise
// a jour (lien partageable, bouton Precedent). Sans JavaScript, ou si la
// requete echoue, le formulaire garde son fonctionnement normal.
(() => {
  const DEBOUNCE_MS = 300;

  document.querySelectorAll('form[data-live-search]').forEach((form) => {
    const selectors = form.dataset.liveSearch
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean);
    if (selectors.length === 0) {
      return;
    }

    // La recherche part pendant la frappe et au changement d'un filtre : le
    // bouton "Rechercher" / "Filtrer" devient inutile. Il reste dans la page
    // (secours sans JavaScript) mais n'est masque qu'une fois ce script
    // actif ; la touche Entree continue de lancer la recherche.
    form
      .querySelectorAll('button[type="submit"], input[type="submit"]')
      .forEach((button) => {
        button.hidden = true;
      });

    let timer = null;
    let controller = null;
    let lastUrl = null;

    const buildUrl = () => {
      const url = new URL(form.getAttribute('action') || window.location.pathname, window.location.origin);
      const params = new URLSearchParams();
      new FormData(form).forEach((value, key) => {
        // Nouvelle recherche = retour a la premiere page.
        if (key !== 'page' && typeof value === 'string' && value !== '') {
          params.append(key, value);
        }
      });
      url.search = params.toString();
      return url;
    };

    const setBusy = (busy) => {
      selectors.forEach((selector) => {
        document.querySelector(selector)?.setAttribute('aria-busy', String(busy));
      });
      form.classList.toggle('is-searching', busy);
    };

    const run = async () => {
      const url = buildUrl();
      if (url.href === lastUrl) {
        return;
      }
      lastUrl = url.href;

      controller?.abort();
      controller = new AbortController();
      setBusy(true);
      try {
        const response = await fetch(url.href, {
          credentials: 'same-origin',
          headers: { Accept: 'text/html' },
          signal: controller.signal,
        });
        // Session expiree (redirection vers /login) ou erreur : navigation
        // classique, l'utilisateur voit la vraie page.
        const landed = new URL(response.url);
        if (!response.ok || landed.pathname !== url.pathname) {
          window.location.href = response.url || url.href;
          return;
        }
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        selectors.forEach((selector) => {
          const current = document.querySelector(selector);
          const next = doc.querySelector(selector);
          if (current && next) {
            current.replaceWith(next);
            window.enhanceTables?.(next);
          }
        });
        window.history.replaceState(window.history.state, '', url.pathname + url.search);
        // Le filtre local (table-filter.js) reapplique sa saisie aux nouvelles lignes.
        document.dispatchEvent(new CustomEvent('live-search:updated'));
      } catch (error) {
        if (error && error.name === 'AbortError') {
          return;
        }
        lastUrl = null;
        form.submit();
      } finally {
        setBusy(false);
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, DEBOUNCE_MS);
    };

    form.addEventListener('input', (event) => {
      const field = event.target;
      // Un champ data-table-filter filtre localement la liste affichee : pas
      // de requete serveur a chaque frappe.
      if (
        field instanceof HTMLInputElement &&
        ['search', 'text'].includes(field.type) &&
        !field.hasAttribute('data-table-filter')
      ) {
        schedule();
      }
    });
    form.addEventListener('change', (event) => {
      if (event.target instanceof HTMLSelectElement) {
        window.clearTimeout(timer);
        run();
      }
    });
    // Entree / bouton "Rechercher" : meme mecanisme, sans recharger la page.
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      window.clearTimeout(timer);
      lastUrl = null;
      run();
    });
  });
})();
