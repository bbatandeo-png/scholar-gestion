// Tiny dependency-free chart renderers (plain SVG) for the dashboard.
//
// Deliberately not a third-party charting library: this app ships as an
// offline Windows .exe installed at schools with no internet access, so
// every asset has to be served locally - see public/table-filter.js for the
// same reasoning behind other small hand-rolled scripts in this app.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const FORMAT = new Intl.NumberFormat('fr-FR');

  function el(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  function emptyState(container, message) {
    container.textContent = '';
    const p = document.createElement('p');
    p.className = 'muted chart-empty';
    p.textContent = message || 'Aucune donnée à afficher.';
    container.appendChild(p);
  }

  // Horizontal bar chart: data = [{ label, value, color? }]
  window.renderBarChart = function renderBarChart(container, data, opts) {
    if (!container) return;
    const rows = (data || []).filter((row) => Number.isFinite(row.value));
    if (!rows.length || rows.every((row) => row.value <= 0)) {
      emptyState(container);
      return;
    }
    const options = opts || {};
    const defaultColors = ['#0e7c66', '#db6c3f', '#b43f3f', '#3f6fb4', '#8a5fb4'];
    const max = Math.max(...rows.map((row) => row.value), 1);
    const width = options.width || container.clientWidth || 480;
    const rowHeight = 34;
    const labelWidth = options.labelWidth || 150;
    const barAreaWidth = Math.max(width - labelWidth - 90, 60);
    const height = rows.length * rowHeight + 8;

    const svg = el('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width: '100%',
      height,
      role: 'img',
      'aria-label': options.ariaLabel || 'Graphique en barres',
    });

    rows.forEach((row, i) => {
      const y = i * rowHeight;
      const barWidth = Math.max((row.value / max) * barAreaWidth, 2);
      const color = row.color || defaultColors[i % defaultColors.length];

      const label = el('text', {
        x: 0,
        y: y + rowHeight / 2 + 4,
        'font-size': 13,
        fill: '#1a2027',
      });
      label.textContent = row.label;
      svg.appendChild(label);

      svg.appendChild(
        el('rect', {
          x: labelWidth,
          y: y + 6,
          width: barAreaWidth,
          height: rowHeight - 14,
          rx: 4,
          fill: '#e1e4e9',
        }),
      );
      svg.appendChild(
        el('rect', {
          x: labelWidth,
          y: y + 6,
          width: barWidth,
          height: rowHeight - 14,
          rx: 4,
          fill: color,
        }),
      );

      const value = el('text', {
        x: labelWidth + barAreaWidth + 10,
        y: y + rowHeight / 2 + 4,
        'font-size': 13,
        fill: '#626c79',
      });
      value.textContent = FORMAT.format(row.value);
      svg.appendChild(value);
    });

    container.textContent = '';
    container.appendChild(svg);
  };

  // Donut chart: data = [{ label, value, color? }]
  window.renderDonutChart = function renderDonutChart(container, data, opts) {
    if (!container) return;
    const rows = (data || []).filter(
      (row) => Number.isFinite(row.value) && row.value > 0,
    );
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    if (!rows.length || total <= 0) {
      emptyState(container);
      return;
    }
    const options = opts || {};
    const defaultColors = ['#0e7c66', '#e1e4e9', '#db6c3f'];
    const size = options.size || 180;
    const radius = size / 2 - 14;
    const circumference = 2 * Math.PI * radius;
    const center = size / 2;

    const svg = el('svg', {
      viewBox: `0 0 ${size} ${size}`,
      width: size,
      height: size,
      role: 'img',
      'aria-label': options.ariaLabel || 'Graphique en anneau',
    });
    svg.appendChild(
      el('circle', {
        cx: center,
        cy: center,
        r: radius,
        fill: 'none',
        stroke: '#e1e4e9',
        'stroke-width': 20,
      }),
    );

    let offset = 0;
    rows.forEach((row, i) => {
      const fraction = row.value / total;
      const dash = fraction * circumference;
      const circle = el('circle', {
        cx: center,
        cy: center,
        r: radius,
        fill: 'none',
        stroke: row.color || defaultColors[i % defaultColors.length],
        'stroke-width': 20,
        'stroke-dasharray': `${dash} ${circumference - dash}`,
        'stroke-dashoffset': -offset,
        transform: `rotate(-90 ${center} ${center})`,
      });
      svg.appendChild(circle);
      offset += dash;
    });

    if (options.centerLabel) {
      const text = el('text', {
        x: center,
        y: center + 6,
        'text-anchor': 'middle',
        'font-size': 22,
        'font-weight': 700,
        fill: '#1a2027',
      });
      text.textContent = options.centerLabel;
      svg.appendChild(text);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'donut-chart-wrapper';
    wrapper.appendChild(svg);

    const legend = document.createElement('ul');
    legend.className = 'donut-chart-legend';
    rows.forEach((row, i) => {
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'donut-chart-swatch';
      swatch.style.background = row.color || defaultColors[i % defaultColors.length];
      item.appendChild(swatch);
      item.appendChild(
        document.createTextNode(`${row.label} — ${FORMAT.format(row.value)}`),
      );
      legend.appendChild(item);
    });
    wrapper.appendChild(legend);

    container.textContent = '';
    container.appendChild(wrapper);
  };

  // Grouped vertical bar chart (e.g. "Encaissements" month by month,
  // current year vs previous year side by side). rows = [{ label, ...
  // one numeric field per series key }]; opts.series = [{ key, label,
  // color }] - a series with no label is skipped (e.g. no prior year yet).
  window.renderGroupedBarChart = function renderGroupedBarChart(
    container,
    rows,
    opts,
  ) {
    if (!container) return;
    const options = opts || {};
    const series = (options.series || []).filter((s) => s.label);
    // Montants recus en FCFA : on choisit l'unite d'affichage (FCFA, milliers
    // ou millions) selon le plus grand montant, pour que de petits montants
    // restent visibles au lieu d'etre arrondis a zero.
    const rawRows = rows || [];
    const rawMax = Math.max(
      0,
      ...rawRows.flatMap((row) =>
        series.map((s) => Number(row[s.key])).filter(Number.isFinite),
      ),
    );
    const unit = options.autoUnit
      ? rawMax >= 1000000
        ? { divisor: 1000000, label: 'En millions de FCFA' }
        : rawMax >= 1000
          ? { divisor: 1000, label: 'En milliers de FCFA' }
          : { divisor: 1, label: 'En FCFA' }
      : { divisor: 1, label: '' };
    if (options.unitTarget && unit.label) {
      options.unitTarget.textContent = unit.label + ', par mois.';
    }
    const safeRows = rawRows.map((row) => {
      const scaled = { ...row };
      series.forEach((s) => {
        const value = Number(row[s.key]);
        if (Number.isFinite(value)) scaled[s.key] = value / unit.divisor;
      });
      return scaled;
    });
    const allValues = safeRows.flatMap((row) =>
      series.map((s) => Number(row[s.key])).filter(Number.isFinite),
    );
    if (!series.length || !safeRows.length || !allValues.some((v) => v > 0)) {
      emptyState(container);
      return;
    }
    const decimalFormat = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

    const width = options.width || container.clientWidth || 640;
    const plotHeight = 220;
    const topPad = 30; // room for the peak-value callout
    const axisLeft = 34;
    const axisBottom = 26;
    const legendHeight = 30;
    const height = topPad + plotHeight + axisBottom + legendHeight;
    const plotWidth = Math.max(width - axisLeft - 10, 60);

    const maxValue = Math.max(...allValues, 1);
    const niceMax = maxValue <= 15 ? Math.ceil(maxValue / 5) * 5 || 5 : Math.ceil(maxValue / 20) * 20;
    const tickStep = niceMax / 3;
    const ticks = [0, tickStep, tickStep * 2, niceMax];

    const svg = el('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width: '100%',
      height,
      role: 'img',
      'aria-label': options.ariaLabel || 'Graphique en barres groupees',
    });

    // Gridlines + Y-axis labels.
    ticks.forEach((tick) => {
      const y = topPad + plotHeight - (tick / niceMax) * plotHeight;
      svg.appendChild(
        el('line', {
          x1: axisLeft,
          x2: axisLeft + plotWidth,
          y1: y,
          y2: y,
          stroke: '#e1e4e9',
          'stroke-width': 1,
        }),
      );
      const label = el('text', {
        x: axisLeft - 8,
        y: y + 4,
        'font-size': 11,
        'text-anchor': 'end',
        fill: '#626c79',
      });
      label.textContent = Math.round(tick);
      svg.appendChild(label);
    });

    // Peak bar (across every month and series) gets its value called out
    // above it, the way the reference dashboard mockup highlights it.
    let peak = { value: -Infinity };
    safeRows.forEach((row, rowIndex) => {
      series.forEach((s) => {
        const value = Number(row[s.key]);
        if (Number.isFinite(value) && value > peak.value) {
          peak = { value, rowIndex, key: s.key };
        }
      });
    });

    const groupWidth = plotWidth / safeRows.length;
    const barGap = 4;
    const barWidth = Math.max((groupWidth * 0.64) / series.length, 4);

    safeRows.forEach((row, rowIndex) => {
      const groupX = axisLeft + rowIndex * groupWidth + (groupWidth - barWidth * series.length - barGap * (series.length - 1)) / 2;

      series.forEach((s, seriesIndex) => {
        const value = Math.max(Number(row[s.key]) || 0, 0);
        const barHeight = (value / niceMax) * plotHeight;
        const x = groupX + seriesIndex * (barWidth + barGap);
        const y = topPad + plotHeight - barHeight;
        svg.appendChild(
          el('rect', {
            x,
            y,
            width: barWidth,
            height: Math.max(barHeight, value > 0 ? 2 : 0),
            rx: 3,
            fill: s.color,
          }),
        );
        if (rowIndex === peak.rowIndex && s.key === peak.key) {
          const callout = el('text', {
            x: x + barWidth / 2,
            y: y - 8,
            'font-size': 12,
            'font-weight': 700,
            'text-anchor': 'middle',
            fill: '#1a2027',
          });
          callout.textContent = decimalFormat.format(value);
          svg.appendChild(callout);
        }
      });

      const monthLabel = el('text', {
        x: axisLeft + rowIndex * groupWidth + groupWidth / 2,
        y: topPad + plotHeight + 18,
        'font-size': 11,
        'text-anchor': 'middle',
        fill: '#626c79',
      });
      monthLabel.textContent = row.label;
      svg.appendChild(monthLabel);
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'grouped-bar-chart-wrapper';
    wrapper.appendChild(svg);

    const legend = document.createElement('ul');
    legend.className = 'grouped-bar-chart-legend';
    series.forEach((s) => {
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'donut-chart-swatch';
      swatch.style.background = s.color;
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(s.label));
      legend.appendChild(item);
    });
    wrapper.appendChild(legend);

    container.textContent = '';
    container.appendChild(wrapper);
  };
})();
