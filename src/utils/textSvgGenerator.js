/**
 * Utility untuk escaping XML agar string aman dimasukkan ke dalam SVG tanpa syntax error.
 */
export function escapeXml(str = '') {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '\'':
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

/**
 * Memecah teks menjadi baris-baris sesuai batas maksimal karakter per baris.
 * Memotong kata secara aman jika ada kata tunggal yang melebihi batas.
 */
export function wrapWords(text = '', maxCharsPerLine = 20) {
  const normalized = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return [];

  const words = normalized.split(' ');
  const lines = [];
  let currentLine = '';

  for (let word of words) {
    if (word.length > maxCharsPerLine) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      while (word.length > maxCharsPerLine) {
        lines.push(word.slice(0, maxCharsPerLine));
        word = word.slice(maxCharsPerLine);
      }
      if (word) {
        lines.push(word);
      }
      currentLine = '';
      continue;
    }

    if (!currentLine) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= maxCharsPerLine) {
      currentLine += ` ${word}`;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Menghitung ukuran font dan pemecahan baris untuk teks stiker meme Impact.
 */
export function fitMemeLines(text, availableWidth = 460, maxLines = 3) {
  if (!text || !text.trim()) {
    return { lines: [], fontSize: 44, lineHeight: 50 };
  }

  const upper = text.toUpperCase().trim();
  const candidates = [
    { fontSize: 46, lineHeight: 52 },
    { fontSize: 40, lineHeight: 46 },
    { fontSize: 34, lineHeight: 40 },
    { fontSize: 28, lineHeight: 34 },
    { fontSize: 24, lineHeight: 30 },
    { fontSize: 20, lineHeight: 25 },
  ];

  for (const { fontSize, lineHeight } of candidates) {
    const maxChars = Math.max(10, Math.floor(availableWidth / (fontSize * 0.52)));
    const lines = wrapWords(upper, maxChars);
    if (lines.length <= maxLines) {
      return { lines, fontSize, lineHeight };
    }
  }

  const fallback = candidates[candidates.length - 1];
  const maxChars = Math.max(10, Math.floor(availableWidth / (fallback.fontSize * 0.52)));
  const lines = wrapWords(upper, maxChars);
  return { lines: lines.slice(0, maxLines + 1), fontSize: fallback.fontSize, lineHeight: fallback.lineHeight };
}

/**
 * Membentuk SVG layer teks meme bergaya Impact klasik (stroke hitam tebal, fill putih).
 */
export function buildMemeSvg({ topText = '', bottomText = '', origWidth = 512, origHeight = 512, size = 512 }) {
  const w = origWidth > 0 ? origWidth : size;
  const h = origHeight > 0 ? origHeight : size;
  const scale = Math.min(size / w, size / h);
  const renderedW = Math.max(1, Math.round(w * scale));
  const renderedH = Math.max(1, Math.round(h * scale));
  const offsetY = Math.round((size - renderedH) / 2);

  const availableWidth = Math.min(460, Math.max(280, renderedW - 24));
  const topFit = fitMemeLines(topText, availableWidth, 3);
  const bottomFit = fitMemeLines(bottomText, availableWidth, 3);

  const elements = [];

  let topLastY = -1;
  if (topFit.lines.length > 0) {
    const strokeWidth = Math.max(4, Math.round(topFit.fontSize * 0.1));
    const topBaseline0 = offsetY + 12 + Math.round(topFit.fontSize * 0.85);

    topFit.lines.forEach((line, idx) => {
      const y = topBaseline0 + idx * topFit.lineHeight;
      topLastY = y;
      const escaped = escapeXml(line);
      elements.push(
        `  <text x="${Math.round(size / 2)}" y="${y}" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-weight="900" font-size="${topFit.fontSize}" fill="#000000" stroke="#000000" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round">${escaped}</text>`,
      );
      elements.push(
        `  <text x="${Math.round(size / 2)}" y="${y}" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-weight="900" font-size="${topFit.fontSize}" fill="#FFFFFF">${escaped}</text>`,
      );
    });
  }

  if (bottomFit.lines.length > 0) {
    const strokeWidth = Math.max(4, Math.round(bottomFit.fontSize * 0.1));
    const bottomLastBaseline = offsetY + renderedH - 14 - Math.round(bottomFit.fontSize * 0.15);
    let bottomBaseline0 = bottomLastBaseline - (bottomFit.lines.length - 1) * bottomFit.lineHeight;

    if (topLastY > 0 && bottomBaseline0 <= topLastY + 10) {
      bottomBaseline0 = topLastY + 12;
    }

    bottomFit.lines.forEach((line, idx) => {
      const y = bottomBaseline0 + idx * bottomFit.lineHeight;
      const escaped = escapeXml(line);
      elements.push(
        `  <text x="${Math.round(size / 2)}" y="${y}" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-weight="900" font-size="${bottomFit.fontSize}" fill="#000000" stroke="#000000" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round">${escaped}</text>`,
      );
      elements.push(
        `  <text x="${Math.round(size / 2)}" y="${y}" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-weight="900" font-size="${bottomFit.fontSize}" fill="#FFFFFF">${escaped}</text>`,
      );
    });
  }

  return [
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">`,
    ...elements,
    '</svg>',
  ].join('\n');
}

/**
 * Menghitung ukuran font dan baris untuk stiker Brat ala Charli XCX.
 */
export function fitBratLines(text, availableWidth = 440) {
  const normalized = String(text || '').toLowerCase().trim();
  if (!normalized) {
    return { lines: ['brat'], fontSize: 96, lineHeight: 100 };
  }

  const candidates = [
    { fontSize: 96, lineHeight: 100, maxLines: 1 },
    { fontSize: 72, lineHeight: 78, maxLines: 2 },
    { fontSize: 54, lineHeight: 60, maxLines: 3 },
    { fontSize: 40, lineHeight: 46, maxLines: 4 },
    { fontSize: 30, lineHeight: 36, maxLines: 6 },
    { fontSize: 24, lineHeight: 30, maxLines: 8 },
  ];

  for (const { fontSize, lineHeight, maxLines } of candidates) {
    const maxChars = Math.max(7, Math.floor(availableWidth / (fontSize * 0.53)));
    const lines = wrapWords(normalized, maxChars);
    if (lines.length <= maxLines) {
      return { lines, fontSize, lineHeight };
    }
  }

  const fallback = candidates[candidates.length - 1];
  const maxChars = Math.max(7, Math.floor(availableWidth / (fallback.fontSize * 0.53)));
  const lines = wrapWords(normalized, maxChars);
  return { lines: lines.slice(0, 8), fontSize: fallback.fontSize, lineHeight: fallback.lineHeight };
}

/**
 * Membentuk SVG stiker viral Brat (kotak hijau neon/putih, teks Arial hitam blur halus).
 */
export function buildBratSvg({ text = '', isWhite = false, size = 512 }) {
  const bgColor = isWhite ? '#FFFFFF' : '#8ACE00';
  const { lines, fontSize, lineHeight } = fitBratLines(text, Math.round(size * 0.86));

  const totalHeight = (lines.length - 1) * lineHeight + fontSize;
  const startY = Math.round(size / 2 - totalHeight / 2 + fontSize * 0.78);

  const textElements = lines.map((line, idx) => {
    const y = startY + idx * lineHeight;
    const escaped = escapeXml(line);
    return `    <text x="${Math.round(size / 2)}" y="${y}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#000000" letter-spacing="-1.5px">${escaped}</text>`;
  });

  return [
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">`,
    '  <defs>',
    '    <filter id="brat-blur" x="-20%" y="-20%" width="140%" height="140%">',
    '      <feGaussianBlur stdDeviation="0.65" />',
    '    </filter>',
    '  </defs>',
    `  <rect width="${size}" height="${size}" fill="${bgColor}" />`,
    '  <g filter="url(#brat-blur)">',
    ...textElements,
    '  </g>',
    '</svg>',
  ].join('\n');
}
