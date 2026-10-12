// Adds a "search this list" box above every table on the page, filtering the
// rows already displayed (accents and case ignored, every word must match).
// Lists that page through the server (enrollments, students, users) have
// their own search and opt out with data-no-filter on the table.
(() => {
  const MIN_ROWS = 4;

  const normalize = (value) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  document.querySelectorAll('table').forEach((table) => {
    if (table.hasAttribute('data-no-filter') || table.closest('[data-no-filter]')) {
      return;
    }
    const body = table.tBodies[0];
    if (!body) {
      return;
    }
    // A single "Aucun resultat" row (one cell spanning the table) is not data.
    const rows = Array.from(body.rows).filter(
      (row) => !(row.cells.length === 1 && row.cells[0].colSpan > 1),
    );
    if (rows.length < MIN_ROWS) {
      return;
    }

    const searchable = rows.map((row) => normalize(row.textContent || ''));

    const wrapper = document.createElement('div');
    wrapper.className = 'table-filter';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Rechercher dans cette liste…';
    input.setAttribute('aria-label', 'Rechercher dans cette liste');
    const count = document.createElement('span');
    count.className = 'table-filter-count';
    count.setAttribute('aria-live', 'polite');
    wrapper.append(input, count);

    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = Math.max(1, table.rows[0] ? table.rows[0].cells.length : 1);
    emptyCell.textContent = 'Aucun résultat pour cette recherche.';
    emptyRow.hidden = true;
    emptyRow.appendChild(emptyCell);
    body.appendChild(emptyRow);

    const apply = () => {
      const words = normalize(input.value).split(/\s+/).filter(Boolean);
      let visible = 0;
      rows.forEach((row, index) => {
        const match = words.every((word) => searchable[index].includes(word));
        row.hidden = !match;
        if (match) {
          visible += 1;
        }
      });
      emptyRow.hidden = visible !== 0;
      count.textContent = words.length ? `${visible} / ${rows.length}` : '';
    };
    input.addEventListener('input', apply);

    (table.closest('.table-shell') || table).before(wrapper);
  });
})();
