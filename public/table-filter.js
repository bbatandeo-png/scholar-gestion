// Adds a "search this list" box above every table on the page, filtering the
// rows already displayed (accents and case ignored, every word must match).
// Lists that page through the server (enrollments, students, users...) have
// their own search and opt out with data-no-filter on the table.
//
// Tables sharing a data-filter-group="<name>" attribute (e.g. the levels
// page, one table per cycle) get a single box, placed before the first one,
// that filters all of them at once. Help tables tucked away in a <details>
// or a <dialog> never get a box.
(() => {
  const normalize = (value) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

  // A single "Aucun resultat" row (one cell spanning the table) is not data.
  const dataRows = (table) =>
    table.tBodies[0]
      ? Array.from(table.tBodies[0].rows).filter(
          (row) => !(row.cells.length === 1 && row.cells[0].colSpan > 1),
        )
      : [];

  // Champ de recherche deja place dans une barre de filtres de la page
  // (<input data-table-filter="#idDuTableau">, sans attribut name pour ne
  // pas partir avec le formulaire) : il filtre ce tableau au lieu d'en creer
  // un second. Les lignes sont relues a chaque frappe et apres chaque mise
  // a jour par la recherche instantanee (le tableau est alors remplace).
  document.querySelectorAll('input[data-table-filter]').forEach((input) => {
    const apply = () => {
      const table = document.querySelector(input.dataset.tableFilter);
      if (!table || !table.tBodies[0]) {
        return;
      }
      const words = normalize(input.value).split(/\s+/).filter(Boolean);
      let emptyRow = table.tBodies[0].querySelector('tr[data-filter-empty]');
      const rows = dataRows(table).filter((row) => row !== emptyRow);
      let visible = 0;
      rows.forEach((row) => {
        const match = words.every((word) =>
          normalize(row.textContent || '').includes(word),
        );
        row.hidden = !match;
        if (match) {
          visible += 1;
        }
      });
      if (!emptyRow && rows.length > 0) {
        emptyRow = document.createElement('tr');
        emptyRow.dataset.filterEmpty = '';
        const cell = document.createElement('td');
        cell.colSpan = Math.max(1, table.rows[0] ? table.rows[0].cells.length : 1);
        cell.textContent = 'Aucun résultat pour cette recherche.';
        emptyRow.appendChild(cell);
        table.tBodies[0].appendChild(emptyRow);
      }
      if (emptyRow) {
        emptyRow.hidden = visible !== 0 || rows.length === 0;
      }
    };
    input.addEventListener('input', apply);
    document.addEventListener('live-search:updated', apply);
  });

  const eligible = Array.from(document.querySelectorAll('table')).filter(
    (table) =>
      !table.hasAttribute('data-no-filter') &&
      !table.closest('[data-no-filter], details, dialog') &&
      dataRows(table).length > 0,
  );

  // One entry per filter box: either a group of tables or a single table.
  const groups = new Map();
  eligible.forEach((table, index) => {
    const key = table.dataset.filterGroup || `__table_${index}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(table);
  });

  groups.forEach((tables) => {
    const entries = tables.map((table) => {
      const rows = dataRows(table);
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = Math.max(
        1,
        table.rows[0] ? table.rows[0].cells.length : 1,
      );
      emptyCell.textContent = 'Aucun résultat pour cette recherche.';
      emptyRow.hidden = true;
      emptyRow.appendChild(emptyCell);
      table.tBodies[0].appendChild(emptyRow);
      return {
        rows,
        searchable: rows.map((row) => normalize(row.textContent || '')),
        emptyRow,
      };
    });
    const total = entries.reduce((sum, entry) => sum + entry.rows.length, 0);

    const wrapper = document.createElement('div');
    wrapper.className = 'table-filter';
    wrapper.setAttribute('role', 'search');
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Rechercher dans cette liste…';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Rechercher dans cette liste');
    const count = document.createElement('span');
    count.className = 'table-filter-count';
    count.setAttribute('aria-live', 'polite');
    wrapper.append(input, count);

    const apply = () => {
      const words = normalize(input.value).split(/\s+/).filter(Boolean);
      let visible = 0;
      entries.forEach((entry) => {
        let visibleHere = 0;
        entry.rows.forEach((row, index) => {
          const match = words.every((word) =>
            entry.searchable[index].includes(word),
          );
          row.hidden = !match;
          if (match) {
            visibleHere += 1;
          }
        });
        entry.emptyRow.hidden = visibleHere !== 0;
        visible += visibleHere;
      });
      count.textContent = words.length ? `${visible} / ${total}` : '';
    };
    input.addEventListener('input', apply);

    const first = tables[0];
    const anchor = first.dataset.filterGroup
      ? first.closest('[data-filter-anchor]') || first.closest('.table-shell') || first
      : first.closest('.table-shell') || first;
    anchor.before(wrapper);
  });
})();
